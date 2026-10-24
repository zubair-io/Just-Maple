import {
  Injectable,
  inject,
  PLATFORM_ID,
  signal,
  computed,
  DestroyRef,
  effect,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, throwError, of, Subscription, switchMap } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import { extractText } from '@maple/shared';

const STORE_NAME = DB_STORES.MESSAGE;

/** How long a socket send may go unconfirmed before it's shown as not sent. */
const SEND_CONFIRM_TIMEOUT_MS = 15_000;

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

  // Total message unread count (sum of all pages)
  readonly totalMessageUnreadCount = computed(() =>
    this._unreadCounts().reduce((sum, c) => sum + c.count, 0),
  );

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
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          switchMap(() => this.loadUnreadCounts()),
        )
        .subscribe();

      // Sync total message unread count with NotificationService
      effect(() => {
        const totalUnread = this.totalMessageUnreadCount();
        this.notificationService.setMessageUnreadCount(totalUnread);
      });

      // Register callback for when message notifications are marked as read in notification panel
      this.notificationService.onMessageNotificationRead((notebookId, pageId) => {
        if (pageId) {
          // Clear unread count for specific page
          this._unreadCounts.update((counts) => counts.filter((c) => c.pageId !== pageId));
        } else {
          // Clear unread count for notebook
          this._unreadCounts.update((counts) => counts.filter((c) => c.notebookId !== notebookId));
        }
      });
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

    // Your own message came back: it replaces its placeholder, whichever notebook is open
    // (you may have switched away before the echo arrived). Only a placeholder with the
    // same notebook and text is replaced, so other messages still sending keep theirs.
    // Bot posts are stored under their owner's id and never replace placeholders.
    if (message.userId === currentUserId && message.senderType !== 'bot') {
      const sent = extractText(message.content);
      const placeholder = this.store
        .query(getAllEntities())
        .find(
          (m) =>
            m.id.startsWith('temp-') &&
            m.notebookId === message.notebookId &&
            extractText(m.content) === sent,
        );
      if (placeholder) this.forgetPlaceholder(placeholder.id);
    }

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
    options?: { threadId?: string; parentMessageId?: string; forceHttp?: boolean },
  ): Observable<Message | null> {
    this._error.set(null);

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const currentUser = this.authService.user();
    const pageId = this._currentPageId() || '';

    // For simple messages without threads, use WebSocket (unless forceHttp is set)
    if (
      !options?.threadId &&
      !options?.parentMessageId &&
      !options?.forceHttp &&
      this.realtimeWS.isConnected()
    ) {
      // Create optimistic message for WebSocket path too
      const tempMessage: Message = {
        _id: tempId,
        id: tempId,
        pageId,
        notebookId,
        userId: currentUser?._id || 'temp',
        senderEmail: currentUser?.email,
        senderDisplayName: currentUser?.displayName,
        senderProfilePictureUrl: currentUser?.profilePictureUrl,
        content,
        createdAt: now,
        updatedAt: now,
      };

      // Add optimistic message immediately
      this.store.update(addEntities(tempMessage));
      this.pendingSends.set(tempId, { notebookId, content, options });

      this.realtimeWS.sendChatMessage(notebookId, content);
      // The socket gives no error reply; if the echo never arrives, offer a retry.
      this.sendTimers.set(
        tempId,
        setTimeout(() => this.markSendFailed(tempId), SEND_CONFIRM_TIMEOUT_MS),
      );
      // WebSocket doesn't return the message, return null
      // Caller should use forceHttp: true if they need the message ID
      // The real message will arrive via realtime events and upsert will update
      return of(null);
    }

    // Fall back to HTTP for thread messages or when WebSocket not connected

    // Skip optimistic update for thread replies — they shouldn't appear in the main chat
    const isThreadReply = !!options?.parentMessageId || !!options?.threadId;

    if (!isThreadReply) {
      const tempMessage: Message = {
        _id: tempId,
        id: tempId,
        pageId,
        notebookId,
        userId: currentUser?._id || 'temp',
        senderEmail: currentUser?.email,
        senderDisplayName: currentUser?.displayName,
        senderProfilePictureUrl: currentUser?.profilePictureUrl,
        content,
        createdAt: now,
        updatedAt: now,
      };

      this.store.update(addEntities(tempMessage));
      this.pendingSends.set(tempId, { notebookId, content, options });
    }

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
          if (!isThreadReply) {
            this.forgetPlaceholder(tempId);
          }
          this.store.update(upsertEntities(response.message));
          this.persistToIndexedDB([response.message]);

          // Mark parent message as having a thread
          if (options?.parentMessageId) {
            this.markMessageHasThread(options.parentMessageId);
          }

          // Update current page if returned
          if (response.page && !this._currentPageId()) {
            this._currentPageId.set(response.page.id);
            this._currentPage.set(response.page);
          }
        }),
        map((response) => response.message),
        catchError((err) => {
          // Keep the text: the message stays in the list as "Not sent" with Retry.
          if (!isThreadReply) {
            this.markSendFailed(tempId);
          }
          const message = err?.error?.error || err?.error?.message || 'Failed to send message';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
  }

  /** Placeholders whose send failed; shown as "Not sent" with Retry and Delete. */
  private readonly _failedSends = signal<ReadonlySet<string>>(new Set());
  readonly failedSends = this._failedSends.asReadonly();
  private readonly pendingSends = new Map<
    string,
    {
      notebookId: string;
      content: PageContent;
      options?: { threadId?: string; parentMessageId?: string; forceHttp?: boolean };
    }
  >();
  private readonly sendTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Take a failed message back to send it again: removes it from the list and returns
   * what it said. The caller resends it through its normal path, so @mentioned bots
   * are invoked as usual.
   */
  takeFailedSend(tempId: string): { notebookId: string; content: PageContent } | null {
    const pending = this.pendingSends.get(tempId);
    if (!pending) return null;
    this.forgetPlaceholder(tempId);
    return { notebookId: pending.notebookId, content: pending.content };
  }

  /** Drop a failed message without sending it. */
  discardFailedSend(tempId: string): void {
    this.forgetPlaceholder(tempId);
  }

  private markSendFailed(tempId: string): void {
    clearTimeout(this.sendTimers.get(tempId));
    this.sendTimers.delete(tempId);
    if (!this.store.query(getEntity(tempId))) return; // already confirmed
    this._failedSends.update((ids) => new Set([...ids, tempId]));
  }

  private forgetPlaceholder(tempId: string): void {
    clearTimeout(this.sendTimers.get(tempId));
    this.sendTimers.delete(tempId);
    this.pendingSends.delete(tempId);
    this._failedSends.update((ids) => {
      if (!ids.has(tempId)) return ids;
      const next = new Set(ids);
      next.delete(tempId);
      return next;
    });
    this.store.update(deleteEntities(tempId));
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
   * Check if a page has unread messages
   */
  hasUnreadByPageId(pageId: string): boolean {
    return this.getUnreadCountByPageId(pageId) > 0;
  }

  /**
   * Check if a notebook has unread messages
   */
  hasUnreadByNotebookId(notebookId: string): boolean {
    return this.getUnreadCount(notebookId) > 0;
  }

  /**
   * Mark notebook as read (finds messages page automatically)
   * Only makes API call if there are unread messages
   */
  markAsRead(notebookId: string): Observable<void> {
    // Skip API call if no unread messages for this notebook
    if (!this.hasUnreadByNotebookId(notebookId)) {
      return of(undefined);
    }

    return this.http
      .post<{ lastReadAt: string; pageId?: string }>(`/api/notebooks/${notebookId}/read`, {})
      .pipe(
        tap((response) => {
          // Update local unread count by pageId or notebookId
          const pageId = response.pageId;
          this._unreadCounts.update((counts) =>
            counts.filter((c) => (pageId ? c.pageId !== pageId : c.notebookId !== notebookId)),
          );
          // Also mark related notifications as read
          this.notificationService.markNotebookMessagesAsRead(notebookId);
        }),
        map(() => undefined),
        catchError(() => of(undefined)),
      );
  }

  /**
   * Mark page as read by pageId
   * Only makes API call if there are unread messages
   */
  markAsReadByPageId(pageId: string): Observable<void> {
    // Skip API call if no unread messages for this page
    if (!this.hasUnreadByPageId(pageId)) {
      return of(undefined);
    }

    return this.http.post<{ lastReadAt: string }>(`/api/pages/${pageId}/read`, {}).pipe(
      tap(() => {
        this._unreadCounts.update((counts) => counts.filter((c) => c.pageId !== pageId));
        // Also mark related notifications as read
        this.notificationService.markPageMessagesAsRead(pageId);
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
