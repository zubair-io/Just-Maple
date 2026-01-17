import { Injectable, inject, PLATFORM_ID, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { RealtimeWSService, type AppEvent } from './realtime-ws.service';
import { DB_STORES } from './db-stores';
import type { Paper, CreatePaperInput, UpdatePaperInput, PaperStatus } from '@maple/shared';

const STORE_NAME = DB_STORES.PAPER;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export interface PaperFilters {
  tagId?: string;
  status?: PaperStatus;
}

@Injectable({ providedIn: 'root' })
export class PaperService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly destroyRef = inject(DestroyRef);

  // Track last fetch time per tagId for caching
  private readonly lastFetchMap = new Map<string, number>();

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Paper, '_id'>({ idKey: '_id' }),
    withActiveId(),
  );

  // Observable selectors
  readonly papers$ = this.store.pipe(selectAllEntities());
  readonly activePaper$ = this.store.pipe(selectActiveEntity());

  // Signal wrappers for Angular reactivity
  private readonly _papersSignal = toSignal(this.papers$, { initialValue: [] as Paper[] });

  // Public signal for direct reactive access in components
  readonly papersSignal = this._papersSignal;

  // UI state signals (not persisted)
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Hydrate from IndexedDB on construction
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();
      this.subscribeToRealtimeEvents();
    }
  }

  /**
   * Subscribe to paper events from WebSocket event stream
   */
  private subscribeToRealtimeEvents(): void {
    // Subscribe to paper.created events
    this.realtimeWS
      .on('paper.created')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: Extract<AppEvent, { type: 'paper.created' }>) => {
        // Remove any temp papers with matching registry data
        const tempPapers = this.store
          .query(getAllEntities())
          .filter(
            (p) =>
              p._id.startsWith('temp-') &&
              p.data.registryData === event.paper.data.registryData &&
              p.tags.some((t) => event.paper.tags.includes(t)),
          );
        if (tempPapers.length > 0) {
          this.store.update(deleteEntities(tempPapers.map((p) => p._id)));
        }
        this.store.update(upsertEntities([event.paper]));
        this.persistToIndexedDB([event.paper]);
      });

    // Subscribe to paper.updated events
    this.realtimeWS
      .on('paper.updated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: Extract<AppEvent, { type: 'paper.updated' }>) => {
        this.store.update(upsertEntities([event.paper]));
        this.persistToIndexedDB([event.paper]);
      });

    // Subscribe to paper.deleted events
    this.realtimeWS
      .on('paper.deleted')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: Extract<AppEvent, { type: 'paper.deleted' }>) => {
        this.store.update(deleteEntities(event.paperId));
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(event.paperId, STORE_NAME);
        }
      });
  }

  /**
   * Load data from IndexedDB into ELF store
   */
  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<Paper>(STORE_NAME);
    if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
      this.store.update(setEntities(cached));
    }
  }

  /**
   * Get all papers as a reactive signal
   */
  papers(): Paper[] {
    return this._papersSignal() ?? [];
  }

  /**
   * Get selected paper ID synchronously
   */
  selectedPaperId(): string | null {
    const active = this.store.query(getActiveEntity());
    return active?._id || null;
  }

  /**
   * Get selected paper synchronously
   */
  selectedPaper(): Paper | null {
    return this.store.query(getActiveEntity()) || null;
  }

  /**
   * Load papers from API with optional filters
   * Uses 1-minute cache per tagId to prevent duplicate requests
   */
  loadPapers(filters?: PaperFilters): Observable<Paper[]> {
    const cacheKey = filters?.tagId || '_all';
    const now = Date.now();
    const lastFetch = this.lastFetchMap.get(cacheKey);

    // Return cached data if within TTL
    if (lastFetch && now - lastFetch < CACHE_TTL_MS) {
      const cached = filters?.tagId
        ? this.store.query(getAllEntities()).filter((p) => p.tags.includes(filters.tagId!))
        : this.store.query(getAllEntities());
      return of(cached);
    }

    this._isLoading.set(true);
    this._error.set(null);

    const params: Record<string, string> = {};
    if (filters?.tagId) params['tagId'] = filters.tagId;
    if (filters?.status) params['status'] = filters.status;

    // Get newest updatedAt for incremental sync
    const existingPapers = filters?.tagId
      ? this.store.query(getAllEntities()).filter((p) => p.tags.includes(filters.tagId!))
      : this.store.query(getAllEntities());
    if (existingPapers.length > 0) {
      const newest = existingPapers.reduce(
        (max, p) => (p.updatedAt > max ? p.updatedAt : max),
        existingPapers[0].updatedAt,
      );
      params['updatedAfter'] = newest;
    }

    return this.http.get<{ papers: Paper[] }>('/api/papers', { params }).pipe(
      tap((response) => {
        // Upsert papers into store
        this.store.update(upsertEntities(response.papers));
        this.persistToIndexedDB(response.papers);
        this.lastFetchMap.set(cacheKey, now);
        this._isLoading.set(false);
      }),
      map((response) => response.papers),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to load papers';
        this._error.set(message);
        this._isLoading.set(false);
        return of([]);
      }),
    );
  }

  /**
   * Load a single paper by ID
   */
  loadPaper(id: string): Observable<Paper | null> {
    // Check cache first
    const cached = this.store.query(getEntity(id));
    if (cached) {
      return of(cached);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ paper: Paper }>(`/api/papers/${id}`).pipe(
      tap((response) => {
        this.store.update(upsertEntities([response.paper]));
        this.persistToIndexedDB([response.paper]);
        this._isLoading.set(false);
      }),
      map((response) => response.paper),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to load paper';
        this._error.set(message);
        this._isLoading.set(false);
        return of(null);
      }),
    );
  }

  /**
   * Create a new paper with optimistic update
   */
  createPaper(data: CreatePaperInput): Observable<Paper> {
    this._isLoading.set(true);
    this._error.set(null);

    // Create temporary paper for optimistic update
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const tempPaper: Paper = {
      _id: tempId,
      tags: data.tags || [],
      type: 'collectible',
      data: {
        itemId: data.data.itemId,
        provider: data.data.provider,
        registryData: data.data.registryData,
        status: data.data.status || 'have',
        quantity: data.data.quantity ?? 1,
        created: now,
      },
      createdBy: 'temp',
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic add
    this.store.update(addEntities(tempPaper));

    return this.http.post<{ paper: Paper }>('/api/papers', data).pipe(
      tap((response) => {
        // Remove temp and add real paper
        this.store.update(deleteEntities(tempId));
        this.store.update(addEntities(response.paper));
        this.persistToIndexedDB([response.paper]);
        this._isLoading.set(false);
      }),
      map((response) => response.paper),
      catchError((err) => {
        // Rollback optimistic update
        this.store.update(deleteEntities(tempId));
        const message = err?.error?.error || 'Failed to create paper';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Update a paper with optimistic update
   */
  updatePaper(id: string, data: UpdatePaperInput): Observable<Paper> {
    this._error.set(null);

    // Store original for rollback
    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Paper not found'));
    }

    // Optimistic update
    this.store.update(
      updateEntities(id, (entity) => ({
        ...entity,
        tags: data.tags ?? entity.tags,
        data: data.data ? { ...entity.data, ...data.data } : entity.data,
        updatedAt: new Date().toISOString(),
      })),
    );

    return this.http.put<{ paper: Paper }>(`/api/papers/${id}`, data).pipe(
      tap((response) => {
        // Update with server response
        this.store.update(updateEntities(id, response.paper));
        this.persistToIndexedDB([response.paper]);
      }),
      map((response) => response.paper),
      catchError((err) => {
        // Rollback optimistic update
        this.store.update(updateEntities(id, () => original));
        const message = err?.error?.error || 'Failed to update paper';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Delete a paper with optimistic update
   */
  deletePaper(id: string): Observable<void> {
    this._error.set(null);

    // Store original for rollback
    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Paper not found'));
    }

    // Check if this is the active paper
    const wasActive = this.selectedPaperId() === id;

    // Optimistic delete
    this.store.update(deleteEntities(id));
    if (wasActive) {
      this.store.update(resetActiveId());
    }

    return this.http.delete(`/api/papers/${id}`).pipe(
      tap(() => {
        // Also delete from IndexedDB
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(id, STORE_NAME);
        }
      }),
      map(() => undefined),
      catchError((err) => {
        // Rollback optimistic delete
        this.store.update(addEntities(original));
        if (wasActive) {
          this.store.update(setActiveId(id));
        }
        const message = err?.error?.error || 'Failed to delete paper';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Select a paper as active
   */
  selectPaper(id: string | null): void {
    if (id) {
      this.store.update(setActiveId(id));
    } else {
      this.store.update(resetActiveId());
    }
  }

  /**
   * Get paper by ID synchronously
   */
  getPaperById(id: string): Paper | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Optimistically update a paper in the store (for WebSocket operations)
   * Returns the original paper for potential rollback
   */
  optimisticUpdate(id: string, data: Partial<Paper['data']>): Paper | undefined {
    const original = this.store.query(getEntity(id));
    if (!original) return undefined;

    this.store.update(
      updateEntities(id, (entity) => ({
        ...entity,
        data: { ...entity.data, ...data },
        updatedAt: new Date().toISOString(),
      })),
    );

    return original;
  }

  /**
   * Optimistically create a paper in the store (for WebSocket operations)
   * Returns the temporary ID for tracking
   */
  optimisticCreate(tags: string[], data: Paper['data']): string {
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const tempPaper: Paper = {
      _id: tempId,
      tags,
      type: 'collectible',
      data: {
        ...data,
        created: now,
      },
      createdBy: 'temp',
      createdAt: now,
      updatedAt: now,
    };

    this.store.update(addEntities(tempPaper));
    return tempId;
  }

  /**
   * Remove a temporary paper (for when WS broadcast replaces it)
   */
  removeTemp(tempId: string): void {
    if (tempId.startsWith('temp-')) {
      this.store.update(deleteEntities(tempId));
    }
  }

  /**
   * Get papers for a specific tag
   */
  getPapersForTag(tagId: string): Paper[] {
    return this.store.query(getAllEntities()).filter((p) => p.tags.includes(tagId));
  }

  /**
   * Select a single paper as observable
   */
  select(id: string): Observable<Paper | undefined> {
    return this.store.pipe(selectEntity(id));
  }

  /**
   * Load paper by registry data ID
   * Always fetches from API to ensure data is fresh (avoids stale cache issues)
   */
  loadPaperByRegistry(registryId: string, tagId: string): Observable<Paper | null> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http
      .get<{ paper: Paper | null }>(`/api/papers/by-registry/${registryId}`, {
        params: { tagId },
      })
      .pipe(
        tap((response) => {
          if (response.paper) {
            this.store.update(upsertEntities([response.paper]));
            this.persistToIndexedDB([response.paper]);
          } else {
            // Remove stale cache entry if API says paper doesn't exist
            const cached = this.store
              .query(getAllEntities())
              .find((p) => p.data.registryData === registryId && p.tags.includes(tagId));
            if (cached) {
              this.store.update(deleteEntities(cached._id));
              if (isPlatformBrowser(this.platformId)) {
                this.indexedDB.delete(cached._id, STORE_NAME);
              }
            }
          }
          this._isLoading.set(false);
        }),
        map((response) => response.paper),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to load paper';
          this._error.set(message);
          this._isLoading.set(false);
          return of(null);
        }),
      );
  }

  /**
   * Clear all papers from store and IndexedDB
   */
  async clearCache(): Promise<void> {
    this.store.update(setEntities([]));
    this.store.update(resetActiveId());

    if (isPlatformBrowser(this.platformId)) {
      await this.indexedDB.clear(STORE_NAME);
    }
  }

  /**
   * Persist papers to IndexedDB
   */
  private async persistToIndexedDB(papers: Paper[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || papers.length === 0) return;
    await this.indexedDB.putMany(papers, STORE_NAME);
  }
}
