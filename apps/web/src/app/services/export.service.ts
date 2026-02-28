import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PageService } from './page.service';
import { NotebookService } from './notebook.service';
import { FileSystemService } from './file-system.service';
import { serializeFrontmatter, toFilename, docToMarkdown } from '@maple/shared';
import type { FrontmatterMeta } from '@maple/shared';
import type { Page } from '@maple/shared';

export interface ExportProgress {
  total: number;
  completed: number;
  currentPage?: string;
  errors: string[];
}

/**
 * Export cloud notebook pages to local .maple.md files.
 *
 * Fetches all pages from a cloud notebook, converts each to
 * .maple.md format (frontmatter + markdown body), and writes
 * them to a user-selected folder.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly fsService = inject(FileSystemService);

  /**
   * Export a cloud notebook to a local folder.
   *
   * @param notebookId The cloud notebook ID to export
   * @param onProgress Callback for progress updates
   * @returns The folder ID where files were exported
   */
  async exportNotebook(
    notebookId: string,
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<string> {
    // Open folder picker
    const folder = await firstValueFrom(this.fsService.openFolderPicker());
    if (!folder) throw new Error('No folder selected');

    // Load all pages from the notebook
    const pages = await firstValueFrom(this.pageService.loadPages({ notebookId }));

    const progress: ExportProgress = {
      total: pages.length,
      completed: 0,
      errors: [],
    };
    onProgress?.(progress);

    for (const page of pages) {
      progress.currentPage = page.title;
      onProgress?.(progress);

      try {
        await this.exportPage(page, folder.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress.errors.push(`${page.title}: ${message}`);
      }

      progress.completed++;
      onProgress?.(progress);
    }

    return folder.id;
  }

  /**
   * Export a single page to a local folder as a .maple.md file.
   */
  async exportPage(page: Page, folderId: string): Promise<void> {
    const meta: FrontmatterMeta = {
      id: page.id,
      type: page.type,
      created: page.createdAt || new Date().toISOString(),
      modified: page.updatedAt || new Date().toISOString(),
      ...(page.isFavorite ? { isFavorite: true } : {}),
      ...(page.isArchived ? { isArchived: true } : {}),
      ...(page.todoMeta ? { todoMeta: page.todoMeta } : {}),
    };

    // Convert ProseMirror JSON to markdown body
    let body = '';
    if (page.content && page.content.content) {
      body = docToMarkdown(page.content);
    }

    // Build the .maple.md content
    const content = serializeFrontmatter(meta, body);
    const filename = toFilename(page.title || 'Untitled', page.id);

    // Write file using FileSystemService
    const fileId = this.fsService.generateFileId(folderId, filename);
    await firstValueFrom(this.fsService.writeFile(folderId, fileId, content));
  }
}
