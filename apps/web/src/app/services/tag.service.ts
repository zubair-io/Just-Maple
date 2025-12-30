import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, throwError, of } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore } from '@ngneat/elf';
import {
  withEntities,
  withActiveId,
  selectAllEntities,
  selectActiveEntity,
  selectEntity,
  setEntities,
  addEntities,
  updateEntities,
  deleteEntities,
  upsertEntities,
  setActiveId,
  resetActiveId,
  getEntity,
  getAllEntities,
  getEntitiesCount,
  getActiveEntity,
} from '@ngneat/elf-entities';
import { IndexedDBService } from './indexed-db.service';
import { AuthService } from './auth.service';
import { NetworkService } from './network.service';
import { DB_STORES } from './db-stores';
import type {
  Tag,
  CreateTagInput,
  UpdateTagInput,
  AccessLevel,
  SharedWithEntry,
  TagMember,
} from '@maple/shared';

const STORE_NAME = DB_STORES.TAG;

@Injectable({ providedIn: 'root' })
export class TagService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly network = inject(NetworkService);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Tag, '_id'>({ idKey: '_id' }),
    withActiveId(),
  );

  // Observable selectors
  readonly tags$ = this.store.pipe(selectAllEntities());
  readonly activeTag$ = this.store.pipe(selectActiveEntity());

  // Signal wrappers for Angular reactivity
  private readonly _tagsSignal = toSignal(this.tags$, { initialValue: [] as Tag[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _opened = signal<string[]>([]); // Track opened folders

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly opened = this._opened.asReadonly();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();
    }
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<Tag>(STORE_NAME);
    if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
      this.store.update(setEntities(cached));
    }
  }

  /**
   * Get all tags as a reactive signal
   */
  tags(): Tag[] {
    return this._tagsSignal() ?? [];
  }

  /**
   * Load tags from API
   */
  loadTags(): Observable<Tag[]> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ tags: Tag[] }>('/api/tags').pipe(
      tap((response) => {
        this.store.update(setEntities(response.tags));
        this.persistToIndexedDB(response.tags);
        this._isLoading.set(false);
      }),
      map((response) => response.tags),
      catchError((err) => {
        let message = err?.error?.error || 'Failed to load tags';

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
   * Create a new tag with optimistic update
   */
  createTag(data: CreateTagInput): Observable<Tag> {
    this._isLoading.set(true);
    this._error.set(null);

    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const currentUserId = this.authService.user()?._id ?? 'temp';
    const tempTag: Tag = {
      _id: tempId,
      type: 'folder',
      value: data.value || 'mixed',
      label: data.label,
      sharing: {
        sharedWith: [{ userId: currentUserId, accessLevel: 'owner' }],
        isPublic: false,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.store.update(addEntities(tempTag));

    return this.http.post<{ tag: Tag }>('/api/tags', data).pipe(
      tap((response) => {
        this.store.update(deleteEntities(tempId));
        this.store.update(addEntities(response.tag));
        this.persistToIndexedDB([response.tag]);
        this._isLoading.set(false);
      }),
      map((response) => response.tag),
      catchError((err) => {
        this.store.update(deleteEntities(tempId));
        const message = err?.error?.error || 'Failed to create tag';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Update a tag with optimistic update
   */
  updateTag(id: string, data: UpdateTagInput): Observable<Tag> {
    this._isLoading.set(true);
    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Tag not found'));
    }

    this.store.update(
      updateEntities(id, (entity) => ({
        ...entity,
        ...data,
        updatedAt: new Date().toISOString(),
      })),
    );

    return this.http.put<{ tag: Tag }>(`/api/tags/${id}`, data).pipe(
      tap((response) => {
        this.store.update(updateEntities(id, () => response.tag));
        this.persistToIndexedDB([response.tag]);
        this._isLoading.set(false);
      }),
      map((response) => response.tag),
      catchError((err) => {
        this.store.update(updateEntities(id, () => original));
        const message = err?.error?.error || 'Failed to update tag';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Delete a tag with optimistic update
   */
  deleteTag(id: string): Observable<void> {
    this._isLoading.set(true);
    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Tag not found'));
    }

    this.store.update(deleteEntities(id));

    return this.http.delete(`/api/tags/${id}`).pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(id, STORE_NAME);
        }
        this._isLoading.set(false);
      }),
      map(() => undefined),
      catchError((err) => {
        this.store.update(addEntities(original));
        const message = err?.error?.error || 'Failed to delete tag';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Get tag by ID synchronously
   */
  getTagById(id: string): Tag | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Select a tag as active
   */
  setActiveTag(id: string | null): void {
    if (id) {
      this.store.update(setActiveId(id));
    } else {
      this.store.update(resetActiveId());
    }
  }

  /**
   * Get active tag synchronously
   */
  getActiveTag(): Tag | undefined {
    return this.store.query(getActiveEntity());
  }

  /**
   * Select a single tag as observable
   */
  select(id: string): Observable<Tag | undefined> {
    return this.store.pipe(selectEntity(id));
  }

  /**
   * Open a folder/tag
   */
  openTag(id: string): void {
    this._opened.update((ids) => {
      if (ids.includes(id)) return ids;
      return [...ids, id];
    });
  }

  /**
   * Close a folder/tag
   */
  closeTag(id: string): void {
    this._opened.update((ids) => ids.filter((i) => i !== id));
  }

  /**
   * Toggle folder open/closed
   */
  toggleTag(id: string): void {
    if (this._opened().includes(id)) {
      this.closeTag(id);
    } else {
      this.openTag(id);
    }
  }

  /**
   * Ensure default tag exists - loads tags from API and creates a default if none exist
   * Only creates a default tag if API succeeds and returns no tags
   */
  ensureDefaultTag(): Observable<void> {
    return this.loadTags().pipe(
      map((loadedTags) => {
        // Only create default tag if API succeeded (no error) and returned no tags
        if (loadedTags.length === 0 && !this._error()) {
          this.createTag({ label: 'General' }).subscribe({
            error: (err) => console.warn('Could not create default tag:', err),
          });
        }
      }),
    );
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    this.store.update(setEntities([]));
    this.store.update(resetActiveId());

    if (isPlatformBrowser(this.platformId)) {
      await this.indexedDB.clear(STORE_NAME);
    }
  }

  private async persistToIndexedDB(tags: Tag[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || tags.length === 0) return;
    await this.indexedDB.putMany(tags, STORE_NAME);
  }

  // ============ Sharing Methods ============

  /**
   * Get current user's access level for a tag
   */
  getAccessLevel(tag: Tag): AccessLevel | null {
    const currentUserId = this.authService.user()?._id;
    if (!currentUserId) return null;

    const entry = tag.sharing.sharedWith.find((e) => e.userId === currentUserId);
    if (entry) return entry.accessLevel;
    if (tag.sharing.isPublic) return 'read';
    return null;
  }

  /**
   * Check if current user is owner of a tag
   */
  isOwner(tag: Tag): boolean {
    return this.getAccessLevel(tag) === 'owner';
  }

  /**
   * Check if current user can write to a tag
   */
  canWrite(tag: Tag): boolean {
    const level = this.getAccessLevel(tag);
    return level === 'owner' || level === 'write';
  }

  /**
   * Get tag members
   */
  getMembers(tagId: string): Observable<SharedWithEntry[]> {
    return this.http.get<{ members: SharedWithEntry[] }>(`/api/tags/${tagId}/members`).pipe(
      map((response) => response.members),
      catchError(() => of([])),
    );
  }

  /**
   * Fetch tag members with full user data
   */
  fetchTagMembers(tagId: string): Observable<TagMember[]> {
    return this.http.get<{ members: TagMember[] }>(`/api/tags/${tagId}/members`).pipe(
      map((response) => response.members),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Failed to fetch tag members';
        console.error('[TagService] Failed to fetch members:', message);
        return of([]); // Return empty array on error
      }),
    );
  }

  /**
   * Share tag with a user by email
   */
  shareTag(tagId: string, email: string, accessLevel: 'read' | 'write'): Observable<Tag> {
    return this.http.post<{ tag: Tag }>(`/api/tags/${tagId}/share`, { email, accessLevel }).pipe(
      tap((response) => {
        this.store.update(updateEntities(tagId, () => response.tag));
        this.persistToIndexedDB([response.tag]);
      }),
      map((response) => response.tag),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Failed to share tag';
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Remove user's access to tag
   */
  unshareTag(tagId: string, userId: string): Observable<Tag> {
    return this.http.delete<{ tag: Tag }>(`/api/tags/${tagId}/share/${userId}`).pipe(
      tap((response) => {
        this.store.update(updateEntities(tagId, () => response.tag));
        this.persistToIndexedDB([response.tag]);
      }),
      map((response) => response.tag),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Failed to remove access';
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Update tag's public status
   */
  setPublic(tagId: string, isPublic: boolean): Observable<Tag> {
    return this.http.put<{ tag: Tag }>(`/api/tags/${tagId}/public`, { isPublic }).pipe(
      tap((response) => {
        this.store.update(updateEntities(tagId, () => response.tag));
        this.persistToIndexedDB([response.tag]);
      }),
      map((response) => response.tag),
      catchError((err) => {
        const message =
          err?.error?.message || err?.error?.error || 'Failed to update public status';
        return throwError(() => new Error(message));
      }),
    );
  }
}
