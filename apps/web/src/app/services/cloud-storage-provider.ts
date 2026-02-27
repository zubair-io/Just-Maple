import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotebookService } from './notebook.service';
import { PageService } from './page.service';
import { MemoVersionService } from './memo-version.service';
import { SearchService } from './search.service';
import type {
  StorageProvider,
  StorageProviderType,
  LocalNotebook,
  PageMeta,
  PageData,
  PageSnapshot,
  LocalSearchResult,
  FileChange,
  SaveOptions,
  AssetFile,
} from '@maple/shared';
import type { Notebook, Page } from '@maple/shared';

/**
 * StorageProvider backed by the existing cloud REST API.
 *
 * This is a thin adapter that translates between the StorageProvider
 * interface and the existing Angular services (NotebookService,
 * PageService, MemoVersionService, SearchService).
 */
@Injectable({ providedIn: 'root' })
export class CloudStorageProvider implements StorageProvider {
  readonly type: StorageProviderType = 'cloud';

  private readonly notebookService = inject(NotebookService);
  private readonly pageService = inject(PageService);
  private readonly versionService = inject(MemoVersionService);
  private readonly searchService = inject(SearchService);

  // ─── Notebook operations ──────────────────────────────────────────

  async listNotebooks(): Promise<LocalNotebook[]> {
    const notebooks = await firstValueFrom(this.notebookService.loadNotebooks());
    return notebooks.map((nb) => this.notebookToLocal(nb));
  }

  async createNotebook(label: string): Promise<LocalNotebook> {
    const nb = await firstValueFrom(this.notebookService.createNotebook({ label, value: 'notes' }));
    return this.notebookToLocal(nb);
  }

  // ─── Page operations ──────────────────────────────────────────────

  async listPages(notebookId: string): Promise<PageMeta[]> {
    const pages = await firstValueFrom(this.pageService.loadPages({ notebookId }));
    return pages.map((p) => this.pageToMeta(p));
  }

  async getPage(pageId: string): Promise<PageData> {
    const page = await firstValueFrom(this.pageService.getPage(pageId));
    return {
      meta: this.pageToMeta(page),
      body: '', // Cloud pages use Y.js state, not raw markdown body
    };
  }

  async savePage(pageId: string, data: PageData, options?: SaveOptions): Promise<void> {
    await firstValueFrom(
      this.pageService.updatePage(pageId, {
        title: data.meta.title,
        isFavorite: data.meta.isFavorite,
        isArchived: data.meta.isArchived,
      }),
    );

    if (options?.significant) {
      await firstValueFrom(this.versionService.createCheckpoint(pageId));
    }
  }

  async deletePage(pageId: string): Promise<void> {
    await firstValueFrom(this.pageService.deletePage(pageId));
  }

  // ─── Assets ───────────────────────────────────────────────────────

  async saveAsset(_notebookId: string, _file: AssetFile): Promise<string> {
    // Cloud asset uploads go through the existing image upload endpoint
    // which is handled by the editor's image extension directly.
    // This is a placeholder for the StorageProvider interface.
    throw new Error('Use the editor image upload flow for cloud assets');
  }

  getAssetUrl(_notebookId: string, path: string): string {
    return path;
  }

  // ─── History ──────────────────────────────────────────────────────

  async getHistory(pageId: string): Promise<PageSnapshot[]> {
    const response = await firstValueFrom(this.versionService.getVersions(pageId));
    return response.versions.map((v) => ({
      id: v._id,
      pageId,
      timestamp: v.createdAt,
      filename: '',
      label: v.label,
    }));
  }

  async restoreSnapshot(pageId: string, snapshotId: string): Promise<void> {
    await firstValueFrom(this.versionService.restoreVersion(pageId, snapshotId));
  }

  // ─── Search ───────────────────────────────────────────────────────

  async search(query: string, notebookId?: string): Promise<LocalSearchResult[]> {
    const filters = notebookId ? { notebookIds: [notebookId] } : undefined;
    this.searchService.search(query, filters);

    // Wait for results to populate (search is debounced internally)
    await new Promise((resolve) => setTimeout(resolve, 400));

    return this.searchService.results().map((r) => ({
      pageId: r.pageId,
      title: r.title,
      snippet: r.snippet || '',
      score: r.score || 1,
    }));
  }

  // ─── Watch ────────────────────────────────────────────────────────

  watch(_notebookId: string, _callback: (changes: FileChange[]) => void): () => void {
    // Cloud uses WebSocket for real-time events, which is already
    // handled by RealtimeWSService. No additional watch needed.
    return () => {};
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private notebookToLocal(nb: Notebook): LocalNotebook {
    return {
      id: nb._id,
      label: nb.label,
      createdAt: nb.createdAt || new Date().toISOString(),
    };
  }

  private pageToMeta(page: Page): PageMeta {
    return {
      id: page.id,
      title: page.title || 'Untitled',
      type: page.type,
      modified: page.updatedAt || page.createdAt || new Date().toISOString(),
      created: page.createdAt || new Date().toISOString(),
      isFavorite: page.isFavorite,
      isArchived: page.isArchived,
      todoMeta: page.todoMeta,
    };
  }
}
