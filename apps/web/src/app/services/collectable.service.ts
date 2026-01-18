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
import type {
  Collectable,
  CreateCollectableInput,
  UpdateCollectableInput,
  CollectableStatus,
} from '@maple/shared';

const STORE_NAME = DB_STORES.COLLECTABLE;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export interface CollectableFilters {
  notebookId?: string;
  status?: CollectableStatus;
}

@Injectable({ providedIn: 'root' })
export class CollectableService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly destroyRef = inject(DestroyRef);

  // Track last fetch time per notebookId for caching
  private readonly lastFetchMap = new Map<string, number>();

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Collectable, '_id'>({ idKey: '_id' }),
    withActiveId(),
  );

  // Observable selectors
  readonly collectables$ = this.store.pipe(selectAllEntities());
  readonly activeCollectable$ = this.store.pipe(selectActiveEntity());

  // Signal wrappers for Angular reactivity
  private readonly _collectablesSignal = toSignal(this.collectables$, {
    initialValue: [] as Collectable[],
  });

  // Public signal for direct reactive access in components
  readonly collectablesSignal = this._collectablesSignal;

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
   * Subscribe to collectable events from WebSocket event stream
   */
  private subscribeToRealtimeEvents(): void {
    // Subscribe to collectable.created events
    this.realtimeWS
      .on('collectable.created')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: Extract<AppEvent, { type: 'collectable.created' }>) => {
        // Remove any temp collectables with matching registry data
        const tempCollectables = this.store
          .query(getAllEntities())
          .filter(
            (p) =>
              p._id.startsWith('temp-') &&
              p.data.registryData === event.collectable.data.registryData &&
              p.tags.some((t) => event.collectable.tags.includes(t)),
          );
        if (tempCollectables.length > 0) {
          this.store.update(deleteEntities(tempCollectables.map((p) => p._id)));
        }
        this.store.update(upsertEntities([event.collectable]));
        this.persistToIndexedDB([event.collectable]);
      });

    // Subscribe to collectable.updated events
    this.realtimeWS
      .on('collectable.updated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: Extract<AppEvent, { type: 'collectable.updated' }>) => {
        this.store.update(upsertEntities([event.collectable]));
        this.persistToIndexedDB([event.collectable]);
      });

    // Subscribe to collectable.deleted events
    this.realtimeWS
      .on('collectable.deleted')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event: Extract<AppEvent, { type: 'collectable.deleted' }>) => {
        this.store.update(deleteEntities(event.collectableId));
        if (isPlatformBrowser(this.platformId)) {
          this.indexedDB.delete(event.collectableId, STORE_NAME);
        }
      });
  }

  /**
   * Load data from IndexedDB into ELF store
   */
  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<Collectable>(STORE_NAME);
    if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
      this.store.update(setEntities(cached));
    }
  }

  /**
   * Get all collectables as a reactive signal
   */
  collectables(): Collectable[] {
    return this._collectablesSignal() ?? [];
  }

  /**
   * Get selected collectable ID synchronously
   */
  selectedCollectableId(): string | null {
    const active = this.store.query(getActiveEntity());
    return active?._id || null;
  }

  /**
   * Get selected collectable synchronously
   */
  selectedCollectable(): Collectable | null {
    return this.store.query(getActiveEntity()) || null;
  }

  /**
   * Load collectables from API with optional filters
   * Uses 1-minute cache per notebookId to prevent duplicate requests
   */
  loadCollectables(filters?: CollectableFilters): Observable<Collectable[]> {
    const cacheKey = filters?.notebookId || '_all';
    const now = Date.now();
    const lastFetch = this.lastFetchMap.get(cacheKey);

    // Return cached data if within TTL
    if (lastFetch && now - lastFetch < CACHE_TTL_MS) {
      const cached = filters?.notebookId
        ? this.store.query(getAllEntities()).filter((p) => p.tags.includes(filters.notebookId!))
        : this.store.query(getAllEntities());
      return of(cached);
    }

    this._isLoading.set(true);
    this._error.set(null);

    const params: Record<string, string> = {};
    if (filters?.notebookId) params['notebookId'] = filters.notebookId;
    if (filters?.status) params['status'] = filters.status;

    // Get newest updatedAt for incremental sync
    const existingCollectables = filters?.notebookId
      ? this.store.query(getAllEntities()).filter((p) => p.tags.includes(filters.notebookId!))
      : this.store.query(getAllEntities());
    if (existingCollectables.length > 0) {
      const newest = existingCollectables.reduce(
        (max, p) => (p.updatedAt > max ? p.updatedAt : max),
        existingCollectables[0].updatedAt,
      );
      params['updatedAfter'] = newest;
    }

    return this.http.get<{ collectables: Collectable[] }>('/api/collectables', { params }).pipe(
      tap((response) => {
        // Upsert collectables into store
        this.store.update(upsertEntities(response.collectables));
        this.persistToIndexedDB(response.collectables);
        this.lastFetchMap.set(cacheKey, now);
        this._isLoading.set(false);
      }),
      map((response) => response.collectables),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to load collectables';
        this._error.set(message);
        this._isLoading.set(false);
        return of([]);
      }),
    );
  }

  /**
   * Load a single collectable by ID
   */
  loadCollectable(id: string): Observable<Collectable | null> {
    // Check cache first
    const cached = this.store.query(getEntity(id));
    if (cached) {
      return of(cached);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ collectable: Collectable }>(`/api/collectables/${id}`).pipe(
      tap((response) => {
        this.store.update(upsertEntities([response.collectable]));
        this.persistToIndexedDB([response.collectable]);
        this._isLoading.set(false);
      }),
      map((response) => response.collectable),
      catchError((err) => {
        const message = err?.error?.error || 'Failed to load collectable';
        this._error.set(message);
        this._isLoading.set(false);
        return of(null);
      }),
    );
  }

  /**
   * Create a new collectable with optimistic update
   */
  createCollectable(data: CreateCollectableInput): Observable<Collectable> {
    this._isLoading.set(true);
    this._error.set(null);

    // Create temporary collectable for optimistic update
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const tempCollectable: Collectable = {
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
    this.store.update(addEntities(tempCollectable));

    return this.http.post<{ collectable: Collectable }>('/api/collectables', data).pipe(
      tap((response) => {
        // Remove temp and add real collectable
        this.store.update(deleteEntities(tempId));
        this.store.update(addEntities(response.collectable));
        this.persistToIndexedDB([response.collectable]);
        this._isLoading.set(false);
      }),
      map((response) => response.collectable),
      catchError((err) => {
        // Rollback optimistic update
        this.store.update(deleteEntities(tempId));
        const message = err?.error?.error || 'Failed to create collectable';
        this._error.set(message);
        this._isLoading.set(false);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Update a collectable with optimistic update
   */
  updateCollectable(id: string, data: UpdateCollectableInput): Observable<Collectable> {
    this._error.set(null);

    // Store original for rollback
    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Collectable not found'));
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

    return this.http.put<{ collectable: Collectable }>(`/api/collectables/${id}`, data).pipe(
      tap((response) => {
        // Update with server response
        this.store.update(updateEntities(id, response.collectable));
        this.persistToIndexedDB([response.collectable]);
      }),
      map((response) => response.collectable),
      catchError((err) => {
        // Rollback optimistic update
        this.store.update(updateEntities(id, () => original));
        const message = err?.error?.error || 'Failed to update collectable';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Delete a collectable with optimistic update
   */
  deleteCollectable(id: string): Observable<void> {
    this._error.set(null);

    // Store original for rollback
    const original = this.store.query(getEntity(id));
    if (!original) {
      return throwError(() => new Error('Collectable not found'));
    }

    // Check if this is the active collectable
    const wasActive = this.selectedCollectableId() === id;

    // Optimistic delete
    this.store.update(deleteEntities(id));
    if (wasActive) {
      this.store.update(resetActiveId());
    }

    return this.http.delete(`/api/collectables/${id}`).pipe(
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
        const message = err?.error?.error || 'Failed to delete collectable';
        this._error.set(message);
        return throwError(() => new Error(message));
      }),
    );
  }

  /**
   * Select a collectable as active
   */
  selectCollectable(id: string | null): void {
    if (id) {
      this.store.update(setActiveId(id));
    } else {
      this.store.update(resetActiveId());
    }
  }

  /**
   * Get collectable by ID synchronously
   */
  getCollectableById(id: string): Collectable | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Optimistically update a collectable in the store (for WebSocket operations)
   * Returns the original collectable for potential rollback
   */
  optimisticUpdate(id: string, data: Partial<Collectable['data']>): Collectable | undefined {
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
   * Optimistically create a collectable in the store (for WebSocket operations)
   * Returns the temporary ID for tracking
   */
  optimisticCreate(tags: string[], data: Collectable['data']): string {
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const tempCollectable: Collectable = {
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

    this.store.update(addEntities(tempCollectable));
    return tempId;
  }

  /**
   * Remove a temporary collectable (for when WS broadcast replaces it)
   */
  removeTemp(tempId: string): void {
    if (tempId.startsWith('temp-')) {
      this.store.update(deleteEntities(tempId));
    }
  }

  /**
   * Get collectables for a specific notebook
   */
  getCollectablesForNotebook(notebookId: string): Collectable[] {
    return this.store.query(getAllEntities()).filter((p) => p.tags.includes(notebookId));
  }

  /**
   * Select a single collectable as observable
   */
  select(id: string): Observable<Collectable | undefined> {
    return this.store.pipe(selectEntity(id));
  }

  /**
   * Load collectable by registry data ID
   * Always fetches from API to ensure data is fresh (avoids stale cache issues)
   */
  loadCollectableByRegistry(
    registryId: string,
    notebookId: string,
  ): Observable<Collectable | null> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http
      .get<{ collectable: Collectable | null }>(`/api/collectables/by-registry/${registryId}`, {
        params: { notebookId },
      })
      .pipe(
        tap((response) => {
          if (response.collectable) {
            this.store.update(upsertEntities([response.collectable]));
            this.persistToIndexedDB([response.collectable]);
          } else {
            // Remove stale cache entry if API says collectable doesn't exist
            const cached = this.store
              .query(getAllEntities())
              .find((p) => p.data.registryData === registryId && p.tags.includes(notebookId));
            if (cached) {
              this.store.update(deleteEntities(cached._id));
              if (isPlatformBrowser(this.platformId)) {
                this.indexedDB.delete(cached._id, STORE_NAME);
              }
            }
          }
          this._isLoading.set(false);
        }),
        map((response) => response.collectable),
        catchError((err) => {
          const message = err?.error?.error || 'Failed to load collectable';
          this._error.set(message);
          this._isLoading.set(false);
          return of(null);
        }),
      );
  }

  /**
   * Clear all collectables from store and IndexedDB
   */
  async clearCache(): Promise<void> {
    this.store.update(setEntities([]));
    this.store.update(resetActiveId());

    if (isPlatformBrowser(this.platformId)) {
      await this.indexedDB.clear(STORE_NAME);
    }
  }

  /**
   * Persist collectables to IndexedDB
   */
  private async persistToIndexedDB(collectables: Collectable[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || collectables.length === 0) return;
    await this.indexedDB.putMany(collectables, STORE_NAME);
  }
}
