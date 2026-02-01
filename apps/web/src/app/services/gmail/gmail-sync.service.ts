import { Injectable, inject, signal } from '@angular/core';
import { Observable, from, of, throwError, forkJoin } from 'rxjs';
import { map, switchMap, tap, catchError, finalize } from 'rxjs/operators';
import { GmailApiService } from './gmail-api.service';
import { GmailAuthService } from './gmail-auth.service';
import { GmailStorageService } from './gmail-storage.service';
import type { GmailSyncState, GmailSyncDepth, CachedEmail } from '@maple/shared';

/**
 * Service for syncing Gmail messages with local IndexedDB storage.
 * Handles initial sync, incremental sync, and real-time updates.
 */
@Injectable({ providedIn: 'root' })
export class GmailSyncService {
  private readonly api = inject(GmailApiService);
  private readonly auth = inject(GmailAuthService);
  private readonly storage = inject(GmailStorageService);

  // Sync state signals
  private readonly _isSyncing = signal(false);
  private readonly _syncProgress = signal(0);
  private readonly _lastSyncAt = signal<Date | null>(null);
  private readonly _syncError = signal<string | null>(null);

  readonly isSyncing = this._isSyncing.asReadonly();
  readonly syncProgress = this._syncProgress.asReadonly();
  readonly lastSyncAt = this._lastSyncAt.asReadonly();
  readonly syncError = this._syncError.asReadonly();

  /**
   * Perform initial sync for a new connection.
   * Fetches emails based on sync depth configuration.
   */
  initialSync(syncDepth: GmailSyncDepth = '30d'): Observable<void> {
    if (!this.auth.isConnected()) {
      return throwError(() => new Error('Gmail not connected'));
    }

    this._isSyncing.set(true);
    this._syncProgress.set(0);
    this._syncError.set(null);

    const daysMap: Record<GmailSyncDepth, number> = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
    };
    const days = daysMap[syncDepth];
    const after = Math.floor(Date.now() / 1000 - days * 24 * 60 * 60);
    const query = `after:${after}`;

    return this.fetchAllMessages(query).pipe(
      switchMap((emails) => from(this.storage.storeEmails(emails)).pipe(map(() => emails))),
      switchMap((emails) => {
        // Get the latest historyId for incremental sync
        const latestEmail = emails.reduce(
          (latest, e) => (e.internalDate > (latest?.internalDate || 0) ? e : latest),
          null as CachedEmail | null,
        );

        const syncState: GmailSyncState = {
          accountEmail: this.auth.connectedEmail() || '',
          lastSyncAt: new Date().toISOString(),
          historyId: undefined, // Will be set on next incremental sync
          status: 'idle',
        };

        return from(this.storage.storeSyncState(syncState));
      }),
      tap(() => {
        this._lastSyncAt.set(new Date());
      }),
      catchError((error) => {
        this._syncError.set(error.message);
        return throwError(() => error);
      }),
      finalize(() => {
        this._isSyncing.set(false);
        this._syncProgress.set(100);
      }),
    );
  }

  /**
   * Perform incremental sync using Gmail history API.
   */
  incrementalSync(): Observable<void> {
    if (!this.auth.isConnected()) {
      return throwError(() => new Error('Gmail not connected'));
    }

    const syncState = this.storage.syncState();
    if (!syncState?.historyId) {
      // No history ID - do initial sync instead
      return this.initialSync();
    }

    this._isSyncing.set(true);
    this._syncError.set(null);

    return this.api.getHistory(syncState.historyId).pipe(
      switchMap((historyResponse) => {
        const addedMessageIds: string[] = [];
        const deletedMessageIds: string[] = [];
        const modifiedMessageIds: string[] = [];

        historyResponse.history?.forEach((h) => {
          h.messagesAdded?.forEach((m) => addedMessageIds.push(m.message.id));
          h.messagesDeleted?.forEach((m) => deletedMessageIds.push(m.message.id));
          h.labelsAdded?.forEach((m) => modifiedMessageIds.push(m.message.id));
          h.labelsRemoved?.forEach((m) => modifiedMessageIds.push(m.message.id));
        });

        // Remove duplicates
        const uniqueAdded = [...new Set(addedMessageIds)];
        const uniqueModified = [...new Set(modifiedMessageIds)];
        const uniqueDeleted = [...new Set(deletedMessageIds)];

        const operations: Observable<unknown>[] = [];

        // Fetch new and modified messages
        const toFetch = [...new Set([...uniqueAdded, ...uniqueModified])];
        if (toFetch.length > 0) {
          operations.push(
            this.api
              .getMessages(toFetch)
              .pipe(switchMap((emails) => from(this.storage.storeEmails(emails)))),
          );
        }

        // Delete removed messages
        if (uniqueDeleted.length > 0) {
          operations.push(from(this.storage.deleteEmails(uniqueDeleted)));
        }

        if (operations.length === 0) {
          return of(undefined);
        }

        return forkJoin(operations).pipe(map(() => historyResponse.historyId));
      }),
      switchMap((newHistoryId) => {
        if (newHistoryId) {
          const updatedState: GmailSyncState = {
            ...syncState,
            historyId: newHistoryId,
            lastSyncAt: new Date().toISOString(),
            status: 'idle',
          };
          return from(this.storage.storeSyncState(updatedState));
        }
        return of(undefined);
      }),
      tap(() => {
        this._lastSyncAt.set(new Date());
      }),
      catchError((error) => {
        // If historyId is expired, do full sync
        if (error.message?.includes('historyId')) {
          return this.initialSync();
        }
        this._syncError.set(error.message);
        return throwError(() => error);
      }),
      finalize(() => {
        this._isSyncing.set(false);
      }),
    );
  }

  /**
   * Manual refresh - fetches recent messages.
   */
  refresh(): Observable<void> {
    if (!this.auth.isConnected()) {
      return throwError(() => new Error('Gmail not connected'));
    }

    this._isSyncing.set(true);
    this._syncError.set(null);

    // Fetch last 50 messages for quick refresh
    return this.api.listMessages({ maxResults: 50 }).pipe(
      switchMap((response) => {
        const messageIds = response.messages?.map((m) => m.id) || [];
        if (messageIds.length === 0) return of([]);
        return this.api.getMessages(messageIds);
      }),
      switchMap((emails) => from(this.storage.storeEmails(emails))),
      tap(() => {
        this._lastSyncAt.set(new Date());
      }),
      catchError((error) => {
        this._syncError.set(error.message);
        return throwError(() => error);
      }),
      finalize(() => {
        this._isSyncing.set(false);
      }),
    );
  }

  /**
   * Fetch a single message and add to cache.
   */
  fetchMessage(messageId: string): Observable<CachedEmail> {
    return this.api.getMessage(messageId).pipe(
      tap((email) => {
        this.storage.storeEmail(email);
      }),
    );
  }

  /**
   * Fetch all messages matching a query (paginated).
   */
  private fetchAllMessages(query: string): Observable<CachedEmail[]> {
    const allEmails: CachedEmail[] = [];
    let totalFetched = 0;

    const fetchPage = (pageToken?: string): Observable<CachedEmail[]> => {
      return this.api.listMessages({ query, maxResults: 100, pageToken }).pipe(
        switchMap((response) => {
          const messageIds = response.messages?.map((m) => m.id) || [];
          if (messageIds.length === 0) {
            return of([]);
          }

          return this.api.getMessages(messageIds).pipe(
            switchMap((emails) => {
              allEmails.push(...emails);
              totalFetched += emails.length;

              // Update progress (estimate based on result size)
              const estimated = response.resultSizeEstimate || totalFetched;
              this._syncProgress.set(Math.min(95, (totalFetched / estimated) * 100));

              if (response.nextPageToken) {
                return fetchPage(response.nextPageToken);
              }
              return of(allEmails);
            }),
          );
        }),
      );
    };

    return fetchPage();
  }

  /**
   * Sync a specific email's state (after action like mark read).
   */
  syncEmailState(messageId: string): Observable<void> {
    return this.api
      .getMessage(messageId)
      .pipe(switchMap((email) => from(this.storage.storeEmail(email))));
  }

  /**
   * Mark message as read and sync state.
   */
  markAsRead(messageId: string): Observable<void> {
    // Optimistic update
    this.storage.updateEmail(messageId, { isRead: true });

    return this.api.markAsRead(messageId).pipe(
      catchError((error) => {
        // Revert on error
        this.storage.updateEmail(messageId, { isRead: false });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Mark message as unread and sync state.
   */
  markAsUnread(messageId: string): Observable<void> {
    this.storage.updateEmail(messageId, { isRead: false });

    return this.api.markAsUnread(messageId).pipe(
      catchError((error) => {
        this.storage.updateEmail(messageId, { isRead: true });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Star a message.
   */
  starMessage(messageId: string): Observable<void> {
    this.storage.updateEmail(messageId, { isStarred: true });

    return this.api.starMessage(messageId).pipe(
      catchError((error) => {
        this.storage.updateEmail(messageId, { isStarred: false });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Unstar a message.
   */
  unstarMessage(messageId: string): Observable<void> {
    this.storage.updateEmail(messageId, { isStarred: false });

    return this.api.unstarMessage(messageId).pipe(
      catchError((error) => {
        this.storage.updateEmail(messageId, { isStarred: true });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Archive a message.
   */
  archiveMessage(messageId: string): Observable<void> {
    const email = this.storage.getEmail(messageId);
    if (!email) return of(undefined);

    const originalLabels = email.labelIds;
    this.storage.updateEmail(messageId, {
      labelIds: originalLabels.filter((l) => l !== 'INBOX'),
    });

    return this.api.archiveMessage(messageId).pipe(
      catchError((error) => {
        this.storage.updateEmail(messageId, { labelIds: originalLabels });
        return throwError(() => error);
      }),
    );
  }

  /**
   * Move message to trash.
   */
  trashMessage(messageId: string): Observable<void> {
    // Remove from local cache
    return this.api
      .trashMessage(messageId)
      .pipe(switchMap(() => from(this.storage.deleteEmails([messageId]))));
  }

  /**
   * Permanently delete a message.
   */
  deleteMessage(messageId: string): Observable<void> {
    return this.api
      .deleteMessage(messageId)
      .pipe(switchMap(() => from(this.storage.deleteEmails([messageId]))));
  }
}
