import { Injectable, inject, PLATFORM_ID, signal, computed, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, throwError, of, switchMap, ReplaySubject } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore, filterNil } from '@ngneat/elf';
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
import { VisibilityService } from './visibility.service';
import { DB_STORES } from './db-stores';
import {
  isLocalNotebook,
  type ProviderCapabilities,
  API_CAPABILITIES,
  LOCAL_FS_CAPABILITIES,
} from '../providers/data-provider.interface';
import { FileSystemNotebookProvider } from '../providers/filesystem-data.provider';
import { FileSystemService } from './file-system.service';
import type {
  Notebook,
  CreateNotebookInput,
  UpdateNotebookInput,
  AccessLevel,
  SharedWithEntry,
  NotebookMember,
} from '@maple/shared';

const STORE_NAME = DB_STORES.NOTEBOOK;

@Injectable({ providedIn: 'root' })
export class NotebookService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly network = inject(NetworkService);
  private readonly visibilityService = inject(VisibilityService);
  private readonly fsProvider = inject(FileSystemNotebookProvider);
  private readonly fsService = inject(FileSystemService);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Notebook, '_id'>({ idKey: '_id' }),
    withActiveId(),
  );

  // Observable selectors
  readonly notebooks$ = this.store.pipe(selectAllEntities());
  readonly activeNotebook$ = this.store.pipe(selectActiveEntity()).pipe(filterNil());

  // Signal wrappers for Angular reactivity
  private readonly _notebooksSignal = toSignal(this.notebooks$, { initialValue: [] as Notebook[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _opened = signal<string[]>([]); // Track opened folders

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly opened = this._opened.asReadonly();

  // Initialization state: resolves after IndexedDB hydration completes
  private readonly _cacheReady$ = new ReplaySubject<void>(1);
  readonly cacheReady$ = this._cacheReady$.asObservable();

  // Resolves after the first HTTP fetch completes (success or error)
  private readonly _httpReady$ = new ReplaySubject<void>(1);
  readonly httpReady$ = this._httpReady$.asObservable();

  /** Whether local file system notebooks are supported on this platform */
  readonly isLocalFSSupported = this.fsService.isSupported;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();

      // Refresh notebooks when document becomes visible (user returns to tab)
      this.visibilityService.becameVisible$.pipe(switchMap(() => this.loadNotebooks())).subscribe();

      // Sync local folders into the store when they change
      effect(() => {
        const folders = this.fsService.openFolders();
        this.syncLocalFolders();
      });
    }
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    try {
      const cached = await this.indexedDB.getAll<Notebook>(STORE_NAME);
      if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
        const normalized = cached.map((n) => ({
          ...n,
          sharing: n.sharing ?? { sharedWith: [], isPublic: false },
        }));
        this.store.update(setEntities(normalized));
      }
    } finally {
      this._cacheReady$.next();
      this._cacheReady$.complete();
    }
  }

  /**
   * Sync local file system folders into the Elf store as notebooks.
   * Called reactively when open folders change.
   */
  private syncLocalFolders(): void {
    this.fsProvider.loadNotebooks().subscribe((localNotebooks) => {
      // Remove stale local notebooks from store
      const current = this.store.query(getAllEntities());
      const staleLocalIds = current
        .filter((n) => isLocalNotebook(n._id))
        .filter((n) => !localNotebooks.find((ln) => ln._id === n._id))
        .map((n) => n._id);

      if (staleLocalIds.length > 0) {
        this.store.update(deleteEntities(staleLocalIds));
      }

      // Upsert current local notebooks
      if (localNotebooks.length > 0) {
        this.store.update(upsertEntities(localNotebooks));
      }
    });
  }

  /**
   * Get all notebooks as a reactive signal
   */
  notebooks(): Notebook[] {
    return this._notebooksSignal();
  }

  /**
   * Get capabilities for a specific notebook.
   * Local notebooks have limited capabilities (no sharing, collaboration, etc.)
   */
  getCapabilities(notebookId: string): ProviderCapabilities {
    return isLocalNotebook(notebookId) ? LOCAL_FS_CAPABILITIES : API_CAPABILITIES;
  }

  /**
   * Check if a notebook is backed by the local file system
   */
  isLocal(notebookId: string): boolean {
    return isLocalNotebook(notebookId);
  }

  /**
   * Open a local folder as a notebook via file picker.
   * The folder will appear in the sidebar alongside API notebooks.
   */
  openLocalFolder(): Observable<Notebook | null> {
    return this.fsService.openFolderPicker().pipe(
      tap((folder) => {
        if (folder) {
          // Sync will happen via the effect, but also upsert immediately for responsiveness
          this.syncLocalFolders();
        }
      }),
      map((folder) => {
        if (!folder) return null;
        return this.store.query(getEntity(folder.id)) || null;
      }),
    );
  }

  /**
   * Close/remove a local folder notebook.
   * Does NOT delete the folder from disk.
   */
  closeLocalFolder(notebookId: string): void {
    this.fsService.closeFolder(notebookId);
    this.store.update(deleteEntities(notebookId));
  }

  /**
   * Load notebooks from API and merge with local file system notebooks
   */
  loadNotebooks(): Observable<Notebook[]> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ notebooks: Notebook[] }>('/api/notebooks').pipe(
      tap((response) => {
        // Keep local notebooks in the store, replace only API notebooks
        const localNotebooks = this.store
          .query(getAllEntities())
          .filter((n) => isLocalNotebook(n._id));
        this.store.update(setEntities([...response.notebooks, ...localNotebooks]));
        this.persistToIndexedDB(response.notebooks);
        this._isLoading.set(false);
        this._httpReady$.next();
        this._httpReady$.complete();
      }),
      map(() => {
        // Return all notebooks including local ones
        return this.store.query(getAllEntities());
      }),
      catchError((err) => {
        let message = err?.error?.error || 'Failed to load notebooks';

        // Network-aware error message
        if (!this.network.isOnline()) {
          message = 'Working offline - showing cached data';
        }

        this._error.set(message);
        this._isLoading.set(false);
        this._httpReady$.next();
        this._httpReady$.complete();

        // Return cached data instead of empty array
        const cached = this.store.query(getAllEntities());
        return of(cached);
      }),
    );
  }

  /**
   * Create a new notebook with optimistic update
   */
  createNotebook(data: CreateNotebookInput): Observable<Notebook> {
    this._isLoading.set(true);
    this._error.set(null);

    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const currentUserId = this.authService.user()?._id ?? 'temp';
    const tempNotebook: Notebook = {
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

    this.store.update(addEntities(tempNotebook));

    return this.http.post<{ notebook: Notebook }>('/api/notebooks', data).pipe(
      tap((response) => {
        this.store.update(deleteEntities(tempId));
        this.store.update(addEntities(response.notebook));
        this.persistToIndexedDB([response.notebook]);
        this._isLoading.set(false);
      }),
      map((response) => response.notebook),
      catchError((err) => {
        this.store.update(deleteEntities(tempId));
        const message = err?.error?.error || 'Failed to create notebook';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Update a notebook with optimistic update.
   * Routes to file system provider for local notebooks.
   */
  updateNotebook(id: string, data: UpdateNotebookInput): Observable<Notebook> {
    // Route local notebooks to file system provider
    if (isLocalNotebook(id)) {
      return this.fsProvider.updateNotebook(id, data).pipe(
        tap((notebook) => {
          this.store.update(updateEntities(id, () => notebook));
        }),
      );
    }

    this._isLoading.set(true);
    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Notebook not found'));
    }

    this.store.update(
      updateEntities(id, (entity) => ({
        ...entity,
        ...data,
        updatedAt: new Date().toISOString(),
      })),
    );

    return this.http.put<{ notebook: Notebook }>(`/api/notebooks/${id}`, data).pipe(
      tap((response) => {
        this.store.update(updateEntities(id, () => response.notebook));
        this.persistToIndexedDB([response.notebook]);
        this._isLoading.set(false);
      }),
      map((response) => response.notebook),
      catchError((err) => {
        this.store.update(updateEntities(id, () => original));
        const message = err?.error?.error || 'Failed to update notebook';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Delete a notebook with optimistic update.
   * For local notebooks, this closes the folder (doesn't delete from disk).
   */
  deleteNotebook(id: string): Observable<void> {
    // Route local notebooks to file system provider
    if (isLocalNotebook(id)) {
      this.store.update(deleteEntities(id));
      return this.fsProvider.deleteNotebook(id);
    }

    this._isLoading.set(true);
    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Notebook not found'));
    }

    this.store.update(deleteEntities(id));

    return this.http.delete(`/api/notebooks/${id}`).pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(id, STORE_NAME);
        }
        this._isLoading.set(false);
      }),
      map(() => undefined),
      catchError((err) => {
        this.store.update(addEntities(original));
        const message = err?.error?.error || 'Failed to delete notebook';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Get notebook by ID synchronously
   */
  getNotebookById(id: string): Notebook | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Select a notebook as active
   */
  setActiveNotebook(id: string | null): void {
    if (id) {
      this.store.update(setActiveId(id));
    } else {
      this.store.update(resetActiveId());
    }
  }

  /**
   * Get active notebook synchronously
   */
  getActiveNotebook(): Notebook | undefined {
    return this.store.query(getActiveEntity());
  }

  /**
   * Select a single notebook as observable
   */
  select(id: string): Observable<Notebook | undefined> {
    return this.store.pipe(selectEntity(id));
  }

  /**
   * Open a folder/notebook
   */
  openNotebook(id: string): void {
    this._opened.update((ids) => {
      if (ids.includes(id)) return ids;
      return [...ids, id];
    });
  }

  /**
   * Close a folder/notebook
   */
  closeNotebook(id: string): void {
    this._opened.update((ids) => ids.filter((i) => i !== id));
  }

  /**
   * Toggle folder open/closed
   */
  toggleNotebook(id: string): void {
    if (this._opened().includes(id)) {
      this.closeNotebook(id);
    } else {
      this.openNotebook(id);
    }
  }

  /**
   * Ensure default notebook exists - loads notebooks from API and creates a default if none exist
   * Only creates a default notebook if API succeeds and returns no notebooks
   */
  ensureDefaultNotebook(): Observable<void> {
    return this.loadNotebooks().pipe(
      map((loadedNotebooks) => {
        // Only create default notebook if API succeeded (no error) and returned no notebooks
        if (loadedNotebooks.length === 0 && !this._error()) {
          this.createNotebook({ label: 'General' }).subscribe({
            error: (err) => console.warn('Could not create default notebook:', err),
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

  private async persistToIndexedDB(notebooks: Notebook[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || notebooks.length === 0) return;
    await this.indexedDB.putMany(notebooks, STORE_NAME);
  }

  // ============ Sharing Methods ============

  /**
   * Get current user's access level for a notebook
   */
  getAccessLevel(notebook: Notebook): AccessLevel | null {
    const currentUserId = this.authService.user()?._id;
    if (!currentUserId) return null;

    const entry = notebook.sharing.sharedWith.find((e) => e.userId === currentUserId);
    if (entry) return entry.accessLevel;
    if (notebook.sharing.isPublic) return 'read';
    return null;
  }

  /**
   * Check if current user is owner of a notebook
   */
  isOwner(notebook: Notebook): boolean {
    return this.getAccessLevel(notebook) === 'owner';
  }

  /**
   * Check if current user can write to a notebook
   */
  canWrite(notebook: Notebook): boolean {
    const level = this.getAccessLevel(notebook);
    return level === 'owner' || level === 'write';
  }

  /**
   * Get notebook members
   */
  getMembers(notebookId: string): Observable<SharedWithEntry[]> {
    return this.http
      .get<{ members: SharedWithEntry[] }>(`/api/notebooks/${notebookId}/members`)
      .pipe(
        map((response) => response.members),
        catchError(() => of([])),
      );
  }

  /**
   * Fetch notebook members with full user data
   */
  fetchNotebookMembers(notebookId: string): Observable<NotebookMember[]> {
    return this.http
      .get<{ members: NotebookMember[] }>(`/api/notebooks/${notebookId}/members`)
      .pipe(
        map((response) => response.members),
        catchError((err) => {
          const message =
            err?.error?.message || err?.error?.error || 'Failed to fetch notebook members';
          console.error('[NotebookService] Failed to fetch members:', message);
          return of([]); // Return empty array on error
        }),
      );
  }

  /**
   * Share notebook with a user by email
   */
  shareNotebook(
    notebookId: string,
    email: string,
    accessLevel: 'read' | 'write',
  ): Observable<Notebook> {
    return this.http
      .post<{ notebook: Notebook }>(`/api/notebooks/${notebookId}/share`, { email, accessLevel })
      .pipe(
        tap((response) => {
          this.store.update(updateEntities(notebookId, () => response.notebook));
          this.persistToIndexedDB([response.notebook]);
        }),
        map((response) => response.notebook),
        catchError((err) => {
          const message = err?.error?.message || err?.error?.error || 'Failed to share notebook';
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Remove user's access to notebook
   */
  unshareNotebook(notebookId: string, userId: string): Observable<Notebook> {
    return this.http
      .delete<{ notebook: Notebook }>(`/api/notebooks/${notebookId}/share/${userId}`)
      .pipe(
        tap((response) => {
          this.store.update(updateEntities(notebookId, () => response.notebook));
          this.persistToIndexedDB([response.notebook]);
        }),
        map((response) => response.notebook),
        catchError((err) => {
          const message = err?.error?.message || err?.error?.error || 'Failed to remove access';
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Update notebook's public status
   */
  setPublic(notebookId: string, isPublic: boolean): Observable<Notebook> {
    return this.http
      .put<{ notebook: Notebook }>(`/api/notebooks/${notebookId}/public`, { isPublic })
      .pipe(
        tap((response) => {
          this.store.update(updateEntities(notebookId, () => response.notebook));
          this.persistToIndexedDB([response.notebook]);
        }),
        map((response) => response.notebook),
        catchError((err) => {
          const message =
            err?.error?.message || err?.error?.error || 'Failed to update public status';
          return throwError(() => new Error(message));
        }),
      );
  }

  /**
   * Update notebook's public configuration (displayName, etc.)
   * Slug is auto-generated by the backend when making public.
   */
  updatePublicConfig(notebookId: string, data: { isPublic?: boolean }): Observable<Notebook> {
    return this.http
      .patch<{ notebook: Notebook }>(`/api/notebooks/${notebookId}/public`, data)
      .pipe(
        tap((response) => {
          this.store.update(updateEntities(notebookId, () => response.notebook));
          this.persistToIndexedDB([response.notebook]);
        }),
        map((response) => response.notebook),
        catchError((err) => {
          const message =
            err?.error?.message || err?.error?.error || 'Failed to update public config';
          return throwError(() => new Error(message));
        }),
      );
  }

  // ============ Summary Methods ============

  /**
   * Notebook summary response type
   */
  /**
   * Get notebook summary (page counts by type)
   */
  getNotebookSummary(notebookId: string): Observable<{
    notebook: Notebook;
    summary: {
      pageCounts: Record<string, number>;
      totalPages: number;
      todoStats: { todoCount: number; completedCount: number; overdueCount: number };
    };
  }> {
    return this.http
      .get<{
        notebook: Notebook;
        summary: {
          pageCounts: Record<string, number>;
          totalPages: number;
          todoStats: { todoCount: number; completedCount: number; overdueCount: number };
        };
      }>(`/api/notebooks/${notebookId}/summary`)
      .pipe(
        catchError((err) => {
          const message =
            err?.error?.message || err?.error?.error || 'Failed to fetch notebook summary';
          return throwError(() => new Error(message));
        }),
      );
  }

  // ============ Connection Graph Methods ============

  /**
   * Get connection graph for a notebook
   * Shows relationships between pages via links, hashtags, and mentions
   */
  getConnectionGraph(notebookId: string): Observable<{
    graph: {
      nodes: Array<{
        id: string;
        label: string;
        type: string;
        linkCount: number;
        tags?: string[];
        isCenter?: boolean;
      }>;
      edges: Array<{
        source: string;
        target: string;
        type: 'inline' | 'block' | 'tag' | 'hashtag' | 'mention';
        label?: string;
      }>;
      stats: {
        totalNodes: number;
        totalEdges: number;
        linkEdges: number;
        hashtagEdges: number;
      };
    };
  }> {
    return this.http
      .get<{
        graph: {
          nodes: Array<{
            id: string;
            label: string;
            type: string;
            linkCount: number;
            tags?: string[];
            isCenter?: boolean;
          }>;
          edges: Array<{
            source: string;
            target: string;
            type: 'inline' | 'block' | 'tag' | 'hashtag' | 'mention';
            label?: string;
          }>;
          stats: {
            totalNodes: number;
            totalEdges: number;
            linkEdges: number;
            hashtagEdges: number;
          };
        };
      }>(`/api/links/connections/notebook/${notebookId}`)
      .pipe(
        catchError((err) => {
          const message =
            err?.error?.message || err?.error?.error || 'Failed to fetch connection graph';
          return throwError(() => new Error(message));
        }),
      );
  }
}
