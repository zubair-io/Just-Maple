import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, firstValueFrom, lastValueFrom, of } from 'rxjs';
import { map, catchError, tap, filter, startWith, switchMap } from 'rxjs/operators';
import { PageService } from './page.service';
import { RealtimeWSService } from './realtime-ws.service';
import type { Page, JsonDocument } from '@maple/shared';

/**
 * Cached JSON document data
 */
interface CachedJsonDocument {
  data: unknown;
  schema: unknown | null;
  version: number;
}

/**
 * JSON Document Service
 * Manages REST API operations and real-time subscriptions for JSON-type pages.
 * No Y.js needed - uses versioned document model with optimistic concurrency.
 */
@Injectable({ providedIn: 'root' })
export class JsonDocumentService {
  private readonly http = inject(HttpClient);
  private readonly pageService = inject(PageService);
  private readonly realtimeWS = inject(RealtimeWSService);

  // Local cache: pageId -> cached document
  private readonly _documents = signal<Map<string, CachedJsonDocument>>(new Map());

  // Subject for per-page data changes
  private readonly _dataUpdates = new Subject<{ pageId: string; data: unknown }>();

  constructor() {
    // Subscribe to real-time json.updated events
    this.realtimeWS.events
      .pipe(filter((event) => event.type === 'json.updated'))
      .subscribe((event) => {
        if (event.type === 'json.updated') {
          this._documents.update((docs) => {
            const updated = new Map(docs);
            updated.set(event.pageId, {
              data: event.data,
              schema: docs.get(event.pageId)?.schema ?? null,
              version: event.version,
            });
            return updated;
          });
          this._dataUpdates.next({ pageId: event.pageId, data: event.data });
        }
      });
  }

  /**
   * Get cached document for a page
   */
  getDocument(pageId: string): CachedJsonDocument | undefined {
    return this._documents().get(pageId);
  }

  /**
   * Get data signal for a page (reactive)
   */
  getData(pageId: string): unknown | undefined {
    return this._documents().get(pageId)?.data;
  }

  /**
   * Get data as an Observable that emits when data changes
   */
  getData$(pageId: string): Observable<unknown> {
    return this._dataUpdates.pipe(
      filter((update) => update.pageId === pageId),
      map((update) => update.data),
    );
  }

  /**
   * Get array data as Observable for loop blocks.
   * Emits the current cached value immediately, fetches if not cached,
   * and emits on future updates.
   */
  getJsonArray$(pageId: string, path: string): Observable<unknown[]> {
    const resolve = (data: unknown) => {
      const resolved = resolveDataPath(data, path);
      return Array.isArray(resolved) ? resolved : [];
    };

    return this.getDataWithInitial$(pageId).pipe(map(resolve));
  }

  /**
   * Get a specific value by path as Observable.
   * Emits the current cached value immediately, fetches if not cached,
   * and emits on future updates.
   */
  getJsonValue$(pageId: string, path: string): Observable<unknown> {
    return this.getDataWithInitial$(pageId).pipe(map((data) => resolveDataPath(data, path)));
  }

  /**
   * Get data Observable that emits the current cached value (or fetches it)
   * then emits on future updates.
   */
  private getDataWithInitial$(pageId: string): Observable<unknown> {
    const cached = this._documents().get(pageId);
    if (cached) {
      // Cached: emit immediately, then subscribe to future updates
      return this.getData$(pageId).pipe(startWith(cached.data));
    }
    // Not cached: fetch first, then subscribe to updates
    return this.fetchDocument(pageId).pipe(
      map((doc) => doc.data),
      catchError(() => of(undefined)),
      switchMap((initialData) => this.getData$(pageId).pipe(startWith(initialData))),
    );
  }

  /**
   * Fetch JSON document from server
   */
  fetchDocument(pageId: string): Observable<JsonDocument> {
    return this.http.get<{ document: JsonDocument }>(`/api/json-documents/${pageId}`).pipe(
      map((res) => res.document),
      tap((doc) => {
        this._documents.update((docs) => {
          const updated = new Map(docs);
          updated.set(pageId, {
            data: doc.data,
            schema: doc.schema,
            version: doc.version,
          });
          return updated;
        });
        // Emit initial data
        this._dataUpdates.next({ pageId, data: doc.data });
      }),
    );
  }

  /**
   * Replace entire data payload (PUT)
   */
  replaceData(pageId: string, data: unknown, version: number): Observable<JsonDocument> {
    return this.http
      .put<{ document: JsonDocument }>(`/api/json-documents/${pageId}/data`, {
        data,
        version,
      })
      .pipe(
        map((res) => res.document),
        tap((doc) => {
          this._documents.update((docs) => {
            const updated = new Map(docs);
            updated.set(pageId, {
              data: doc.data,
              schema: doc.schema,
              version: doc.version,
            });
            return updated;
          });
          this._dataUpdates.next({ pageId, data: doc.data });
        }),
      );
  }

  /**
   * Patch data using JSON Merge Patch (PATCH)
   */
  patchData(pageId: string, patch: unknown, version: number): Observable<JsonDocument> {
    return this.http
      .patch<{ document: JsonDocument }>(`/api/json-documents/${pageId}/data`, {
        patch,
        version,
      })
      .pipe(
        map((res) => res.document),
        tap((doc) => {
          this._documents.update((docs) => {
            const updated = new Map(docs);
            updated.set(pageId, {
              data: doc.data,
              schema: doc.schema,
              version: doc.version,
            });
            return updated;
          });
          this._dataUpdates.next({ pageId, data: doc.data });
        }),
      );
  }

  /**
   * Set/replace JSON Schema
   */
  setSchema(pageId: string, schema: unknown): Observable<JsonDocument> {
    return this.http
      .put<{ document: JsonDocument }>(`/api/json-documents/${pageId}/schema`, { schema })
      .pipe(
        map((res) => res.document),
        tap((doc) => {
          this._documents.update((docs) => {
            const updated = new Map(docs);
            const existing = docs.get(pageId);
            updated.set(pageId, {
              data: existing?.data ?? doc.data,
              schema: doc.schema,
              version: doc.version,
            });
            return updated;
          });
        }),
      );
  }

  /**
   * Remove JSON Schema
   */
  removeSchema(pageId: string): Observable<JsonDocument> {
    return this.http
      .delete<{ document: JsonDocument }>(`/api/json-documents/${pageId}/schema`)
      .pipe(
        map((res) => res.document),
        tap((doc) => {
          this._documents.update((docs) => {
            const updated = new Map(docs);
            const existing = docs.get(pageId);
            updated.set(pageId, {
              data: existing?.data ?? doc.data,
              schema: null,
              version: doc.version,
            });
            return updated;
          });
        }),
      );
  }

  /**
   * Create a new JSON page + initialize the JSON document
   */
  async createJsonPage(notebookId?: string): Promise<{ page: Page }> {
    const id = crypto.randomUUID();

    const page = await lastValueFrom(
      this.pageService.createPage({
        id,
        title: 'Untitled JSON',
        content: { type: 'doc', content: [] },
        notebookId,
        type: 'json',
      }),
    );

    // Fetch (which auto-creates) the JSON document
    await firstValueFrom(this.fetchDocument(page.id));

    return { page };
  }

  /**
   * Resolve a dot-delimited path with array index support
   * e.g., 'items[0].name', 'user.address.city'
   */
  resolveDataPath(pageId: string, path: string): unknown {
    const doc = this._documents().get(pageId);
    if (!doc) return undefined;
    return resolveDataPath(doc.data, path);
  }

  /**
   * Clean up cached data for a page
   */
  clearCache(pageId: string): void {
    this._documents.update((docs) => {
      const updated = new Map(docs);
      updated.delete(pageId);
      return updated;
    });
  }
}

/**
 * Resolve a dot-delimited path on an object
 * Supports array indices: 'items[0].name'
 */
export function resolveDataPath(data: unknown, path: string): unknown {
  if (!path || data === undefined || data === null) return data;

  // Parse path segments: 'items[0].name' -> ['items', '0', 'name']
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: unknown = data;
  for (const segment of segments) {
    if (current === undefined || current === null) return undefined;

    if (typeof current === 'object') {
      if (Array.isArray(current)) {
        const index = parseInt(segment, 10);
        if (isNaN(index)) return undefined;
        current = current[index];
      } else {
        current = (current as Record<string, unknown>)[segment];
      }
    } else {
      return undefined;
    }
  }

  return current;
}
