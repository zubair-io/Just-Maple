import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, from, of, switchMap, shareReplay, take } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { createStore } from '@ngneat/elf';
import {
  withEntities,
  selectAllEntities,
  selectEntity,
  setEntities,
  upsertEntities,
  getEntity,
  getAllEntities,
  getEntitiesCount,
} from '@ngneat/elf-entities';
import { filterNil } from '@ngneat/elf';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';
import type { CollectibleRegistry } from '@maple/shared';

const STORE_NAME = DB_STORES.COLLECTIBLE_REGISTRY;
const SYNC_KEY = 'collectible-registry-last-sync';

@Injectable({ providedIn: 'root' })
export class CollectibleRegistryService {
  private readonly http = inject(HttpClient);
  private readonly indexedDB = inject(IndexedDBService);
  private readonly platformId = inject(PLATFORM_ID);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<CollectibleRegistry, '_id'>({ idKey: '_id' }),
  );

  // Observable selectors
  readonly registries$ = this.store.pipe(selectAllEntities());

  // Signal wrapper for reactive access
  private readonly _registriesSignal = toSignal(this.registries$, {
    initialValue: [] as CollectibleRegistry[],
  });

  // Expose registries as a signal for reactive components
  registries(): CollectibleRegistry[] {
    return this._registriesSignal() ?? [];
  }

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Hydrate from IndexedDB on construction
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();
    }
  }

  /**
   * Load data from IndexedDB into ELF store
   */
  private async hydrateFromIndexedDB(): Promise<void> {
    const cached = await this.indexedDB.getAll<CollectibleRegistry>(STORE_NAME);
    if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
      this.store.update(setEntities(cached));
    }
  }

  /**
   * Initialize registry - loads all data with incremental sync
   * Returns observable that completes when sync is done
   */
  initializeRegistry(): Observable<boolean> {
    if (this.initialized) {
      return of(true);
    }

    if (this.initPromise) {
      return from(this.initPromise).pipe(map(() => true));
    }

    return this.loadAllRegistries().pipe(
      tap(() => {
        this.initialized = true;
      }),
      map(() => true),
    );
  }

  /**
   * Load all registries with incremental sync support
   * Only fetches items updated after the last sync timestamp
   */
  loadAllRegistries(): Observable<CollectibleRegistry[]> {
    return from(this.getLastSyncTimestamp()).pipe(
      switchMap((lastSync) => {
        const params: Record<string, string> = {};
        if (lastSync) {
          params['updatedAt'] = lastSync;
        }

        return this.http
          .get<{ registries: CollectibleRegistry[] }>('/api/collectible-registry', { params })
          .pipe(
            tap((response) => {
              // Upsert all records into store
              if (response.registries.length > 0) {
                this.store.update(upsertEntities(response.registries));

                // Persist to IndexedDB
                this.persistToIndexedDB(response.registries);

                // Update sync timestamp
                this.updateSyncTimestamp(response.registries);
              }
            }),
            map((response) => response.registries),
          );
      }),
      shareReplay(1),
    );
  }

  /**
   * Get a single registry by ID
   * Ensures registry is initialized, then returns from store
   */
  getById(id: string): Observable<CollectibleRegistry> {
    return this.initializeRegistry().pipe(
      switchMap(() => this.store.pipe(selectEntity(id), filterNil(), take(1))),
    );
  }

  /**
   * Find registry by barcode in local cache only (no API call)
   * Checks both upc field and ean in providerData
   */
  findByBarcode(barcode: string): CollectibleRegistry | null {
    const all = this.store.query(getAllEntities());
    const normalizedBarcode = barcode.trim();

    // Build variants: original, without leading zero (EAN-13 → UPC-A), with leading zero (UPC-A → EAN-13)
    const variants = [normalizedBarcode];
    if (normalizedBarcode.startsWith('0') && normalizedBarcode.length === 13) {
      variants.push(normalizedBarcode.substring(1)); // EAN-13 → UPC-A
    }
    if (!normalizedBarcode.startsWith('0') && normalizedBarcode.length === 12) {
      variants.push('0' + normalizedBarcode); // UPC-A → EAN-13
    }

    const found = all.find((r) => {
      // Check upc field
      if (r.upc && variants.includes(r.upc)) {
        return true;
      }
      // Check ean in providerData
      if (r.providerData?.ean && variants.includes(r.providerData.ean)) {
        return true;
      }
      // Check barcode array in providerData (some providers store multiple barcodes)
      if (r.providerData?.barcodes && Array.isArray(r.providerData.barcodes)) {
        return r.providerData.barcodes.some((b: string) => variants.includes(b));
      }
      return false;
    });

    return found || null;
  }

  /**
   * Get registry by barcode - ensures registry is loaded first, then searches locally
   * No API call for individual barcode lookup
   */
  getByBarcode(barcode: string): Observable<CollectibleRegistry | null> {
    // First check if already in cache
    const cached = this.findByBarcode(barcode);
    if (cached) {
      return of(cached);
    }

    // If not initialized, load registry first then search
    if (!this.initialized) {
      return this.initializeRegistry().pipe(map(() => this.findByBarcode(barcode)));
    }

    // Already initialized but not found
    return of(null);
  }

  /**
   * Get registry by provider ID (e.g., lego set number)
   * Fetches from API and updates store, returns the registry
   */
  getByProviderId(provider: string, providerId: string): Observable<CollectibleRegistry | null> {
    return this.http
      .get<{
        registry: CollectibleRegistry;
      }>(`/api/collectible-registry/provider/${provider}/${providerId}`)
      .pipe(
        tap((response) => {
          this.store.update(upsertEntities([response.registry]));
          this.persistToIndexedDB([response.registry]);
        }),
        map((response) => response.registry),
      );
  }

  /**
   * Search registries
   */
  search(
    query: string,
    options?: { provider?: string; limit?: number },
  ): Observable<CollectibleRegistry[]> {
    const params: Record<string, string> = { q: query };
    if (options?.provider) params['provider'] = options.provider;
    if (options?.limit) params['limit'] = options.limit.toString();

    return this.http
      .get<{ registries: CollectibleRegistry[] }>('/api/collectible-registry/search', { params })
      .pipe(
        tap((response) => {
          this.store.update(upsertEntities(response.registries));
          this.persistToIndexedDB(response.registries);
        }),
        map((response) => response.registries),
      );
  }

  /**
   * Get cached registry by ID (synchronous - use for non-reactive contexts only)
   */
  getCached(id: string): CollectibleRegistry | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Get all cached registries
   */
  getAllCached(): CollectibleRegistry[] {
    return this.store.query(getAllEntities());
  }

  /**
   * Select a single registry as observable
   */
  select(id: string): Observable<CollectibleRegistry | undefined> {
    return this.store.pipe(selectEntity(id));
  }

  /**
   * Clear cache and reset sync state
   */
  async clearCache(): Promise<void> {
    this.store.update(setEntities([]));
    this.initialized = false;

    if (isPlatformBrowser(this.platformId)) {
      await this.indexedDB.clear(STORE_NAME);
      await this.indexedDB.delete(SYNC_KEY, DB_STORES.SYNC_METADATA);
    }
  }

  /**
   * Get last sync timestamp from IndexedDB
   */
  private async getLastSyncTimestamp(): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) return null;

    const metadata = await this.indexedDB.get<{ key: string; timestamp: string }>(
      SYNC_KEY,
      DB_STORES.SYNC_METADATA,
    );
    return metadata?.timestamp || null;
  }

  /**
   * Update sync timestamp in IndexedDB
   */
  private async updateSyncTimestamp(registries: CollectibleRegistry[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || registries.length === 0) return;

    const newestTimestamp = registries
      .map((r) => new Date(r.updatedAt))
      .reduce((max, date) => (date > max ? date : max))
      .toISOString();

    await this.indexedDB.put(
      { key: SYNC_KEY, timestamp: newestTimestamp },
      DB_STORES.SYNC_METADATA,
    );
  }

  /**
   * Persist registries to IndexedDB
   */
  private async persistToIndexedDB(registries: CollectibleRegistry[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || registries.length === 0) return;
    await this.indexedDB.putMany(registries, STORE_NAME);
  }
}
