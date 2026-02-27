import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PageService } from './page.service';
import { FileSystemService } from './file-system.service';
import { parseFrontmatter, markdownBodyToDoc } from '@maple/shared';
import type { CreatePageInput } from '@maple/shared';

export interface ImportProgress {
  total: number;
  completed: number;
  currentFile?: string;
  errors: string[];
  importedPageIds: string[];
}

/**
 * Import local .maple.md files into a cloud notebook.
 *
 * Reads .maple.md files from a local folder, parses frontmatter + markdown,
 * converts to ProseMirror JSON, and creates cloud pages via the API.
 */
@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly pageService = inject(PageService);
  private readonly fsService = inject(FileSystemService);

  /**
   * Import all .maple.md files from a local folder into a cloud notebook.
   *
   * @param folderId The local folder ID to import from
   * @param targetNotebookId The cloud notebook ID to import into
   * @param onProgress Callback for progress updates
   */
  async importFolder(
    folderId: string,
    targetNotebookId: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportProgress> {
    const files = await firstValueFrom(this.fsService.listMarkdownFiles(folderId));

    // Filter for .maple.md files
    const mapleFiles = files.filter((f) => f.name.endsWith('.maple'));

    const progress: ImportProgress = {
      total: mapleFiles.length,
      completed: 0,
      errors: [],
      importedPageIds: [],
    };
    onProgress?.(progress);

    for (const file of mapleFiles) {
      progress.currentFile = file.name;
      onProgress?.(progress);

      try {
        const content = await firstValueFrom(this.fsService.readFile(folderId, file.id));
        const pageId = await this.importFile(content, targetNotebookId);
        progress.importedPageIds.push(pageId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress.errors.push(`${file.name}: ${message}`);
      }

      progress.completed++;
      onProgress?.(progress);
    }

    return progress;
  }

  /**
   * Import a single .maple.md file content into a cloud notebook.
   * Returns the created page ID.
   */
  async importFile(rawContent: string, targetNotebookId: string): Promise<string> {
    const result = parseFrontmatter(rawContent);

    let title = 'Imported Note';
    let body = rawContent;

    if (!('error' in result)) {
      title = (result.meta['title'] as string) || title;
      body = result.body;
    }

    // Convert markdown body to ProseMirror JSON
    const doc = markdownBodyToDoc(body);

    const input: CreatePageInput = {
      title,
      type: 'memo',
      notebookId: targetNotebookId,
      content: doc,
    };

    const page = await firstValueFrom(this.pageService.createPage(input));
    return page.id;
  }
}
