import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, tap, Subject, debounceTime, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { SearchResult, SearchResponse } from '@maple/shared';

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

    let params = new HttpParams().set('q', query);

    if (filters?.notebookIds?.length) {
      params = params.set('notebookIds', filters.notebookIds.join(','));
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
      tap((response) => {
        this._results.set(response.results);
        this._isSearching.set(false);
      }),
      map((response) => response.results),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Search failed';
        this._error.set(message);
        this._results.set([]);
        this._isSearching.set(false);
        return of([]);
      }),
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
