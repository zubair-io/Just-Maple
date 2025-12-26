import { Injectable, inject, PLATFORM_ID, signal, computed, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, throwError, of, Subscription } from 'rxjs';
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
import { AuthService } from './auth.service';
import { DB_STORES } from './db-stores';
import type {
  Message,
  CreateMessageInput,
  UpdateMessageInput,
  NoteContent,
  UnreadCount,
} from '@maple/shared';

const STORE_NAME = DB_STORES.MESSAGE;

@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly realtime = inject(RealtimeService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Message, '_id'>({ idKey: '_id' }),
  );

  // Observable selectors
  readonly messages$ = this.store.pipe(selectAllEntities());

  // Signal wrappers
  private readonly _messagesSignal = toSignal(this.messages$, { initialValue: [] as Message[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _hasMore = signal(true);
  private readonly _currentTagId = signal<string | null>(null);
  private readonly _unreadCounts = signal<UnreadCount[]>([]);

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly currentTagId = this._currentTagId.asReadonly();
  readonly unreadCounts = this._unreadCounts.asReadonly();

  // Realtime subscription
  private realtimeSubscription: Subscription | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupRealtimeHandlers();
    }

    this.destroyRef.onDestroy(() => {
      this.realtimeSubscription?.unsubscribe();
    });
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
          this.handleDeletedMessage((event.data as { _id: string })._id);
          break;
        case 'message_updated':
          this.handleMessageUpdated(event.data as { _id: string; hasThread?: boolean });
          break;
      }
    });
  }

  private handleNewMessage(message: Message): void {
    const currentTagId = this._currentTagId();
    // Only add if for current tag
    if (message.tagId === currentTagId) {
      // Use upsert to handle duplicates (e.g., sender's own message)
      this.store.update(upsertEntities(message));
      this.persistToIndexedDB([message]);
    }
  }

  private handleEditedMessage(message: Message): void {
    this.store.update(updateEntities(message._id, () => message));
    this.persistToIndexedDB([message]);
  }

  private handleDeletedMessage(id: string): void {
    this.store.update(deleteEntities(id));
    if (isPlatformBrowser(this.platformId)) {
      this.indexedDB.delete(id, STORE_NAME);
    }
  }

  private handleMessageUpdated(data: { _id: string; hasThread?: boolean }): void {
    this.store.update(
      updateEntities(data._id, (entity) => ({
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
   * Get messages for current tag sorted by creation time
   * Excludes thread messages (those with threadId set)
   */
  messagesForTag = computed(() => {
    const tagId = this._currentTagId();
    if (!tagId) return [];
    return this.messages()
      .filter((m) => m.tagId === tagId && !m.threadId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });

  /**
   * Get unread count for a specific tag
   */
  getUnreadCount(tagId: string): number {
    return this._unreadCounts().find((c) => c.tagId === tagId)?.count || 0;
  }

  /**
   * Load messages for a tag
   */
  loadMessages(tagId: string, reset: boolean = true): Observable<Message[]> {
    if (reset) {
      this._currentTagId.set(tagId);
      this._hasMore.set(true);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ messages: Message[] }>(`/api/tags/${tagId}/messages`).pipe(
      tap((response) => {
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
        const message = err?.error?.error || 'Failed to load messages';
        this._error.set(message);
        this._isLoading.set(false);
        return of([]);
      }),
    );
  }

  /**
   * Load older messages (pagination)
   */
  loadMore(): Observable<Message[]> {
    const tagId = this._currentTagId();
    if (!tagId || !this._hasMore() || this._isLoading()) {
      return of([]);
    }

    const messages = this.messagesForTag();
    const oldestMessage = messages[0];
    if (!oldestMessage) {
      return of([]);
    }

    this._isLoading.set(true);

    return this.http
      .get<{ messages: Message[] }>(`/api/tags/${tagId}/messages`, {
        params: { before: oldestMessage._id },
      })
      .pipe(
        tap((response) => {
          this.store.update(upsertEntities(response.messages));
          this._hasMore.set(response.messages.length >= 50);
          this.persistToIndexedDB(response.messages);
          this._isLoading.set(false);
        }),
        map((response) => response.messages),
        catchError((err) => {
          this._error.set(err?.error?.error || 'Failed to load more messages');
          this._isLoading.set(false);
          return of([]);
        }),
      );
  }

  /**
   * Send a new message
   */
  sendMessage(
    tagId: string,
    content: NoteContent,
    options?: { threadId?: string; parentMessageId?: string },
  ): Observable<Message> {
    this._error.set(null);

    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const currentUser = this.authService.user();

    const tempMessage: Message = {
      _id: tempId,
      tagId,
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

    const body: { content: NoteContent; threadId?: string; parentMessageId?: string } = {
      content,
    };
    if (options?.threadId) {
      body.threadId = options.threadId;
    }
    if (options?.parentMessageId) {
      body.parentMessageId = options.parentMessageId;
    }

    return this.http.post<{ message: Message }>(`/api/tags/${tagId}/messages`, body).pipe(
      tap((response) => {
        this.store.update(deleteEntities(tempId));
        // Use upsert - message may already exist from WebSocket broadcast
        this.store.update(upsertEntities(response.message));
        this.persistToIndexedDB([response.message]);
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
  editMessage(id: string, content: NoteContent): Observable<Message> {
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
   * Mark tag as read
   */
  markAsRead(tagId: string): Observable<void> {
    return this.http.post<{ lastReadAt: string }>(`/api/tags/${tagId}/read`, {}).pipe(
      tap(() => {
        // Update local unread count
        const counts = this._unreadCounts().filter((c) => c.tagId !== tagId);
        this._unreadCounts.set(counts);
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
    this._currentTagId.set(null);
    this._hasMore.set(true);
  }

  /**
   * Send typing indicator
   */
  sendTyping(tagId: string, isTyping: boolean = true): void {
    this.realtime.sendTyping(tagId, isTyping);
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
