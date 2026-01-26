import { Injectable, inject, PLATFORM_ID, signal, computed, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, throwError, of, Subscription, switchMap } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore } from '@ngneat/elf';
import {
  withEntities,
  selectAllEntities,
  setEntities,
  addEntities,
  updateEntities,
  deleteEntities,
  upsertEntities,
  getEntity,
  getAllEntities,
} from '@ngneat/elf-entities';
import { IndexedDBService } from './indexed-db.service';
import { RealtimeService } from './realtime.service';
import { RealtimeWSService } from './realtime-ws.service';
import { AuthService } from './auth.service';
import { NetworkService } from './network.service';
import { NotificationService } from './notification.service';
import { VisibilityService } from './visibility.service';
import { DB_STORES } from './db-stores';
import type { Message, PageContent, UnreadCount, Page } from '@maple/shared';

const STORE_NAME = DB_STORES.MESSAGE;

@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly realtime = inject(RealtimeService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly network = inject(NetworkService);
  private readonly notificationService = inject(NotificationService);
  private readonly visibilityService = inject(VisibilityService);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Message, 'id'>({ idKey: 'id' }),
  );

  // Observable selectors
  readonly messages$ = this.store.pipe(selectAllEntities());

  // Signal wrappers
  private readonly _messagesSignal = toSignal(this.messages$, { initialValue: [] as Message[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _hasMore = signal(true);
  private readonly _currentNotebookId = signal<string | null>(null);
  private readonly _currentPageId = signal<string | null>(null);
  private readonly _currentPage = signal<Page | null>(null);
  private readonly _unreadCounts = signal<UnreadCount[]>([]);

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly currentNotebookId = this._currentNotebookId.asReadonly();
  readonly currentPageId = this._currentPageId.asReadonly();
  readonly currentPage = this._currentPage.asReadonly();
  readonly unreadCounts = this._unreadCounts.asReadonly();

  // Backward compatibility alias
  readonly currentTagId = this._currentNotebookId.asReadonly();

  // Realtime subscription
  private realtimeSubscription: Subscription | null = null;

  // Deduplication: track recently processed message IDs to prevent duplicate handling
  private readonly processedMessageIds = new Set<string>();
  private readonly MAX_PROCESSED_IDS = 100;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();
      this.setupRealtimeHandlers();

      // Refresh unread counts when document becomes visible (user returns to tab)
      this.visibilityService.becameVisible$
        .pipe(switchMap(() => this.loadUnreadCounts()))
        .subscribe();
    }

    this.destroyRef.onDestroy(() => {
      this.realtimeSubscription?.unsubscribe();
    });
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<Message>(STORE_NAME);
    if (cached.length > 0 && this.store.query(getAllEntities()).length === 0) {
      this.store.update(setEntities(cached));
    }
  }

  private setupRealtimeHandlers(): void {
    this.realtimeSubscription = this.realtime.events$.subscribe((event) => {
      switch (event.action) {
        case 'message':
          this.handleNewMessage(event.data as Message);
          break;
        case 'edited':
          this.handleEditedMessage(event.data as Message);
          break;
        case 'deleted':
          this.handleDeletedMessage((event.data as { id: string }).id);
          break;
        case 'message_updated':
          this.handleMessageUpdated(event.data as { id: string; hasThread?: boolean });
          break;
      }
    });
  }

  private handleNewMessage(message: Message): void {
    // Deduplicate: skip if we've already processed this message
    if (this.processedMessageIds.has(message.id)) {
      return;
    }
    if (this.processedMessageIds.size >= this.MAX_PROCESSED_IDS) {
      this.processedMessageIds.clear();
    }
    this.processedMessageIds.add(message.id);

    const currentPageId = this._currentPageId();
    const currentNotebookId = this._currentNotebookId();
    const currentUserId = this.authService.user()?._id;
    const activeNotebookId = this.notificationService.activeNotebookId();

    // Only add to store if for current page (or current notebook for backward compat)
    const isCurrentPage = message.pageId === currentPageId;
    const isCurrentNotebook = message.notebookId === currentNotebookId;

    if (isCurrentPage || isCurrentNotebook) {
      // Use upsert to handle duplicates (e.g., sender's own message)
      this.store.update(upsertEntities(message));
      this.persistToIndexedDB([message]);
    }

    // If user is viewing this notebook, mark as read immediately
    if (message.notebookId === activeNotebookId && message.pageId) {
      this.markAsReadByPageId(message.pageId).subscribe();
      this.notificationService.markNotebookMessagesAsRead(message.notebookId);
    } else if (message.userId !== currentUserId) {
      // Show toast notification if message is from another user
      const senderName = message.senderDisplayName || message.senderEmail || 'Someone';
      const messagePreview = this.extractTextFromContent(message.content);

      this.notificationService.showToast({
        title: senderName,
        message: messagePreview || 'Sent a message',
        type: 'info',
        duration: 5000,
        avatarEmail: message.senderEmail,
        avatarDisplayName: message.senderDisplayName,
        avatarUrl: message.senderProfilePictureUrl,
      });

      // Increment local unread count
      this._unreadCounts.update((counts) => {
        const existing = counts.find((c) => c.pageId === message.pageId);
        if (existing) {
          return counts.map((c) =>
            c.pageId === message.pageId ? { ...c, count: c.count + 1 } : c,
          );
        } else {
          return [...counts, { pageId: message.pageId, notebookId: message.notebookId, count: 1 }];
        }
      });
    }
  }

  /**
   * Extract plain text from TipTap JSON content
   */
  private extractTextFromContent(content: any): string {
    if (!content || typeof content !== 'object') {
      return '';
    }

    let text = '';

    const traverse = (node: any) => {
      if (node.type === 'text') {
        text += node.text || '';
      }
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) {
          traverse(child);
        }
      }
    };

    traverse(content);
    const trimmed = text.trim();
    // Truncate to 100 characters for toast preview
    return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
  }

  private handleEditedMessage(message: Message): void {
    this.store.update(updateEntities(message.id, () => message));
    this.persistToIndexedDB([message]);
  }

  private handleDeletedMessage(id: string): void {
    this.store.update(deleteEntities(id));
    if (isPlatformBrowser(this.platformId)) {
      this.indexedDB.delete(id, STORE_NAME);
    }
  }

  private handleMessageUpdated(data: { id: string; hasThread?: boolean }): void {
    this.store.update(
      updateEntities(data.id, (entity) => ({
        ...entity,
        hasThread: data.hasThread ?? entity.hasThread,
      })),
    );
  }

  /**
   * Get all messages as a reactive signal
   */
  messages(): Message[] {
    return this._messagesSignal() ?? [];
  }

  /**
   * Get messages for current page/tag sorted by creation time
   * Excludes thread messages (those with threadId set)
   */
  messagesForTag = computed(() => {
    const pageId = this._currentPageId();
    const notebookId = this._currentNotebookId();

    if (!pageId && !notebookId) return [];

    return this.messages()
      .filter((m) => {
        // Filter by pageId (preferred) or notebookId (backward compat)
        const matchesPage = pageId && m.pageId === pageId;
        const matchesNotebook = notebookId && m.notebookId === notebookId;
        return (matchesPage || matchesNotebook) && !m.threadId;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });

  /**
   * Get unread count for a specific notebook
   */
  getUnreadCount(notebookId: string): number {
    return this._unreadCounts().find((c) => c.notebookId === notebookId)?.count || 0;
  }

  /**
   * Get unread count for a specific page
   */
  getUnreadCountByPageId(pageId: string): number {
    return this._unreadCounts().find((c) => c.pageId === pageId)?.count || 0;
  }

  /**
   * Load messages for a notebook (finds/creates messages page automatically)
   */
  loadMessages(notebookId: string, reset: boolean = true): Observable<Message[]> {
    if (reset) {
      this._currentNotebookId.set(notebookId);
      this._hasMore.set(true);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http
      .get<{ messages: Message[]; page: Page }>(`/api/notebooks/${notebookId}/messages`)
      .pipe(
        tap((response) => {
          // Store the messages page info
          this._currentPageId.set(response.page.id);
          this._currentPage.set(response.page);

          if (reset) {
            this.store.update(setEntities(response.messages));
          } else {
            this.store.update(upsertEntities(response.messages));
          }
          this._hasMore.set(response.messages.length >= 50);
          this.persistToIndexedDB(response.messages);
          this._isLoading.set(false);
        }),
        map((response) => response.messages),
        catchError((err) => {
          let message = err?.error?.error || 'Failed to load messages';

          // Network-aware error message
          if (!this.network.isOnline()) {
            message = 'Working offline - showing cached data';
          }

          this._error.set(message);
          this._isLoading.set(false);

          // Return cached data instead of empty array
          const cached = this.store.query(getAllEntities());
          return of(cached);
        }),
      );
  }

  /**
   * Load messages for a specific page (by pageId)
   */
  loadMessagesByPageId(pageId: string, reset: boolean = true): Observable<Message[]> {
    if (reset) {
      this._currentPageId.set(pageId);
      this._hasMore.set(true);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ messages: Message[]; page: Page }>(`/api/pages/${pageId}/messages`).pipe(
      tap((response) => {
        this._currentPage.set(response.page);
        this._currentNotebookId.set(response.page.notebookId || null);

        if (reset) {
          this.store.update(setEntities(response.messages));
        } else {
          this.store.update(upsertEntities(response.messages));
        }
        this._hasMore.set(response.messages.length >= 50);
        this.persistToIndexedDB(response.messages);
        this._isLoading.set(false);
      }),
      map((response) => response.messages),
      catchError((err) => {
        let message = err?.error?.error || 'Failed to load messages';

        if (!this.network.isOnline()) {
          message = 'Working offline - showing cached data';
        }

        this._error.set(message);
        this._isLoading.set(false);

        const cached = this.store.query(getAllEntities());
        return of(cached);
      }),
    );
  }

  /**
   * Load older messages (pagination)
   */
  loadMore(): Observable<Message[]> {
    const pageId = this._currentPageId();
    const notebookId = this._currentNotebookId();

    if ((!pageId && !notebookId) || !this._hasMore() || this._isLoading()) {
      return of([]);
    }

    const messages = this.messagesForTag();
    const oldestMessage = messages[0];
    if (!oldestMessage) {
      return of([]);
    }

    this._isLoading.set(true);

    // Use page-based endpoint if we have pageId, otherwise fall back to notebook
    const endpoint = pageId
      ? `/api/pages/${pageId}/messages`
      : `/api/notebooks/${notebookId}/messages`;

    return this.http
      .get<{ messages: Message[] }>(endpoint, { params: { before: oldestMessage.id } })
      .pipe(
        tap((response) => {
          this.store.update(upsertEntities(response.messages));
          this._hasMore.set(response.messages.length >= 50);
          this.persistToIndexedDB(response.messages);
          this._isLoading.set(false);
        }),
        map((response) => response.messages),
        catchError((err) => {
          let message = err?.error?.error || 'Failed to load more messages';

          if (!this.network.isOnline()) {
            message = 'Working offline - cannot load older messages';
          }

          this._error.set(message);
          this._isLoading.set(false);

          return of([]);
        }),
      );
  }

  /**
   * Send a new message via WebSocket (preferred) or HTTP fallback
   */
  sendMessage(
    notebookId: string,
    content: PageContent,
    options?: { threadId?: string; parentMessageId?: string },
  ): Observable<Message> {
    this._error.set(null);

    // For simple messages without threads, use WebSocket
    if (!options?.threadId && !options?.parentMessageId && this.realtimeWS.isConnected()) {
      this.realtimeWS.sendChatMessage(notebookId, content);
      return of(null as unknown as Message);
    }

    // Fall back to HTTP for thread messages or when WebSocket not connected
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const currentUser = this.authService.user();
    const pageId = this._currentPageId() || '';

    const tempMessage: Message = {
      _id: tempId,
      id: tempId,
      pageId,
      notebookId,
      threadId: options?.threadId,
      userId: currentUser?._id || 'temp',
      senderEmail: currentUser?.email,
      senderDisplayName: currentUser?.displayName,
      senderProfilePictureUrl: currentUser?.profilePictureUrl,
      content,
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic update
    this.store.update(addEntities(tempMessage));

    const body: { content: PageContent; threadId?: string; parentMessageId?: string } = {
      content,
    };
    if (options?.threadId) {
      body.threadId = options.threadId;
    }
    if (options?.parentMessageId) {
      body.parentMessageId = options.parentMessageId;
    }

    return this.http
      .post<{ message: Message; page?: Page }>(`/api/notebooks/${notebookId}/messages`, body)
      .pipe(
        tap((response) => {
          this.store.update(deleteEntities(tempId));
          this.store.update(upsertEntities(response.message));
          this.persistToIndexedDB([response.message]);

          // Update current page if returned
          if (response.page && !this._currentPageId()) {
            this._currentPageId.set(response.page.id);
            this._currentPage.set(response.page);
          }
        }),
        map((response) => response.message),
        catchError((err) => {
          this.store.update(deleteEntities(tempId));
          const message = err?.error?.error || err?.error?.message || 'Failed to send message';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Edit a message
   */
  editMessage(id: string, content: PageContent): Observable<Message> {
    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Message not found'));
    }

    // Optimistic update
    this.store.update(
      updateEntities(id, (entity) => ({
        ...entity,
        content,
        editedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    );

    return this.http.put<{ message: Message }>(`/api/messages/${id}`, { content }).pipe(
      tap((response) => {
        this.store.update(updateEntities(id, () => response.message));
        this.persistToIndexedDB([response.message]);
      }),
      map((response) => response.message),
      catchError((err) => {
        this.store.update(updateEntities(id, () => original));
        const message = err?.error?.error || 'Failed to edit message';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Delete a message
   */
  deleteMessage(id: string): Observable<void> {
    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Message not found'));
    }

    // Optimistic delete
    this.store.update(deleteEntities(id));

    return this.http.delete(`/api/messages/${id}`).pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(id, STORE_NAME);
        }
      }),
      map(() => undefined),
      catchError((err) => {
        this.store.update(addEntities(original));
        const message = err?.error?.error || 'Failed to delete message';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Mark notebook as read (finds messages page automatically)
   */
  markAsRead(notebookId: string): Observable<void> {
    return this.http
      .post<{ lastReadAt: string; pageId?: string }>(`/api/notebooks/${notebookId}/read`, {})
      .pipe(
        tap((response) => {
          // Update local unread count by pageId or notebookId
          const pageId = response.pageId;
          this._unreadCounts.update((counts) =>
            counts.filter((c) => (pageId ? c.pageId !== pageId : c.notebookId !== notebookId)),
          );
        }),
        map(() => undefined),
        catchError(() => of(undefined)),
      );
  }

  /**
   * Mark page as read by pageId
   */
  markAsReadByPageId(pageId: string): Observable<void> {
    return this.http.post<{ lastReadAt: string }>(`/api/pages/${pageId}/read`, {}).pipe(
      tap(() => {
        this._unreadCounts.update((counts) => counts.filter((c) => c.pageId !== pageId));
      }),
      map(() => undefined),
      catchError(() => of(undefined)),
    );
  }

  /**
   * Load all unread counts
   */
  loadUnreadCounts(): Observable<UnreadCount[]> {
    return this.http.get<{ counts: UnreadCount[] }>('/api/unread').pipe(
      tap((response) => {
        this._unreadCounts.set(response.counts);
      }),
      map((response) => response.counts),
      catchError(() => of([])),
    );
  }

  /**
   * Clear messages for current tag
   */
  clearMessages(): void {
    this.store.update(setEntities([]));
    this._currentNotebookId.set(null);
    this._currentPageId.set(null);
    this._currentPage.set(null);
    this._hasMore.set(true);
  }

  /**
   * Send typing indicator
   */
  sendTyping(notebookId: string, isTyping: boolean = true): void {
    this.realtime.sendTyping(notebookId, isTyping);
  }

  /**
   * Mark a message as having a thread (for real-time updates)
   */
  markMessageHasThread(messageId: string): void {
    const message = this.store.query(getEntity(messageId));
    if (message && !message.hasThread) {
      this.store.update(
        updateEntities(messageId, (entity) => ({
          ...entity,
          hasThread: true,
        })),
      );
    }
  }

  private async persistToIndexedDB(messages: Message[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || messages.length === 0) return;
    await this.indexedDB.putMany(messages, STORE_NAME);
  }
}
