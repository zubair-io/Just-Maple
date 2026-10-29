import { Injectable, inject, PLATFORM_ID, signal, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, tap, map, catchError, throwError, of, switchMap, Subject } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
  getActiveEntity,
  selectActiveId,
  selectManyByPredicate,
} from '@ngneat/elf-entities';
import { VisibilityService } from './visibility.service';
import {
  type ProviderCapabilities,
  LOCAL_FS_CAPABILITIES,
} from '../providers/data-provider.interface';
import { FileSystemPageProvider } from '../providers/filesystem-data.provider';
import type { Page, CreatePageInput, UpdatePageInput, PageContent } from '../shared/schemas/page';

export interface PageFilters {
  folderId?: string;
  favorites?: boolean;
  trash?: boolean;
  archived?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly visibilityService = inject(VisibilityService);
  private readonly fsPageProvider = inject(FileSystemPageProvider);
  private readonly destroyRef = inject(DestroyRef);
  private init = false;

  // ELF Store
  private readonly store = createStore(
    { name: 'page' },
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
      // Refresh pages when document becomes visible (user returns to tab)
      this.visibilityService.becameVisible$
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          switchMap(() => this.loadPages()),
        )
        .subscribe();
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

  pagesByFolder$(folderId: string): Observable<Page[]> {
    return this.store.pipe(selectManyByPredicate((entity) => entity.folderId === folderId));
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
   * Always returns local FS capabilities.
   */
  getCapabilities(pageId: string): ProviderCapabilities {
    return LOCAL_FS_CAPABILITIES;
  }

  /**
   * Check if a page is backed by the local file system.
   * Always true in local-only mode.
   */
  isLocal(pageId: string): boolean {
    return true;
  }

  /**
   * Load pages from local file system for a specific folder.
   * Used to populate the store with local pages when a local folder is expanded.
   */
  loadLocalPages(folderId: string): Observable<Page[]> {
    return this.fsPageProvider.loadPages({ folderId }).pipe(
      tap((pages) => {
        // Remove cached pages for this folder that no longer exist on disk
        const freshIds = new Set(pages.map((p) => p.id));
        const staleIds = this.store
          .query(getAllEntities())
          .filter((p) => p.folderId === folderId && !freshIds.has(p.id))
          .map((p) => p.id);
        if (staleIds.length > 0) {
          this.store.update(deleteEntities(staleIds));
        }

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
   * Load pages from local file system with optional filters.
   */
  loadPages(filters?: PageFilters): Observable<Page[]> {
    this.init = true;
    this._isLoading.set(true);
    this._error.set(null);

    return this.fsPageProvider
      .loadPages(filters?.folderId ? { folderId: filters.folderId } : undefined)
      .pipe(
        tap((pages) => {
          this.store.update(setEntities(pages));
          this._isLoading.set(false);
        }),
        catchError((err) => {
          this._error.set('Failed to load pages');
          this._isLoading.set(false);
          return of([] as Page[]);
        }),
      );
  }

  /**
   * Get a single page by ID from the local file system.
   */
  getPage(pageId: string): Observable<Page> {
    return this.fsPageProvider.getPage(pageId).pipe(
      tap((page) => {
        this.store.update(upsertEntities([page]));
      }),
    );
  }

  /**
   * Create a new page via local file system.
   */
  createPage(data: CreatePageInput): Observable<Page> {
    return this.fsPageProvider.createPage(data).pipe(
      tap((page) => {
        this.store.update(addEntities(page));
      }),
    );
  }

  /**
   * Update a page via local file system.
   */
  updatePage(id: string, data: UpdatePageInput): Observable<Page> {
    return this.fsPageProvider.updatePage(id, data).pipe(
      tap((page) => {
        this.store.update(updateEntities(id, () => page));
      }),
    );
  }

  /**
   * Permanently delete a page via local file system.
   */
  deletePage(id: string): Observable<void> {
    this._error.set(null);

    const wasActive = this.selectedPageId() === id;
    this.store.update(deleteEntities(id));
    if (wasActive) {
      this.store.update(resetActiveId());
    }

    return this.fsPageProvider.deletePage(id).pipe(
      catchError((err) => {
        const message = err?.message || 'Failed to delete page';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Move page to trash. In local-only mode, permanently deletes.
   */
  moveToTrash(id: string): Observable<void> {
    return this.deletePage(id);
  }

  /**
   * Toggle favorite status
   */
  toggleFavorite(id: string): Observable<Page> {
    const page = this.store.query(getEntity(id));
    if (!page) {
      return throwError(() => new Error('Page not found'));
    }

    const updated = { ...page, isFavorite: !page.isFavorite, updatedAt: new Date().toISOString() };
    this.store.update(updateEntities(id, () => updated));
    return of(updated);
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
   * Get pages for a specific folder
   */
  getPagesForFolder(folderId: string): Page[] {
    return this.store.query(getAllEntities()).filter((n) => n.folderId === folderId);
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
  clearCache(): void {
    this.store.update(setEntities([]));
    this.store.update(resetActiveId());
  }
}
