import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, tap, of, firstValueFrom } from 'rxjs';
import type { Page } from '@maple/shared';

export interface TagWithMeta {
  name: string;
  count: number;
  color: string | null;
}

export interface TagsResponse {
  tags: TagWithMeta[];
}

export interface TagPagesResponse {
  pages: Page[];
}

export interface TagColorsResponse {
  colors: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class TagService {
  private readonly http = inject(HttpClient);

  // State signals
  private readonly _tags = signal<TagWithMeta[]>([]);
  private readonly _tagColors = signal<Record<string, string>>({});
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly tags = this._tags.asReadonly();
  readonly tagColors = this._tagColors.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  // Computed signals
  readonly tagCount = computed(() => this._tags().length);
  readonly tagNames = computed(() => this._tags().map((t) => t.name));
  readonly sortedTags = computed(() => [...this._tags()].sort((a, b) => b.count - a.count));

  /**
   * Load all tags for the current user
   */
  loadTags(): Observable<TagWithMeta[]> {
    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<TagsResponse>('/api/tags').pipe(
      tap((response) => {
        this._tags.set(response.tags);
        // Update tag colors from response
        const colors: Record<string, string> = {};
        for (const tag of response.tags) {
          if (tag.color) {
            colors[tag.name] = tag.color;
          }
        }
        this._tagColors.set(colors);
        this._isLoading.set(false);
      }),
      map((response) => response.tags),
      catchError((err) => {
        const message = err?.error?.message || err?.error?.error || 'Failed to load tags';
        this._error.set(message);
        this._isLoading.set(false);
        return of([]);
      }),
    );
  }

  /**
   * Get pages with a specific tag
   */
  getPagesByTag(
    tag: string,
    options?: { notebookId?: string; limit?: number; offset?: number },
  ): Observable<Page[]> {
    const encodedTag = encodeURIComponent(tag);
    let url = `/api/tags/${encodedTag}/pages`;

    const params: string[] = [];
    if (options?.notebookId) params.push(`notebookId=${options.notebookId}`);
    if (options?.limit) params.push(`limit=${options.limit}`);
    if (options?.offset) params.push(`offset=${options.offset}`);

    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    return this.http.get<TagPagesResponse>(url).pipe(
      map((response) => response.pages),
      catchError(() => of([])),
    );
  }

  /**
   * Set color for a tag
   */
  setTagColor(tag: string, color: string): Observable<boolean> {
    const encodedTag = encodeURIComponent(tag);
    return this.http.put<{ success: boolean }>(`/api/tags/${encodedTag}/color`, { color }).pipe(
      tap(() => {
        // Update local state
        this._tagColors.update((colors) => ({ ...colors, [tag]: color }));
        this._tags.update((tags) => tags.map((t) => (t.name === tag ? { ...t, color } : t)));
      }),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Remove color for a tag (reset to default)
   */
  removeTagColor(tag: string): Observable<boolean> {
    const encodedTag = encodeURIComponent(tag);
    return this.http.delete<{ success: boolean }>(`/api/tags/${encodedTag}/color`).pipe(
      tap(() => {
        // Update local state
        this._tagColors.update((colors) => {
          const updated = { ...colors };
          delete updated[tag];
          return updated;
        });
        this._tags.update((tags) => tags.map((t) => (t.name === tag ? { ...t, color: null } : t)));
      }),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Load tag colors for the current user
   */
  loadTagColors(): Observable<Record<string, string>> {
    return this.http.get<TagColorsResponse>('/api/tags/colors').pipe(
      tap((response) => {
        this._tagColors.set(response.colors);
      }),
      map((response) => response.colors),
      catchError(() => of({})),
    );
  }

  /**
   * Get color for a specific tag (synchronous, from cache)
   */
  getTagColor(tag: string): string | null {
    return this._tagColors()[tag] || null;
  }

  /**
   * Get tag suggestions for autocomplete
   */
  getTagSuggestions(): { name: string; count?: number; color?: string | null }[] {
    return this._tags().map((t) => ({
      name: t.name,
      count: t.count,
      color: t.color,
    }));
  }

  /**
   * Refresh tags from server
   */
  async refresh(): Promise<void> {
    await firstValueFrom(this.loadTags());
  }

  /**
   * Add a tag to local cache (optimistic update)
   * Used when creating a new tag in the editor before it's saved
   */
  addTagToCache(tag: string): void {
    const existing = this._tags().find((t) => t.name === tag);
    if (!existing) {
      this._tags.update((tags) => [...tags, { name: tag, count: 1, color: null }]);
    }
  }
}
