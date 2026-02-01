import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { IndexedDBService } from '../indexed-db.service';
import { DB_STORES } from '../db-stores';
import type { CachedEmail, GmailSyncState, GmailDraft, GmailFilter } from '@maple/shared';

/**
 * Service for storing and querying Gmail data in IndexedDB.
 * All email content is stored locally and never sent to the server.
 */
@Injectable({ providedIn: 'root' })
export class GmailStorageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly indexedDB = inject(IndexedDBService);

  // In-memory cache of emails for fast access
  private readonly _emails = signal<CachedEmail[]>([]);
  private readonly _syncState = signal<GmailSyncState | null>(null);
  private readonly _drafts = signal<GmailDraft[]>([]);

  readonly emails = this._emails.asReadonly();
  readonly syncState = this._syncState.asReadonly();
  readonly drafts = this._drafts.asReadonly();

  // Computed signals for filtered views
  readonly unreadCount = computed(() => this._emails().filter((e) => !e.isRead).length);
  readonly starredCount = computed(() => this._emails().filter((e) => e.isStarred).length);

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

    // Sort emails by date (newest first)
    emails.sort((a, b) => b.internalDate - a.internalDate);

    this._emails.set(emails);
    this._syncState.set(syncStates[0] || null);
    this._drafts.set(drafts);
  }

  /**
   * Store emails in IndexedDB and update cache.
   */
  async storeEmails(emails: CachedEmail[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || emails.length === 0) return;

    await this.indexedDB.putMany(emails, DB_STORES.GMAIL_EMAILS);

    // Update in-memory cache
    this._emails.update((current) => {
      const emailMap = new Map(current.map((e) => [e.id, e]));
      for (const email of emails) {
        emailMap.set(email.id, email);
      }
      const updated = Array.from(emailMap.values());
      updated.sort((a, b) => b.internalDate - a.internalDate);
      return updated;
    });
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
    return this._emails().find((e) => e.id === id);
  }

  /**
   * Get emails by thread ID.
   */
  getEmailsByThread(threadId: string): CachedEmail[] {
    return this._emails()
      .filter((e) => e.threadId === threadId)
      .sort((a, b) => a.internalDate - b.internalDate);
  }

  /**
   * Get emails matching a filter.
   */
  getFilteredEmails(filter: GmailFilter): CachedEmail[] {
    const emails = this._emails();

    switch (filter.type) {
      case 'all':
        return emails;

      case 'label':
        const labelId = typeof filter.value === 'string' ? filter.value : filter.value[0];
        return emails.filter((e) => e.labelIds.includes(labelId));

      case 'sender':
        const senders = Array.isArray(filter.value) ? filter.value : [filter.value];
        return emails.filter((e) => {
          const fromEmail = e.from.email.toLowerCase();
          return senders.some((s) => {
            if (s.startsWith('*@')) {
              // Wildcard domain match
              const domain = s.slice(2).toLowerCase();
              return fromEmail.endsWith(`@${domain}`);
            }
            return fromEmail === s.toLowerCase();
          });
        });

      case 'search':
        const query = (typeof filter.value === 'string' ? filter.value : '').toLowerCase();
        return emails.filter(
          (e) =>
            e.subject.toLowerCase().includes(query) ||
            e.snippet.toLowerCase().includes(query) ||
            e.from.email.toLowerCase().includes(query) ||
            e.from.name?.toLowerCase().includes(query),
        );

      default:
        return emails;
    }
  }

  /**
   * Search emails by query string.
   */
  searchEmails(query: string): CachedEmail[] {
    if (!query.trim()) return this._emails();

    const lowerQuery = query.toLowerCase();
    return this._emails().filter(
      (e) =>
        e.subject.toLowerCase().includes(lowerQuery) ||
        e.snippet.toLowerCase().includes(lowerQuery) ||
        e.bodyText?.toLowerCase().includes(lowerQuery) ||
        e.from.email.toLowerCase().includes(lowerQuery) ||
        e.from.name?.toLowerCase().includes(lowerQuery) ||
        e.to.some(
          (addr) =>
            addr.email.toLowerCase().includes(lowerQuery) ||
            addr.name?.toLowerCase().includes(lowerQuery),
        ),
    );
  }

  /**
   * Delete emails from cache and storage.
   */
  async deleteEmails(ids: string[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    for (const id of ids) {
      await this.indexedDB.delete(id, DB_STORES.GMAIL_EMAILS);
    }

    this._emails.update((current) => current.filter((e) => !ids.includes(e.id)));
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
    this._drafts.update((current) => {
      const existing = current.findIndex((d) => d.id === draft.id);
      if (existing >= 0) {
        const updated = [...current];
        updated[existing] = draft;
        return updated;
      }
      return [...current, draft];
    });
  }

  /**
   * Get a draft by ID.
   */
  getDraft(id: string): GmailDraft | undefined {
    return this._drafts().find((d) => d.id === id);
  }

  /**
   * Get drafts for a Gmail page.
   */
  getDraftsForPage(pageId: string): GmailDraft[] {
    return this._drafts().filter((d) => d.pageId === pageId);
  }

  /**
   * Delete a draft.
   */
  async deleteDraft(id: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    await this.indexedDB.delete(id, DB_STORES.GMAIL_DRAFTS);
    this._drafts.update((current) => current.filter((d) => d.id !== id));
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

    this._emails.set([]);
    this._syncState.set(null);
    this._drafts.set([]);
  }

  /**
   * Get email count statistics.
   */
  getStats(): { total: number; unread: number; starred: number } {
    const emails = this._emails();
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
    return this._emails().filter((e) => e.labelIds.includes(labelId));
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
    return this._emails().filter((e) => e.isStarred);
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
    return this._emails().filter((e) => !e.isRead);
  }
}
