import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { PageContent } from '@maple/shared';

export interface PublicNotebook {
  slug: string;
  displayName: string;
  description?: string;
  logoUrl?: string;
  faviconUrl?: string;
  showPageList: boolean;
  landingPageId?: string;
}

export interface PublicPageSummary {
  slug: string;
  title: string;
  type: string;
  updatedAt: string;
  order: number;
}

export interface PublicPageDetail {
  slug: string;
  title: string;
  type: string;
  content: PageContent;
  publishedAt: string;
  todoMeta?: {
    hasTodos: boolean;
    todoCount: number;
    completedCount: number;
    overdueCount: number;
  };
}

export interface PublicPageResponse {
  page: PublicPageDetail;
  links: {
    backlinks: Array<{ slug: string; title: string }>;
  };
}

@Injectable({ providedIn: 'root' })
export class PublicNotebookService {
  private readonly http = inject(HttpClient);

  readonly notebook = signal<PublicNotebook | null>(null);
  readonly pages = signal<PublicPageSummary[]>([]);
  readonly activePage = signal<PublicPageDetail | null>(null);
  readonly backlinks = signal<Array<{ slug: string; title: string }>>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly sortedPages = computed(() => [...this.pages()].sort((a, b) => a.order - b.order));

  async loadNotebook(slug: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const res = await firstValueFrom(
        this.http.get<{ notebook: PublicNotebook; pages: PublicPageSummary[] }>(
          `/api/public/notebooks/${encodeURIComponent(slug)}`,
        ),
      );
      this.notebook.set(res.notebook);
      this.pages.set(res.pages);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load notebook';
      this.error.set(message);
      this.notebook.set(null);
      this.pages.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async loadPage(notebookSlug: string, pageSlug: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const res = await firstValueFrom(
        this.http.get<PublicPageResponse>(
          `/api/public/notebooks/${encodeURIComponent(notebookSlug)}/pages/${encodeURIComponent(pageSlug)}`,
        ),
      );
      this.activePage.set(res.page);
      this.backlinks.set(res.links.backlinks);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load page';
      this.error.set(message);
      this.activePage.set(null);
      this.backlinks.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  reset(): void {
    this.notebook.set(null);
    this.pages.set([]);
    this.activePage.set(null);
    this.backlinks.set([]);
    this.error.set(null);
  }
}
