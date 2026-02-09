import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createStore } from '@ngneat/elf';
import {
  withEntities,
  selectAllEntities,
  setEntities,
  upsertEntities,
  deleteEntities,
  selectEntity,
} from '@ngneat/elf-entities';
import { toSignal } from '@angular/core/rxjs-interop';
import { IndexedDBService } from '../indexed-db.service';
import { DB_STORES } from '../db-stores';
import type { CachedEmail, GmailSyncState, GmailDraft, GmailFilter } from '@maple/shared';

const STORE_NAME = 'gmail_emails';
const DRAFTS_STORE_NAME = 'gmail_drafts';

/**
 * Service for storing and querying Gmail data in IndexedDB.
 * All email content is stored locally and never sent to the server.
 *
 * Uses Elf store for reactive state management, following the same
 * pattern as NotificationService and MessageService.
 */
@Injectable({ providedIn: 'root' })
export class GmailStorageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly indexedDB = inject(IndexedDBService);

  // Elf Store for emails
  private readonly emailStore = createStore(
    { name: STORE_NAME },
    withEntities<CachedEmail, 'id'>({ idKey: 'id' }),
  );

  // Elf Store for drafts
  private readonly draftsStore = createStore(
    { name: DRAFTS_STORE_NAME },
    withEntities<GmailDraft, 'id'>({ idKey: 'id' }),
  );

  // Observable selectors from Elf
  private readonly emails$ = this.emailStore.pipe(selectAllEntities());
  private readonly drafts$ = this.draftsStore.pipe(selectAllEntities());

  // Signal wrappers for Elf stores
  private readonly _emailsSignal = toSignal(this.emails$, {
    initialValue: [] as CachedEmail[],
  });
  private readonly _draftsSignal = toSignal(this.drafts$, {
    initialValue: [] as GmailDraft[],
  });

  // Sync state (not in Elf since it's a single value, not entities)
  private readonly _syncState = signal<GmailSyncState | null>(null);

  // Public signals - sorted by date (newest first)
  readonly emails = computed(() => {
    const emails = this._emailsSignal() ?? [];
    return [...emails].sort((a, b) => b.internalDate - a.internalDate);
  });

  readonly syncState = this._syncState.asReadonly();

  readonly drafts = computed(() => this._draftsSignal() ?? []);

  // Computed signals for filtered views
  readonly unreadCount = computed(() => this.emails().filter((e) => !e.isRead).length);
  readonly starredCount = computed(() => this.emails().filter((e) => e.isStarred).length);

  /**
   * Initialize by loading cached data from IndexedDB.
   */
  async initialize(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const [emails, syncStates, drafts] = await Promise.all([
      this.indexedDB.getAll<CachedEmail>(DB_STORES.GMAIL_EMAILS),
      this.indexedDB.getAll<GmailSyncState>(DB_STORES.GMAIL_SYNC_STATE),
      this.indexedDB.getAll<GmailDraft>(DB_STORES.GMAIL_DRAFTS),
    ]);

    // Hydrate Elf stores from IndexedDB
    this.emailStore.update(setEntities(emails));
    this.draftsStore.update(setEntities(drafts));
    this._syncState.set(syncStates[0] || null);
  }

  /**
   * Store emails in IndexedDB and update Elf store.
   */
  async storeEmails(emails: CachedEmail[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || emails.length === 0) return;

    await this.indexedDB.putMany(emails, DB_STORES.GMAIL_EMAILS);

    // Update Elf store (upsertEntities handles insert/update)
    this.emailStore.update(upsertEntities(emails));
  }

  /**
   * Store a single email.
   */
  async storeEmail(email: CachedEmail): Promise<void> {
    return this.storeEmails([email]);
  }

  /**
   * Get a single email by ID.
   */
  getEmail(id: string): CachedEmail | undefined {
    return this.emails().find((e) => e.id === id);
  }

  /**
   * Get emails by thread ID.
   */
  getEmailsByThread(threadId: string): CachedEmail[] {
    return this.emails()
      .filter((e) => e.threadId === threadId)
      .sort((a, b) => a.internalDate - b.internalDate);
  }

  /**
   * Get emails matching a filter.
   */
  getFilteredEmails(filter: GmailFilter): CachedEmail[] {
    const emails = this.emails();

    switch (filter.type) {
      case 'all':
        return emails;

      case 'label': {
        const labelId = typeof filter.value === 'string' ? filter.value : filter.value[0];
        return emails.filter((e) => e.labelIds.includes(labelId));
      }

      case 'sender': {
        const senders = Array.isArray(filter.value) ? filter.value : [filter.value];
        return emails.filter((e) => {
          const fromEmail = e.from.email.toLowerCase();
          return senders.some((s: string) => {
            if (s.startsWith('*@')) {
              // Wildcard domain match
              const domain = s.slice(2).toLowerCase();
              return fromEmail.endsWith(`@${domain}`);
            }
            return fromEmail === s.toLowerCase();
          });
        });
      }

      case 'search': {
        const query = (typeof filter.value === 'string' ? filter.value : '').toLowerCase();
        return emails.filter(
          (e) =>
            e.subject.toLowerCase().includes(query) ||
            e.snippet.toLowerCase().includes(query) ||
            e.from.email.toLowerCase().includes(query) ||
            e.from.name?.toLowerCase().includes(query),
        );
      }

      default:
        return emails;
    }
  }

  /**
   * Search emails by query string.
   */
  searchEmails(query: string): CachedEmail[] {
    if (!query.trim()) return this.emails();

    const lowerQuery = query.toLowerCase();
    return this.emails().filter(
      (e) =>
        e.subject.toLowerCase().includes(lowerQuery) ||
        e.snippet.toLowerCase().includes(lowerQuery) ||
        e.bodyText?.toLowerCase().includes(lowerQuery) ||
        e.from.email.toLowerCase().includes(lowerQuery) ||
        e.from.name?.toLowerCase().includes(lowerQuery) ||
        e.to.some(
          (addr: { email: string; name?: string }) =>
            addr.email.toLowerCase().includes(lowerQuery) ||
            addr.name?.toLowerCase().includes(lowerQuery),
        ),
    );
  }

  /**
   * Delete emails from Elf store and storage.
   */
  async deleteEmails(ids: string[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    for (const id of ids) {
      await this.indexedDB.delete(id, DB_STORES.GMAIL_EMAILS);
    }

    // Update Elf store
    this.emailStore.update(deleteEntities(ids));
  }

  /**
   * Update an email's properties (e.g., isRead, isStarred).
   */
  async updateEmail(id: string, updates: Partial<CachedEmail>): Promise<void> {
    const email = this.getEmail(id);
    if (!email) return;

    const updated = { ...email, ...updates, cachedAt: new Date().toISOString() };
    await this.storeEmail(updated);
  }

  /**
   * Store sync state.
   */
  async storeSyncState(state: GmailSyncState): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await this.indexedDB.put(state, DB_STORES.GMAIL_SYNC_STATE);
    this._syncState.set(state);
  }

  /**
   * Get sync state for an account.
   */
  async getSyncState(accountEmail: string): Promise<GmailSyncState | null> {
    if (!isPlatformBrowser(this.platformId)) return null;

    const state = await this.indexedDB.get<GmailSyncState>(
      accountEmail,
      DB_STORES.GMAIL_SYNC_STATE,
    );
    return state || null;
  }

  /**
   * Store a draft.
   */
  async storeDraft(draft: GmailDraft): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await this.indexedDB.put(draft, DB_STORES.GMAIL_DRAFTS);
    this.draftsStore.update(upsertEntities([draft]));
  }

  /**
   * Get a draft by ID.
   */
  getDraft(id: string): GmailDraft | undefined {
    return this.drafts().find((d) => d.id === id);
  }

  /**
   * Get drafts for a Gmail page.
   */
  getDraftsForPage(pageId: string): GmailDraft[] {
    return this.drafts().filter((d) => d.pageId === pageId);
  }

  /**
   * Delete a draft.
   */
  async deleteDraft(id: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await this.indexedDB.delete(id, DB_STORES.GMAIL_DRAFTS);
    this.draftsStore.update(deleteEntities([id]));
  }

  /**
   * Clear all Gmail data (for disconnect).
   */
  async clearAll(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await Promise.all([
      this.indexedDB.clear(DB_STORES.GMAIL_EMAILS),
      this.indexedDB.clear(DB_STORES.GMAIL_SYNC_STATE),
      this.indexedDB.clear(DB_STORES.GMAIL_DRAFTS),
    ]);

    this.emailStore.update(setEntities([]));
    this.draftsStore.update(setEntities([]));
    this._syncState.set(null);
  }

  /**
   * Get email count statistics.
   */
  getStats(): { total: number; unread: number; starred: number } {
    const emails = this.emails();
    return {
      total: emails.length,
      unread: emails.filter((e) => !e.isRead).length,
      starred: emails.filter((e) => e.isStarred).length,
    };
  }

  /**
   * Get emails by label.
   */
  getEmailsByLabel(labelId: string): CachedEmail[] {
    return this.emails().filter((e) => e.labelIds.includes(labelId));
  }

  /**
   * Get inbox emails.
   */
  getInboxEmails(): CachedEmail[] {
    return this.getEmailsByLabel('INBOX');
  }

  /**
   * Get starred emails.
   */
  getStarredEmails(): CachedEmail[] {
    return this.emails().filter((e) => e.isStarred);
  }

  /**
   * Get sent emails.
   */
  getSentEmails(): CachedEmail[] {
    return this.getEmailsByLabel('SENT');
  }

  /**
   * Get unread emails.
   */
  getUnreadEmails(): CachedEmail[] {
    return this.emails().filter((e) => !e.isRead);
  }
}
