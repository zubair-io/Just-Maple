import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, from, map, of, tap, Subject, debounceTime, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { SearchResult, SearchResponse } from '@maple/shared';
import { LocalStorageProvider } from './local-storage-provider';
import { AuthService } from './auth.service';
import { NotebookService } from './notebook.service';
import { isLocalNotebook } from '../providers/data-provider.interface';

export interface SearchFilters {
  notebookIds?: string[];
  types?: string[];
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

const RECENT_SEARCHES_KEY = 'maple_recent_searches';
const MAX_RECENT_SEARCHES = 10;

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly localProvider = inject(LocalStorageProvider);
  private readonly authService = inject(AuthService);
  private readonly notebookService = inject(NotebookService);

  // State signals
  private readonly _isSearching = signal(false);
  private readonly _results = signal<SearchResult[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly _recentSearches = signal<string[]>(this.loadRecentSearches());

  // Public readonly signals
  readonly isSearching = this._isSearching.asReadonly();
  readonly results = this._results.asReadonly();
  readonly error = this._error.asReadonly();
  readonly recentSearches = this._recentSearches.asReadonly();

  // Computed signals
  readonly hasResults = computed(() => this._results().length > 0);
  readonly resultCount = computed(() => this._results().length);

  // Search subject for debouncing
  private readonly searchSubject = new Subject<{ query: string; filters?: SearchFilters }>();

  constructor() {
    // Set up debounced search
    this.searchSubject
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(300),
        switchMap(({ query, filters }) => this.executeSearch(query, filters)),
      )
      .subscribe();
  }

  /**
   * Trigger a debounced search
   */
  search(query: string, filters?: SearchFilters): void {
    if (!query.trim()) {
      this.clearResults();
      return;
    }
    this._isSearching.set(true);
    this.searchSubject.next({ query, filters });
  }

  /**
   * Execute search immediately (bypassing debounce)
   */
  searchImmediate(query: string, filters?: SearchFilters): Observable<SearchResult[]> {
    if (!query.trim()) {
      this.clearResults();
      return of([]);
    }
    return this.executeSearch(query, filters);
  }

  /**
   * Clear search results
   */
  clearResults(): void {
    this._results.set([]);
    this._error.set(null);
    this._isSearching.set(false);
  }

  /**
   * Add a query to recent searches
   */
  addToRecentSearches(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;

    const recent = this._recentSearches();
    const filtered = recent.filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
    const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);

    this._recentSearches.set(updated);
    this.saveRecentSearches(updated);
  }

  /**
   * Remove a query from recent searches
   */
  removeFromRecentSearches(query: string): void {
    const recent = this._recentSearches();
    const updated = recent.filter((q) => q !== query);
    this._recentSearches.set(updated);
    this.saveRecentSearches(updated);
  }

  /**
   * Clear all recent searches
   */
  clearRecentSearches(): void {
    this._recentSearches.set([]);
    this.saveRecentSearches([]);
  }

  /**
   * Trigger reindex for current user
   */
  reindex(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/search/reindex', {});
  }

  /**
   * Update tags for a specific page in the search index
   */
  updatePageTags(pageId: string, tags: string[]): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`/api/search/${pageId}/tags`, { tags });
  }

  private executeSearch(query: string, filters?: SearchFilters): Observable<SearchResult[]> {
    this._isSearching.set(true);
    this._error.set(null);

    const hasLocalNotebooks = this.notebookService.notebooks().some((n) => isLocalNotebook(n._id));
    const isAuthenticated = this.authService.isAuthenticated();

    // Determine which search sources to query
    const localSearch$ = hasLocalNotebooks
      ? from(this.searchLocal(query, filters))
      : of([] as SearchResult[]);

    const cloudSearch$ = isAuthenticated
      ? this.searchCloud(query, filters)
      : of([] as SearchResult[]);

    // Run both in parallel and merge results
    return localSearch$.pipe(
      switchMap((localResults) =>
        cloudSearch$.pipe(map((cloudResults) => [...localResults, ...cloudResults])),
      ),
      tap((merged) => {
        this._results.set(merged);
        this._isSearching.set(false);
      }),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Search failed';
        this._error.set(message);
        this._results.set([]);
        this._isSearching.set(false);
        return of([]);
      }),
    );
  }

  private async searchLocal(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    const localNotebooks = this.notebookService.notebooks().filter((n) => isLocalNotebook(n._id));

    // If filtering by specific notebooks, only search matching local ones
    const targetNotebooks = filters?.notebookIds?.length
      ? localNotebooks.filter((n) => filters.notebookIds!.includes(n._id))
      : localNotebooks;

    const allResults: SearchResult[] = [];

    for (const notebook of targetNotebooks) {
      const localResults = await this.localProvider.search(query, notebook._id);
      for (const r of localResults) {
        allResults.push({
          pageId: r.pageId,
          title: r.title,
          type: 'memo',
          notebookId: notebook._id,
          notebookLabel: notebook.label,
          preview: r.snippet,
          snippet: r.snippet,
          score: r.score,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return allResults;
  }

  private searchCloud(query: string, filters?: SearchFilters): Observable<SearchResult[]> {
    let params = new HttpParams().set('q', query);

    // Only pass non-local notebook IDs to cloud search
    const cloudNotebookIds = filters?.notebookIds?.filter((id) => !isLocalNotebook(id));
    if (cloudNotebookIds?.length) {
      params = params.set('notebookIds', cloudNotebookIds.join(','));
    }
    if (filters?.types?.length) {
      params = params.set('types', filters.types.join(','));
    }
    if (filters?.tags?.length) {
      params = params.set('tags', filters.tags.join(','));
    }
    if (filters?.dateFrom) {
      params = params.set('dateFrom', filters.dateFrom.toISOString());
    }
    if (filters?.dateTo) {
      params = params.set('dateTo', filters.dateTo.toISOString());
    }
    if (filters?.limit) {
      params = params.set('limit', filters.limit.toString());
    }
    if (filters?.offset) {
      params = params.set('offset', filters.offset.toString());
    }

    return this.http.get<SearchResponse>('/api/search', { params }).pipe(
      map((response) => response.results),
      catchError(() => of([])),
    );
  }

  private loadRecentSearches(): string[] {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private saveRecentSearches(searches: string[]): void {
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
    } catch {
      // localStorage might be full or disabled
    }
  }
}
