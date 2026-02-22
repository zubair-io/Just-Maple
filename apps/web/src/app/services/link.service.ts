import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
import type { LinkSearchResult, PageLink, UnlinkedMention } from '@maple/shared';

export interface LinkSearchParams {
  q: string;
  limit?: number;
  notebookId?: string;
  excludePageId?: string;
}

@Injectable({ providedIn: 'root' })
export class LinkService {
  private readonly http = inject(HttpClient);

  /**
   * Search for pages to link to
   */
  search(params: LinkSearchParams): Observable<LinkSearchResult[]> {
    const httpParams: Record<string, string> = { q: params.q };
    if (params.limit) httpParams['limit'] = params.limit.toString();
    if (params.notebookId) httpParams['notebookId'] = params.notebookId;
    if (params.excludePageId) httpParams['excludePageId'] = params.excludePageId;

    return this.http
      .get<{ pages: LinkSearchResult[] }>('/api/links/search', { params: httpParams })
      .pipe(
        map((response) => response.pages),
        catchError((err) => {
          console.error('Link search failed:', err);
          return of([]);
        }),
      );
  }

  /**
   * Get backlinks for a page (pages that link TO this page)
   */
  getBacklinks(pageId: string): Observable<PageLink[]> {
    return this.http.get<{ backlinks: PageLink[] }>(`/api/links/${pageId}/backlinks`).pipe(
      map((response) => response.backlinks),
      catchError((err) => {
        console.error('Failed to load backlinks:', err);
        return of([]);
      }),
    );
  }

  /**
   * Get unlinked mentions for a page (pages that mention this page's title but don't link to it)
   */
  getUnlinkedMentions(pageId: string, notebookId: string): Observable<UnlinkedMention[]> {
    return this.http
      .get<{ mentions: UnlinkedMention[] }>(`/api/links/${pageId}/unlinked`, {
        params: { notebookId },
      })
      .pipe(
        map((response) => response.mentions),
        catchError((err) => {
          console.error('Failed to load unlinked mentions:', err);
          return of([]);
        }),
      );
  }
}
