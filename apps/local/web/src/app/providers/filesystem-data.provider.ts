import { Injectable, inject } from '@angular/core';
import { Observable, switchMap, map, of, throwError, from } from 'rxjs';
import {
  FileSystemService,
  type LocalFile,
  type LocalFolder,
} from '../services/file-system.service';
import type {
  FolderDataProvider,
  PageDataProvider,
  ProviderCapabilities,
  DataSourceType,
} from './data-provider.interface';
import { LOCAL_FS_CAPABILITIES, isLocalFolder } from './data-provider.interface';
import type {
  Folder,
  CreateFolderInput,
  UpdateFolderInput,
  Page,
  CreatePageInput,
  UpdatePageInput,
} from '../shared/schemas';

/**
 * Convert a LocalFolder to a Folder.
 * Maps file system folders to the app's Folder data model.
 */
function localFolderToFolder(folder: LocalFolder): Folder {
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
    folderId: file.folderId,
    isFavorite: false,
    isArchived: false,
    isTrashed: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Folder data provider backed by the local file system.
 * Each open folder appears as a folder entry.
 */
@Injectable({ providedIn: 'root' })
export class FileSystemFolderProvider implements FolderDataProvider {
  readonly type: DataSourceType = 'local';
  readonly capabilities: ProviderCapabilities = LOCAL_FS_CAPABILITIES;

  private readonly fsService = inject(FileSystemService);

  /**
   * Load all open local folders
   */
  loadFolders(): Observable<Folder[]> {
    const folders = this.fsService.openFolders();
    return of(folders.map(localFolderToFolder));
  }

  /**
   * Create a new folder.
   * For file system, this opens the folder picker.
   */
  createFolder(_data: CreateFolderInput): Observable<Folder> {
    return this.fsService.openFolderPicker().pipe(
      map((folder) => {
        if (!folder) {
          throw new Error('No folder selected');
        }
        return localFolderToFolder(folder);
      }),
    );
  }

  /**
   * Update a folder (rename).
   * Note: Renaming folders is not supported via File System Access API.
   * We persist the display label override to IndexedDB.
   */
  updateFolder(id: string, data: UpdateFolderInput): Observable<Folder> {
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
    const folderData = localFolderToFolder(updatedFolder);
    folderData.updatedAt = new Date().toISOString();
    return of(folderData);
  }

  /**
   * Delete/close a local folder.
   * This doesn't delete the folder from disk - just removes it from the app.
   */
  deleteFolder(id: string): Observable<void> {
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
   * If folderId is provided, loads from that specific folder.
   * Otherwise, loads from all open folders.
   */
  loadPages(filters?: { folderId?: string }): Observable<Page[]> {
    // Wait for folder handles to be restored from IndexedDB on reload
    return from(this.fsService.whenReady).pipe(
      switchMap(() => {
        const folders = this.fsService.openFolders();

        if (filters?.folderId) {
          // Only load if this is a local folder
          if (!isLocalFolder(filters.folderId)) {
            return of([]);
          }

          return this.fsService
            .listMarkdownFiles(filters.folderId)
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
      }),
    );
  }

  /**
   * Get a single page by reading its markdown file
   */
  getPage(pageId: string): Observable<Page> {
    // Find which folder this page belongs to
    const folders = this.fsService.openFolders();
    for (const folder of folders) {
      if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
        const filename = this.fsService.getFilenameFromId(pageId, folder.id);
        return of(
          fileToPage({
            id: pageId,
            name: filename.replace(/\.md$/, ''),
            extension: '.md',
            folderId: folder.id,
            lastModified: new Date().toISOString(),
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
    const folderId = data.folderId;
    if (!folderId || !isLocalFolder(folderId)) {
      return throwError(() => new Error('Must specify a local folder ID'));
    }

    const rawTitle = data.title || 'Untitled';
    // Strip existing .md extension to avoid double extension
    const title = rawTitle.replace(/\.md$/i, '');
    const filename = `${title}.md`;
    const initialContent = `# ${title}\n\n`;

    return this.fsService.createFile(folderId, filename, initialContent).pipe(
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
   * Get raw markdown content for a page.
   * Waits for folder handles to be restored from IndexedDB on reload.
   */
  getMarkdownContent(pageId: string): Observable<string | null> {
    return from(this.fsService.whenReady).pipe(
      switchMap(() => {
        const folders = this.fsService.openFolders();
        for (const folder of folders) {
          if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
            return this.fsService.readFile(folder.id, pageId);
          }
        }
        return of(null);
      }),
    );
  }

  /**
   * Save raw markdown content for a page.
   * Waits for folder handles to be restored from IndexedDB on reload.
   */
  saveMarkdownContent(pageId: string, content: string): Observable<void> {
    return from(this.fsService.whenReady).pipe(
      switchMap(() => {
        const folders = this.fsService.openFolders();
        for (const folder of folders) {
          if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
            return this.fsService.writeFile(folder.id, pageId, content);
          }
        }
        return throwError(() => new Error(`Local page not found: ${pageId}`));
      }),
    );
  }

  /**
   * Convert files to pages, using filenames as titles.
   */
  private filesToPagesWithTitles(files: LocalFile[]): Observable<Page[]> {
    return of(files.map((file) => fileToPage(file)));
  }
}
