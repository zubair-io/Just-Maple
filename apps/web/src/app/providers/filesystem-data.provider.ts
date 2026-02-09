import { Injectable, inject } from '@angular/core';
import { Observable, switchMap, map, of, throwError, from } from 'rxjs';
import {
  FileSystemService,
  type LocalFile,
  type LocalFolder,
} from '../services/file-system.service';
import type {
  NotebookDataProvider,
  PageDataProvider,
  ProviderCapabilities,
  DataSourceType,
} from './data-provider.interface';
import { LOCAL_FS_CAPABILITIES, isLocalNotebook } from './data-provider.interface';
import type {
  Notebook,
  CreateNotebookInput,
  UpdateNotebookInput,
  Page,
  CreatePageInput,
  UpdatePageInput,
} from '@maple/shared';

/**
 * Convert a LocalFolder to a Notebook.
 * Maps file system folders to the app's Notebook data model.
 */
function folderToNotebook(folder: LocalFolder): Notebook {
  return {
    _id: folder.id,
    type: 'folder',
    value: 'notes',
    label: folder.labelOverride || folder.name,
    sharing: {
      sharedWith: [],
      isPublic: false,
    },
    createdAt: folder.openedAt,
    updatedAt: folder.openedAt,
  };
}

/**
 * Convert a LocalFile to a Page (memo type).
 * Maps markdown files to the app's Page data model.
 */
function fileToPage(file: LocalFile): Page {
  const now = file.lastModified || new Date().toISOString();
  return {
    _id: file.id,
    id: file.id,
    userId: 'local',
    type: 'memo',
    title: file.name || 'Untitled',
    content: { type: 'doc', content: [] },
    notebookId: file.folderId,
    isFavorite: false,
    isArchived: false,
    isTrashed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Extract the H1 title from markdown content.
 * Falls back to the filename if no H1 is found.
 */
function extractTitleFromMarkdown(content: string, fallback: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  return h1Match ? h1Match[1].trim() : fallback;
}

/**
 * Notebook data provider backed by the local file system.
 * Each open folder appears as a notebook.
 */
@Injectable({ providedIn: 'root' })
export class FileSystemNotebookProvider implements NotebookDataProvider {
  readonly type: DataSourceType = 'local';
  readonly capabilities: ProviderCapabilities = LOCAL_FS_CAPABILITIES;

  private readonly fsService = inject(FileSystemService);

  /**
   * Load all open local folders as notebooks
   */
  loadNotebooks(): Observable<Notebook[]> {
    const folders = this.fsService.openFolders();
    return of(folders.map(folderToNotebook));
  }

  /**
   * Create a new folder/notebook.
   * For file system, this opens the folder picker.
   */
  createNotebook(_data: CreateNotebookInput): Observable<Notebook> {
    return this.fsService.openFolderPicker().pipe(
      map((folder) => {
        if (!folder) {
          throw new Error('No folder selected');
        }
        return folderToNotebook(folder);
      }),
    );
  }

  /**
   * Update a notebook (rename folder).
   * Note: Renaming folders is not supported via File System Access API.
   * We persist the display label override to IndexedDB.
   */
  updateNotebook(id: string, data: UpdateNotebookInput): Observable<Notebook> {
    const folders = this.fsService.openFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) {
      return throwError(() => new Error(`Local folder not found: ${id}`));
    }

    if (data.label) {
      this.fsService.updateFolderLabel(id, data.label);
    }

    // Re-read the folder after update to get the persisted state
    const updatedFolder = this.fsService.openFolders().find((f) => f.id === id) || folder;
    const notebook = folderToNotebook(updatedFolder);
    notebook.updatedAt = new Date().toISOString();
    return of(notebook);
  }

  /**
   * Delete/close a local folder notebook.
   * This doesn't delete the folder from disk - just removes it from the app.
   */
  deleteNotebook(id: string): Observable<void> {
    this.fsService.closeFolder(id);
    return of(undefined);
  }
}

/**
 * Page data provider backed by the local file system.
 * Each markdown file in an open folder appears as a memo page.
 */
@Injectable({ providedIn: 'root' })
export class FileSystemPageProvider implements PageDataProvider {
  readonly type: DataSourceType = 'local';
  readonly capabilities: ProviderCapabilities = LOCAL_FS_CAPABILITIES;

  private readonly fsService = inject(FileSystemService);

  /**
   * Load pages (markdown files) from local folders.
   * If notebookId is provided, loads from that specific folder.
   * Otherwise, loads from all open folders.
   */
  loadPages(filters?: { notebookId?: string }): Observable<Page[]> {
    const folders = this.fsService.openFolders();

    if (filters?.notebookId) {
      // Only load if this is a local notebook
      if (!isLocalNotebook(filters.notebookId)) {
        return of([]);
      }

      return this.fsService
        .listMarkdownFiles(filters.notebookId)
        .pipe(switchMap((files) => this.filesToPagesWithTitles(files)));
    }

    // Load from all open local folders
    if (folders.length === 0) return of([]);

    const observables = folders.map((folder) =>
      this.fsService
        .listMarkdownFiles(folder.id)
        .pipe(switchMap((files) => this.filesToPagesWithTitles(files))),
    );

    // Merge all folder results
    return new Observable<Page[]>((subscriber) => {
      const allPages: Page[] = [];
      let completed = 0;

      observables.forEach((obs) => {
        obs.subscribe({
          next: (pages) => {
            allPages.push(...pages);
          },
          error: () => {
            completed++;
            if (completed === observables.length) {
              subscriber.next(allPages);
              subscriber.complete();
            }
          },
          complete: () => {
            completed++;
            if (completed === observables.length) {
              subscriber.next(allPages);
              subscriber.complete();
            }
          },
        });
      });
    });
  }

  /**
   * Get a single page by reading its markdown file
   */
  getPage(pageId: string): Observable<Page> {
    // Find which folder this page belongs to
    const folders = this.fsService.openFolders();
    for (const folder of folders) {
      if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
        return this.fsService.readFile(folder.id, pageId).pipe(
          map((content) => {
            const filename = this.fsService.getFilenameFromId(pageId, folder.id);
            const title = extractTitleFromMarkdown(content, filename.replace(/\.md$/, ''));
            const page = fileToPage({
              id: pageId,
              name: filename.replace(/\.md$/, ''),
              extension: '.md',
              folderId: folder.id,
              lastModified: new Date().toISOString(),
            });
            page.title = title;
            return page;
          }),
        );
      }
    }

    return throwError(() => new Error(`Local page not found: ${pageId}`));
  }

  /**
   * Create a new markdown file as a page
   */
  createPage(data: CreatePageInput): Observable<Page> {
    const notebookId = data.notebookId;
    if (!notebookId || !isLocalNotebook(notebookId)) {
      return throwError(() => new Error('Must specify a local notebook ID'));
    }

    const rawTitle = data.title || 'Untitled';
    // Strip existing .md extension to avoid double extension
    const title = rawTitle.replace(/\.md$/i, '');
    const filename = `${title}.md`;
    const initialContent = `# ${title}\n\n`;

    return this.fsService.createFile(notebookId, filename, initialContent).pipe(
      map((file) => {
        const page = fileToPage(file);
        page.title = title;
        return page;
      }),
    );
  }

  /**
   * Update a page (rename or update content metadata)
   */
  updatePage(id: string, data: UpdatePageInput): Observable<Page> {
    const folders = this.fsService.openFolders();
    for (const folder of folders) {
      if (this.fsService.pageBelongsToFolder(id, folder.id)) {
        if (data.title) {
          // Rename the file
          return this.fsService.renameFile(folder.id, id, data.title).pipe(
            map((newFile) => {
              const page = fileToPage(newFile);
              page.title = data.title!;
              return page;
            }),
          );
        }

        // For other updates, just return the current state
        return this.getPage(id);
      }
    }

    return throwError(() => new Error(`Local page not found: ${id}`));
  }

  /**
   * Delete a markdown file
   */
  deletePage(id: string): Observable<void> {
    const folders = this.fsService.openFolders();
    for (const folder of folders) {
      if (this.fsService.pageBelongsToFolder(id, folder.id)) {
        return this.fsService.deleteFile(folder.id, id);
      }
    }

    return throwError(() => new Error(`Local page not found: ${id}`));
  }

  /**
   * Get raw markdown content for a page
   */
  getMarkdownContent(pageId: string): Observable<string | null> {
    const folders = this.fsService.openFolders();
    for (const folder of folders) {
      if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
        return this.fsService.readFile(folder.id, pageId);
      }
    }
    return of(null);
  }

  /**
   * Save raw markdown content for a page
   */
  saveMarkdownContent(pageId: string, content: string): Observable<void> {
    const folders = this.fsService.openFolders();
    for (const folder of folders) {
      if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
        return this.fsService.writeFile(folder.id, pageId, content);
      }
    }
    return throwError(() => new Error(`Local page not found: ${pageId}`));
  }

  /**
   * Convert files to pages, reading each file to extract the title from H1
   */
  private filesToPagesWithTitles(files: LocalFile[]): Observable<Page[]> {
    if (files.length === 0) return of([]);

    return from(this.readTitlesForFiles(files));
  }

  private async readTitlesForFiles(files: LocalFile[]): Promise<Page[]> {
    const pages: Page[] = [];

    for (const file of files) {
      const page = fileToPage(file);

      // Try to read first few bytes for the title
      try {
        const content = await new Promise<string>((resolve, reject) => {
          this.fsService.readFile(file.folderId, file.id).subscribe({
            next: (c) => resolve(c),
            error: (e) => reject(e),
          });
        });
        page.title = extractTitleFromMarkdown(content, file.name);
      } catch {
        // Use filename as title if we can't read the file
        page.title = file.name;
      }

      pages.push(page);
    }

    return pages;
  }
}
