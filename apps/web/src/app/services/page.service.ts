import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  tap,
  map,
  catchError,
  throwError,
  of,
  switchMap,
  concat,
  debounceTime,
  Subject,
  merge,
  takeWhile,
} from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore, filterNil, select } from '@ngneat/elf';
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
  selectActiveId,
  selectManyByPredicate,
} from '@ngneat/elf-entities';
import { IndexedDBService } from './indexed-db.service';
import { NetworkService } from './network.service';
import { VisibilityService } from './visibility.service';
import { DB_STORES } from './db-stores';
import { RealtimeWSService, type AppEvent } from './realtime-ws.service';
import {
  isLocalPage,
  isLocalNotebook,
  type ProviderCapabilities,
  API_CAPABILITIES,
  LOCAL_FS_CAPABILITIES,
} from '../providers/data-provider.interface';
import { FileSystemPageProvider } from '../providers/filesystem-data.provider';
import type {
  Page,
  CreatePageInput,
  UpdatePageInput,
  PageContent,
  DEFAULT_PAGE_CONTENT,
} from '@maple/shared';

const STORE_NAME = DB_STORES.PAGE;

export interface PageFilters {
  notebookId?: string;
  favorites?: boolean;
  trash?: boolean;
  archived?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PageService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly network = inject(NetworkService);
  private readonly visibilityService = inject(VisibilityService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly fsPageProvider = inject(FileSystemPageProvider);
  private init = false;

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Page, 'id'>({ idKey: 'id' }),
    withActiveId(),
  );

  // Observable selectors
  readonly pages$ = this.store.pipe(selectAllEntities());
  readonly activePage$: Observable<Page> = this.store.pipe(selectActiveEntity(), filterNil());
  readonly activeId$ = this.store.pipe(selectActiveId());

  // Signal wrappers for Angular reactivity
  private readonly _pagesSignal = toSignal(this.pages$, { initialValue: [] as Page[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // Subject to queue save requests
  private readonly saveSubject = new Subject<{ id: string; base64Data: string }>();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();

      // Refresh pages when document becomes visible (user returns to tab)
      this.visibilityService.becameVisible$.pipe(switchMap(() => this.loadPages())).subscribe();
    }

    this.setupEventStreamListeners();
  }

  private setupEventStreamListeners() {
    //  Listen for page.created events
    this.realtimeWS
      .on('page.created')
      .pipe(
        tap((event: Extract<AppEvent, { type: 'page.created' }>) => {
          const documentId = event.page.id;
          if (!this.store.query(getEntity(documentId))) {
            this.store.update(addEntities(event.page));
            this.persistToIndexedDB([event.page]);
          }
        }),
        debounceTime(1000),
        switchMap((event: Extract<AppEvent, { type: 'page.created' }>) => {
          return this.getPage(event.page.id);
        }),
      )
      .subscribe();
    // Listen for page.updated events
    this.realtimeWS
      .on('page.updated')
      .subscribe((event: Extract<AppEvent, { type: 'page.updated' }>) => {
        this.store.update(
          updateEntities(event.pageId, (page) => ({
            ...page,
            title: event.title ?? page.title,
            updatedAt: event.updatedAt,
          })),
        );
      });
    // Listen for page.moved events (page moved between notebooks)
    this.realtimeWS
      .on('page.moved')
      .subscribe((event: Extract<AppEvent, { type: 'page.moved' }>) => {
        const existing = this.store.query(getEntity(event.pageId));
        if (existing) {
          this.store.update(
            updateEntities(event.pageId, (page) => ({
              ...page,
              notebookId: event.newNotebookId,
              updatedAt: event.updatedAt,
            })),
          );
        } else {
          // Page not in local store — fetch from server and upsert
          this.getPage(event.pageId).subscribe();
        }
      });
    // Listen for page.deleted events
    this.realtimeWS
      .on('page.deleted')
      .subscribe((event: Extract<AppEvent, { type: 'page.deleted' }>) => {
        this.store.update(deleteEntities(event.pageId));
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(event.pageId, STORE_NAME);
        }
      });
    // Listen for page.trashed events
    this.realtimeWS
      .on('page.trashed')
      .subscribe((event: Extract<AppEvent, { type: 'page.trashed' }>) => {
        // Remove from visible list (user can view trash separately)
        this.store.update(deleteEntities(event.pageId));
      });
    // Listen for page.restored events
    this.realtimeWS
      .on('page.restored')
      .subscribe((event: Extract<AppEvent, { type: 'page.restored' }>) => {
        this.store.update(upsertEntities([event.page]));
        this.persistToIndexedDB([event.page]);
      });
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<Page>(STORE_NAME);
    if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
      this.store.update(setEntities(cached));
    }
  }
  setActivePageId(id: string | null): void {
    this.store.update(setActiveId(id));
  }

  /**
   * Get all pages as a reactive signal
   */
  pages(): Page[] {
    return this._pagesSignal() ?? [];
  }
  pagesByNotebook$(notebookId: string): Observable<Page[]> {
    return this.store.pipe(selectManyByPredicate((entity) => entity.notebookId === notebookId));
  }

  /**
   * Get a page's title as an Observable (reactive)
   * Used by page links to show live updated titles
   */
  getPageTitle$(pageId: string): Observable<string> {
    return this.store.pipe(
      selectEntity(pageId),
      map((page) => page?.title ?? 'Untitled'),
    );
  }

  /**
   * Get a page's title synchronously from the store
   */
  getPageTitleSync(pageId: string): string {
    const page = this.store.query(getEntity(pageId));
    return page?.title ?? 'Untitled';
  }

  /**
   * Get selected page ID synchronously
   */
  selectedPageId(): string | null {
    const active = this.store.query(getActiveEntity());
    return active?.id || null;
  }

  /**
   * Get selected page synchronously
   */
  selectedPage(): Page | null {
    return this.store.query(getActiveEntity()) || null;
  }

  /**
   * Get capabilities for a specific page.
   * Local pages have limited capabilities (no sharing, collaboration, etc.)
   */
  getCapabilities(pageId: string): ProviderCapabilities {
    return isLocalPage(pageId) ? LOCAL_FS_CAPABILITIES : API_CAPABILITIES;
  }

  /**
   * Check if a page is backed by the local file system
   */
  isLocal(pageId: string): boolean {
    return isLocalPage(pageId);
  }

  /**
   * Load pages from local file system for a specific notebook.
   * Used to populate the store with local pages when a local notebook is expanded.
   */
  loadLocalPages(notebookId: string): Observable<Page[]> {
    if (!isLocalNotebook(notebookId)) return of([]);

    return this.fsPageProvider.loadPages({ notebookId }).pipe(
      tap((pages) => {
        // Upsert local pages into the store
        if (pages.length > 0) {
          this.store.update(upsertEntities(pages));
        }
      }),
    );
  }

  /**
   * Get markdown content for a local page
   */
  getLocalPageMarkdown(pageId: string): Observable<string | null> {
    return this.fsPageProvider.getMarkdownContent(pageId);
  }

  /**
   * Save markdown content for a local page
   */
  saveLocalPageMarkdown(pageId: string, content: string): Observable<void> {
    return this.fsPageProvider.saveMarkdownContent(pageId, content);
  }

  /**
   * Load pages from API with optional filters.
   * Merges with local file system pages.
   */
  loadPages(filters?: PageFilters): Observable<Page[]> {
    this.init = true;
    this._isLoading.set(true);
    this._error.set(null);

    // If loading for a local notebook, delegate to file system provider
    if (filters?.notebookId && isLocalNotebook(filters.notebookId)) {
      return this.fsPageProvider.loadPages({ notebookId: filters.notebookId }).pipe(
        tap((pages) => {
          // Keep API pages and other local pages, replace only this notebook's local pages
          const currentPages = this.store
            .query(getAllEntities())
            .filter((p) => p.notebookId !== filters.notebookId);
          this.store.update(setEntities([...currentPages, ...pages]));
          this._isLoading.set(false);
        }),
        catchError((err) => {
          this._error.set('Failed to load local pages');
          this._isLoading.set(false);
          return of([] as Page[]);
        }),
      );
    }

    const params: Record<string, string> = {};
    if (filters?.notebookId) params['notebookId'] = filters.notebookId;
    if (filters?.favorites) params['favorites'] = 'true';
    if (filters?.trash) params['trash'] = 'true';
    if (filters?.archived) params['archived'] = 'true';

    return this.http.get<{ pages: Page[] }>('/api/pages', { params }).pipe(
      tap((response) => {
        // Keep local pages in the store, replace only API pages
        const localPages = this.store.query(getAllEntities()).filter((p) => isLocalPage(p.id));
        this.store.update(setEntities([...response.pages, ...localPages]));
        this.persistToIndexedDB(response.pages);
        this._isLoading.set(false);
      }),
      map(() => this.store.query(getAllEntities())),
      catchError((err) => {
        let message = err?.error?.error || 'Failed to load pages';

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
   * Get a single page by ID.
   * Routes to file system provider for local pages.
   */
  getPage(pageId: string): Observable<Page> {
    // Route local pages to file system provider
    if (isLocalPage(pageId)) {
      return this.fsPageProvider.getPage(pageId).pipe(
        tap((page) => {
          this.store.update(upsertEntities([page]));
        }),
      );
    }

    this._isLoading.set(true);
    this._error.set(null);

    const httpCall = this.http.get<{ page: Page }>(`/api/pages/${pageId}`).pipe(
      tap((response) => {
        this.store.update(upsertEntities(response.page));
        this.persistToIndexedDB([response.page]);
        this._isLoading.set(false);
      }),
      map((response) => response.page),
      map((data) => ({ source: 'server', data })),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to fetch page';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => err);
      }),
    );

    const localData = this.store.pipe(
      selectEntity(pageId),
      map((data) => ({ source: 'local', data })),
    );

    return merge(localData, httpCall).pipe(
      takeWhile(({ source }) => source !== 'server', true),
      map(({ data }) => data),
      filterNil(),
    );
  }

  /**
   * Create a new page.
   * Routes to file system provider for local notebooks.
   */
  createPage(data: CreatePageInput): Observable<Page> {
    // Route to file system provider for local notebooks
    if (data.notebookId && isLocalNotebook(data.notebookId)) {
      return this.fsPageProvider.createPage(data).pipe(
        tap((page) => {
          this.store.update(addEntities(page));
        }),
      );
    }

    this._isLoading.set(true);
    this._error.set(null);

    const tempId = crypto.randomUUID();
    const now = new Date().toISOString();
    const defaultContent: PageContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    };

    const tempPage: Page = {
      _id: tempId,
      id: data.id || tempId,
      userId: 'temp',
      type: data.type || 'memo',
      title: data.title || 'Untitled',
      content: data.content || defaultContent,
      notebookId: data.notebookId,
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    this.store.update(addEntities(tempPage));

    return concat(
      of(tempPage),
      this.http.post<{ page: Page }>('/api/pages', data).pipe(
        tap((response) => {
          this.store.update(updateEntities(response.page.id, response.page));
          this.persistToIndexedDB([response.page]);
          this._isLoading.set(false);
        }),
        map((response) => response.page),
      ),
    );
  }

  /**
   * Update a page.
   * Routes to file system provider for local pages.
   */
  updatePage(id: string, data: UpdatePageInput): Observable<Page> {
    // Route local pages to file system provider
    if (isLocalPage(id)) {
      return this.fsPageProvider.updatePage(id, data).pipe(
        tap((page) => {
          this.store.update(updateEntities(id, () => page));
        }),
      );
    }

    this._error.set(null);
    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Page not found'));
    }

    // Optimistic update
    this.store.update(
      updateEntities(id, (entity) => ({
        ...entity,
        ...data,
        updatedAt: new Date().toISOString(),
      })),
    );

    return this.http.put<{ page: Page }>(`/api/pages/${id}`, data).pipe(
      tap((response) => {
        this.store.update(updateEntities(id, () => response.page));
        this.persistToIndexedDB([response.page]);
      }),
      map((response) => response.page),
      catchError((err) => {
        this.store.update(updateEntities(id, () => original));
        const message = err?.error?.error || 'Failed to update page';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Save sync metadata
   */
  async saveSyncMetadata(key: string, data: Uint8Array): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    await this.indexedDB.put({ key, value: data }, DB_STORES.SYNC_METADATA);
  }

  /**
   * Get page directly from storage (bypassing in-memory store)
   */
  async getPageFromStorage(id: string): Promise<Page | undefined> {
    if (!isPlatformBrowser(this.platformId)) return undefined;
    return this.indexedDB.get<Page>(id, STORE_NAME);
  }

  /**
   * Get all pages directly from storage
   */
  async getAllPagesFromStorage(): Promise<Page[]> {
    if (!isPlatformBrowser(this.platformId)) return [];
    return this.indexedDB.getAll<Page>(STORE_NAME);
  }

  /**
   * Move page to trash.
   * For local pages, this permanently deletes the file (no trash support).
   */
  moveToTrash(id: string): Observable<void> {
    // Local pages don't support trash - delete directly
    if (isLocalPage(id)) {
      return this.deletePage(id);
    }

    this._error.set(null);

    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Page not found'));
    }

    const wasActive = this.selectedPageId() === id;

    // Optimistic update - remove from visible list
    this.store.update(deleteEntities(id));
    if (wasActive) {
      this.store.update(resetActiveId());
    }

    return this.http.post(`/api/pages/${id}/trash`, {}).pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(id, STORE_NAME);
        }
      }),
      map(() => undefined),
      catchError((err) => {
        this.store.update(addEntities(original));
        if (wasActive) {
          this.store.update(setActiveId(id));
        }
        const message = err?.error?.error || 'Failed to move page to trash';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Restore page from trash
   */
  restoreFromTrash(id: string): Observable<Page> {
    this._error.set(null);

    return this.http.post<{ page: Page }>(`/api/pages/${id}/restore`, {}).pipe(
      tap((response) => {
        this.store.update(upsertEntities([response.page]));
        this.persistToIndexedDB([response.page]);
      }),
      map((response) => response.page),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to restore page';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Permanently delete a page.
   * Routes to file system provider for local pages.
   */
  deletePage(id: string): Observable<void> {
    this._error.set(null);

    const wasActive = this.selectedPageId() === id;
    this.store.update(deleteEntities(id));
    if (wasActive) {
      this.store.update(resetActiveId());
    }

    // Route local pages to file system provider
    if (isLocalPage(id)) {
      return this.fsPageProvider.deletePage(id).pipe(
        catchError((err) => {
          const message = err?.message || 'Failed to delete local page';
          this._error.set(message);
          return throwError(() => new Error(message));
        }),
      );
    }

    const original = this.store.query(getEntity(id));

    return this.http.delete(`/api/pages/${id}`).pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(id, STORE_NAME);
        }
      }),
      map(() => undefined),
      catchError((err) => {
        if (original) {
          this.store.update(addEntities(original));
          if (wasActive) {
            this.store.update(setActiveId(id));
          }
        }
        const message = err?.error?.error || 'Failed to delete page';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Empty trash - delete all trashed pages
   */
  emptyTrash(): Observable<number> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http.delete<{ count: number }>('/api/pages/trash/empty').pipe(
      tap((response) => {
        // Remove all trashed pages from store
        const allPages = this.pages();
        const nonTrashedPages = allPages.filter((n) => !n.isTrashed);
        this.store.update(setEntities(nonTrashedPages));
        this._isLoading.set(false);
      }),
      map((response) => response.count),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to empty trash';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Toggle favorite status
   */
  toggleFavorite(id: string): Observable<Page> {
    const page = this.store.query(getEntity(id));
    if (!page) {
      return throwError(() => new Error('Page not found'));
    }

    return this.updatePage(id, { isFavorite: !page.isFavorite });
  }

  /**
   * Select a page as active
   */
  selectPage(id: string | null): void {
    if (id) {
      this.store.update(setActiveId(id));
    } else {
      this.store.update(resetActiveId());
    }
  }
  queryPage(id: string): Page | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Get page by ID synchronously
   */
  getPageById(id: string): Page | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Get pages for a specific notebook
   */
  getPagesForNotebook(notebookId: string): Page[] {
    return this.store.query(getAllEntities()).filter((n) => n.notebookId === notebookId);
  }

  /**
   * Select a single page as observable
   */
  select(id: string): Observable<Page> {
    return this.store.pipe(selectEntity(id)).pipe(filterNil());
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

  async persistToIndexedDB(pages: Page[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || pages.length === 0) return;
    await this.indexedDB.putMany(pages, STORE_NAME);
  }

  /**
   * Publish or unpublish a page
   */
  publishPage(id: string, isPublished: boolean): Observable<Page> {
    return this.http.patch<{ page: Page }>(`/api/pages/${id}/publish`, { isPublished }).pipe(
      tap((response) => {
        this.store.update(updateEntities(id, () => response.page));
        this.persistToIndexedDB([response.page]);
      }),
      map((response) => response.page),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to update publish state';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Add or update a page locally (offline-first)
   * Used for pages created offline before server sync
   */
  addLocalPage(page: Page): void {
    this.store.update(upsertEntities([page]));
  }

  /**
   * Get sync metadata (e.g. storage-adapter-id)
   */
  async getSyncMetadata(key: string): Promise<Uint8Array | undefined> {
    if (!isPlatformBrowser(this.platformId)) return undefined;
    const result = await this.indexedDB.get<{ key: string; value: Uint8Array }>(
      key,
      DB_STORES.SYNC_METADATA,
    );
    return result?.value;
  }
}
