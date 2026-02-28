import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, from, of, throwError, firstValueFrom, timeout } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { NativeBridgeService } from './native-bridge.service';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';
import { LOCAL_NOTEBOOK_PREFIX, LOCAL_PAGE_PREFIX } from '../providers/data-provider.interface';

/**
 * Represents an open folder (notebook) from the local file system
 */
export interface LocalFolder {
  /** Unique ID for this folder: local-notebook-{uuid} */
  id: string;
  /** Display name (folder name from disk) */
  name: string;
  /** User-set display label override (persisted in IndexedDB) */
  labelOverride?: string;
  /** Web File System Access API handle (web only) */
  handle?: FileSystemDirectoryHandle;
  /** Native file path (Mac/iOS only) */
  nativePath?: string;
  /** Timestamp when folder was opened */
  openedAt: string;
  /** Source of this folder: 'local' (user-picked) or 'icloud' (auto-opened container) */
  source?: 'local' | 'icloud';
}

/**
 * Represents a file within a local folder
 */
export interface LocalFile {
  /** Unique ID for this file: local-{folder-id}-{sanitized-filename} */
  id: string;
  /** Display name (filename without extension) */
  name: string;
  /** File extension (e.g., '.md') */
  extension: string;
  /** Parent folder ID */
  folderId: string;
  /** Web File System Access API handle (web only) */
  handle?: FileSystemFileHandle;
  /** Native file path (Mac/iOS only) */
  nativePath?: string;
  /** Last modified timestamp */
  lastModified?: string;
}

/** IndexedDB store for persisting folder handles across sessions */
const FS_HANDLES_STORE = DB_STORES.FS_HANDLES;

@Injectable({ providedIn: 'root' })
export class FileSystemService {
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly indexedDB = inject(IndexedDBService);

  /** Currently open local folders */
  private readonly _openFolders = signal<LocalFolder[]>([]);
  readonly openFolders = this._openFolders.asReadonly();

  /** Whether the File System Access API is supported in this browser */
  readonly isFileSystemAccessSupported = computed(() => {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  });

  /** Whether native file system access is available (Mac/iOS) */
  readonly isNativeFileSystemSupported = computed(() => {
    return this.nativeBridge.isNativeApp();
  });

  /** Whether any file system access method is available */
  readonly isSupported = computed(() => {
    return this.isFileSystemAccessSupported() || this.isNativeFileSystemSupported();
  });

  /** Resolves when persisted folders have been restored from IndexedDB */
  readonly whenReady: Promise<void>;

  constructor() {
    this.whenReady = this.restorePersistedFolders().then(() => this.openICloudFolder());
  }

  /**
   * Open a folder picker dialog and return the selected folder.
   * Uses File System Access API on web, native bridge on Mac/iOS.
   */
  openFolderPicker(): Observable<LocalFolder | null> {
    if (this.nativeBridge.isNativeApp()) {
      return this.openNativeFolderPicker();
    }

    if (this.isFileSystemAccessSupported()) {
      return this.openWebFolderPicker();
    }

    return throwError(() => new Error('File system access is not supported'));
  }

  /**
   * List markdown files in a local folder
   */
  listMarkdownFiles(folderId: string): Observable<LocalFile[]> {
    const folder = this._openFolders().find((f) => f.id === folderId);
    if (!folder) {
      return throwError(() => new Error(`Folder not found: ${folderId}`));
    }

    if (folder.handle) {
      return this.listWebFiles(folder);
    }

    if (folder.nativePath) {
      return this.listNativeFiles(folder);
    }

    return throwError(() => new Error('No handle or path for folder'));
  }

  /**
   * Read the content of a markdown file
   */
  readFile(folderId: string, fileId: string): Observable<string> {
    const folder = this._openFolders().find((f) => f.id === folderId);
    if (!folder) {
      return throwError(() => new Error(`Folder not found: ${folderId}`));
    }

    if (folder.handle) {
      return this.readWebFile(folder, fileId);
    }

    if (folder.nativePath) {
      return this.readNativeFile(folder, fileId);
    }

    return throwError(() => new Error('No handle or path for folder'));
  }

  /**
   * Write content to a markdown file
   */
  writeFile(folderId: string, fileId: string, content: string): Observable<void> {
    const folder = this._openFolders().find((f) => f.id === folderId);
    if (!folder) {
      return throwError(() => new Error(`Folder not found: ${folderId}`));
    }

    if (folder.handle) {
      return this.writeWebFile(folder, fileId, content);
    }

    if (folder.nativePath) {
      return this.writeNativeFile(folder, fileId, content);
    }

    return throwError(() => new Error('No handle or path for folder'));
  }

  /**
   * Validate and sanitize a filename to prevent path traversal.
   * Rejects filenames with path separators or '..' sequences.
   */
  private validateFilename(filename: string): string {
    // Reject path separators and parent directory references
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new Error(`Invalid filename: ${filename}`);
    }
    // Remove null bytes
    const sanitized = filename.replace(/\0/g, '');
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      throw new Error(`Invalid filename: ${filename}`);
    }
    return sanitized;
  }

  /**
   * Create a new markdown file in a folder
   */
  createFile(folderId: string, filename: string, content: string = ''): Observable<LocalFile> {
    try {
      filename = this.validateFilename(filename);
    } catch (e) {
      return throwError(() => e);
    }

    const folder = this._openFolders().find((f) => f.id === folderId);
    if (!folder) {
      return throwError(() => new Error(`Folder not found: ${folderId}`));
    }

    if (folder.handle) {
      return this.createWebFile(folder, filename, content);
    }

    if (folder.nativePath) {
      return this.createNativeFile(folder, filename, content);
    }

    return throwError(() => new Error('No handle or path for folder'));
  }

  /**
   * Delete a file from a folder
   */
  deleteFile(folderId: string, fileId: string): Observable<void> {
    const folder = this._openFolders().find((f) => f.id === folderId);
    if (!folder) {
      return throwError(() => new Error(`Folder not found: ${folderId}`));
    }

    if (folder.handle) {
      return this.deleteWebFile(folder, fileId);
    }

    if (folder.nativePath) {
      return this.deleteNativeFile(folder, fileId);
    }

    return throwError(() => new Error('No handle or path for folder'));
  }

  /**
   * Rename a file in a folder.
   * File System Access API doesn't support rename directly,
   * so we read + create new + delete old.
   */
  renameFile(folderId: string, fileId: string, newName: string): Observable<LocalFile> {
    const mdName = newName.endsWith('.md') ? newName : `${newName}.md`;
    return this.readFile(folderId, fileId).pipe(
      switchMap((content) => this.createFile(folderId, mdName, content)),
      switchMap((newFile) =>
        this.deleteFile(folderId, fileId).pipe(
          catchError(() => {
            // Rollback: delete the newly created file if old file deletion fails
            return this.deleteFile(folderId, newFile.id).pipe(
              switchMap(() =>
                throwError(() => new Error('Failed to delete old file during rename')),
              ),
              catchError(() =>
                throwError(() => new Error('Failed to delete old file during rename')),
              ),
            );
          }),
          map(() => newFile),
        ),
      ),
    );
  }

  /**
   * Update the display label for a local folder.
   * Persists the override to IndexedDB.
   */
  updateFolderLabel(folderId: string, label: string): void {
    this._openFolders.update((folders) =>
      folders.map((f) => (f.id === folderId ? { ...f, labelOverride: label } : f)),
    );
    this.persistFolders();
  }

  /**
   * Get the display label for a folder (labelOverride or name).
   */
  getFolderDisplayName(folderId: string): string {
    const folder = this._openFolders().find((f) => f.id === folderId);
    return folder?.labelOverride || folder?.name || 'Untitled';
  }

  /**
   * Close a local folder (remove from open folders list)
   */
  closeFolder(folderId: string): void {
    this._openFolders.update((folders) => folders.filter((f) => f.id !== folderId));
    this.persistFolders();
  }

  /**
   * Auto-open iCloud child folders on native Mac/iOS apps.
   * Each subfolder inside the iCloud container becomes its own LocalFolder.
   */
  private async openICloudFolder(): Promise<void> {
    if (!this.nativeBridge.isNativeApp()) return;

    try {
      const result = await firstValueFrom(
        this.nativeBridge.getICloudContainerPath().pipe(timeout(5000)),
      );
      if (!result.path || result.folders.length === 0) return;

      const currentFolders = this._openFolders();
      const newFolders: LocalFolder[] = [];

      for (const sub of result.folders) {
        // Skip if already open by native path
        if (currentFolders.some((f) => f.nativePath === sub.path)) continue;

        newFolders.push({
          id: this.generateFolderId(sub.name),
          name: sub.name,
          nativePath: sub.path,
          openedAt: new Date().toISOString(),
          source: 'icloud',
        });
      }

      if (newFolders.length > 0) {
        this._openFolders.update((folders) => [...folders, ...newFolders]);
        this.persistFolders();
      }
    } catch {
      // Silently ignore — iCloud may not be available or timed out
    }
  }

  /**
   * Generate a deterministic ID for a folder based on its name.
   * Uses the folder name so URLs are human-readable and stable across reloads.
   */
  generateFolderId(name: string): string {
    return `${LOCAL_NOTEBOOK_PREFIX}${encodeURIComponent(name)}`;
  }

  /**
   * Generate a reversible ID for a file based on folder and filename.
   * Uses URI-safe encoding so the original filename can be recovered.
   */
  generateFileId(folderId: string, filename: string): string {
    const nameWithoutExt = filename.replace(/\.md$/i, '');
    const encoded = encodeURIComponent(nameWithoutExt);
    const folderKey = folderId.replace(LOCAL_NOTEBOOK_PREFIX, '');
    return `${LOCAL_PAGE_PREFIX}${folderKey}::${encoded}`;
  }

  /**
   * Get the filename from a file ID (reverse of generateFileId).
   * Returns the original filename with .md extension.
   */
  getFilenameFromId(fileId: string, folderId: string): string {
    const folderKey = folderId.replace(LOCAL_NOTEBOOK_PREFIX, '');
    const prefix = `${LOCAL_PAGE_PREFIX}${folderKey}::`;
    const encoded = fileId.startsWith(prefix) ? fileId.slice(prefix.length) : fileId;
    return decodeURIComponent(encoded) + '.md';
  }

  /**
   * Check if a page ID belongs to a specific folder ID.
   */
  pageBelongsToFolder(pageId: string, folderId: string): boolean {
    const folderKey = folderId.replace(LOCAL_NOTEBOOK_PREFIX, '');
    const prefix = `${LOCAL_PAGE_PREFIX}${folderKey}::`;
    return pageId.startsWith(prefix);
  }

  // ============ Web File System Access API ============

  private openWebFolderPicker(): Observable<LocalFolder | null> {
    return from(this.openWebFolderPickerAsync());
  }

  private async openWebFolderPickerAsync(): Promise<LocalFolder | null> {
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
      });

      const id = this.generateFolderId(handle.name);

      // Check if already open by ID or handle name
      const existing = this._openFolders().find(
        (f) => f.id === id || f.handle?.name === handle.name,
      );
      if (existing) {
        // Update handle if it was restored from IndexedDB without one
        if (!existing.handle) {
          existing.handle = handle;
          this.persistFolders();
        }
        return existing;
      }

      const folder: LocalFolder = {
        id,
        name: handle.name,
        handle,
        openedAt: new Date().toISOString(),
      };

      this._openFolders.update((folders) => [...folders, folder]);
      this.persistFolders();

      return folder;
    } catch (error: unknown) {
      // User cancelled the picker
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }
      throw error;
    }
  }

  private listWebFiles(folder: LocalFolder): Observable<LocalFile[]> {
    return from(this.listWebFilesAsync(folder));
  }

  private async listWebFilesAsync(folder: LocalFolder): Promise<LocalFile[]> {
    if (!folder.handle) return [];

    // Verify we still have permission
    const permission = await folder.handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      const requested = await folder.handle.requestPermission({ mode: 'readwrite' });
      if (requested !== 'granted') {
        throw new Error('Permission denied to read folder');
      }
    }

    const files: LocalFile[] = [];

    for await (const [name, handle] of folder.handle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!name.endsWith('.md')) continue;

      const file = await (handle as FileSystemFileHandle).getFile();
      files.push({
        id: this.generateFileId(folder.id, name),
        name: name.replace(/\.md$/, ''),
        extension: '.md',
        folderId: folder.id,
        handle: handle as FileSystemFileHandle,
        lastModified: new Date(file.lastModified).toISOString(),
      });
    }

    // Sort by last modified (newest first)
    files.sort((a, b) => {
      const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return bTime - aTime;
    });

    return files;
  }

  private readWebFile(folder: LocalFolder, fileId: string): Observable<string> {
    return from(this.readWebFileAsync(folder, fileId));
  }

  private async readWebFileAsync(folder: LocalFolder, fileId: string): Promise<string> {
    if (!folder.handle) throw new Error('No folder handle');

    const hasPermission = await this.verifyPermission(folder.handle);
    if (!hasPermission) throw new Error('Permission denied to read folder');

    const filename = this.getFilenameFromId(fileId, folder.id);

    try {
      const fileHandle = await folder.handle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      throw new Error(`File not found: ${filename}`);
    }
  }

  private writeWebFile(folder: LocalFolder, fileId: string, content: string): Observable<void> {
    return from(this.writeWebFileAsync(folder, fileId, content));
  }

  private async writeWebFileAsync(
    folder: LocalFolder,
    fileId: string,
    content: string,
  ): Promise<void> {
    if (!folder.handle) throw new Error('No folder handle');

    const hasPermission = await this.verifyPermission(folder.handle);
    if (!hasPermission) throw new Error('Permission denied to write folder');

    const filename = this.getFilenameFromId(fileId, folder.id);
    const fileHandle = await folder.handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  private createWebFile(
    folder: LocalFolder,
    filename: string,
    content: string,
  ): Observable<LocalFile> {
    return from(this.createWebFileAsync(folder, filename, content));
  }

  private async createWebFileAsync(
    folder: LocalFolder,
    filename: string,
    content: string,
  ): Promise<LocalFile> {
    if (!folder.handle) throw new Error('No folder handle');

    const mdFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    const fileHandle = await folder.handle.getFileHandle(mdFilename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    return {
      id: this.generateFileId(folder.id, mdFilename),
      name: mdFilename.replace(/\.md$/, ''),
      extension: '.md',
      folderId: folder.id,
      handle: fileHandle,
      lastModified: new Date().toISOString(),
    };
  }

  private deleteWebFile(folder: LocalFolder, fileId: string): Observable<void> {
    return from(this.deleteWebFileAsync(folder, fileId));
  }

  private async deleteWebFileAsync(folder: LocalFolder, fileId: string): Promise<void> {
    if (!folder.handle) throw new Error('No folder handle');

    const filename = this.getFilenameFromId(fileId, folder.id);
    await folder.handle.removeEntry(filename);
  }

  // ============ Native File System (Mac/iOS) ============

  private openNativeFolderPicker(): Observable<LocalFolder | null> {
    return new Observable<LocalFolder | null>((subscriber) => {
      // Send message to native to open folder picker
      this.nativeBridge.openFolderPicker();

      // Listen for the response
      const sub = this.nativeBridge.onFolderPickerResult().subscribe((result) => {
        if (!result.path) {
          subscriber.next(null);
          subscriber.complete();
          return;
        }

        const folderName = result.path.split('/').pop() || 'Untitled';

        // Check if already open by native path
        const existing = this._openFolders().find((f) => f.nativePath === result.path);
        if (existing) {
          subscriber.next(existing);
          subscriber.complete();
          return;
        }

        const folder: LocalFolder = {
          id: this.generateFolderId(folderName),
          name: folderName,
          nativePath: result.path,
          openedAt: new Date().toISOString(),
        };

        this._openFolders.update((folders) => [...folders, folder]);
        this.persistFolders();

        subscriber.next(folder);
        subscriber.complete();
      });

      return () => sub.unsubscribe();
    });
  }

  private listNativeFiles(folder: LocalFolder): Observable<LocalFile[]> {
    return new Observable<LocalFile[]>((subscriber) => {
      if (!folder.nativePath) {
        subscriber.error(new Error('No native path'));
        return;
      }

      this.nativeBridge.listFiles(folder.nativePath, '.md');

      const sub = this.nativeBridge.onFileListResult().subscribe((result) => {
        if (result.error) {
          subscriber.error(new Error(result.error));
          return;
        }

        const files: LocalFile[] = (result.files || []).map((f) => ({
          id: this.generateFileId(folder.id, f.name),
          name: f.name.replace(/\.md$/, ''),
          extension: '.md',
          folderId: folder.id,
          nativePath: f.path,
          lastModified: f.lastModified,
        }));

        // Sort by last modified (newest first)
        files.sort((a, b) => {
          const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
          const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
          return bTime - aTime;
        });

        subscriber.next(files);
        subscriber.complete();
      });

      return () => sub.unsubscribe();
    });
  }

  private readNativeFile(folder: LocalFolder, fileId: string): Observable<string> {
    return new Observable<string>((subscriber) => {
      const filename = this.getFilenameFromId(fileId, folder.id);
      const filePath = `${folder.nativePath}/${filename}`;

      this.nativeBridge.readFile(filePath);

      const sub = this.nativeBridge.onFileReadResult().subscribe((result) => {
        if (result.error) {
          subscriber.error(new Error(result.error));
        } else {
          subscriber.next(result.content || '');
          subscriber.complete();
        }
      });

      return () => sub.unsubscribe();
    });
  }

  private writeNativeFile(folder: LocalFolder, fileId: string, content: string): Observable<void> {
    return new Observable<void>((subscriber) => {
      const filename = this.getFilenameFromId(fileId, folder.id);
      const filePath = `${folder.nativePath}/${filename}`;

      this.nativeBridge.writeFile(filePath, content);

      const sub = this.nativeBridge.onFileWriteResult().subscribe((result) => {
        if (result.error) {
          subscriber.error(new Error(result.error));
        } else {
          subscriber.next();
          subscriber.complete();
        }
      });

      return () => sub.unsubscribe();
    });
  }

  private createNativeFile(
    folder: LocalFolder,
    filename: string,
    content: string,
  ): Observable<LocalFile> {
    const mdFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filePath = `${folder.nativePath}/${mdFilename}`;

    return new Observable<LocalFile>((subscriber) => {
      this.nativeBridge.writeFile(filePath, content);

      const sub = this.nativeBridge.onFileWriteResult().subscribe((result) => {
        if (result.error) {
          subscriber.error(new Error(result.error));
        } else {
          subscriber.next({
            id: this.generateFileId(folder.id, mdFilename),
            name: mdFilename.replace(/\.md$/, ''),
            extension: '.md',
            folderId: folder.id,
            nativePath: filePath,
            lastModified: new Date().toISOString(),
          });
          subscriber.complete();
        }
      });

      return () => sub.unsubscribe();
    });
  }

  private deleteNativeFile(folder: LocalFolder, fileId: string): Observable<void> {
    return new Observable<void>((subscriber) => {
      const filename = this.getFilenameFromId(fileId, folder.id);
      const filePath = `${folder.nativePath}/${filename}`;

      this.nativeBridge.deleteFile(filePath);

      const sub = this.nativeBridge.onFileDeleteResult().subscribe((result) => {
        if (result.error) {
          subscriber.error(new Error(result.error));
        } else {
          subscriber.next();
          subscriber.complete();
        }
      });

      return () => sub.unsubscribe();
    });
  }

  // ============ Persistence ============

  /**
   * Persist folder metadata to IndexedDB (handles are stored separately).
   * On web, FileSystemDirectoryHandle objects can be stored in IndexedDB.
   */
  private async persistFolders(): Promise<void> {
    const folders = this._openFolders();
    const serializable = folders.map((f) => ({
      id: f.id,
      name: f.name,
      labelOverride: f.labelOverride,
      nativePath: f.nativePath,
      openedAt: f.openedAt,
      source: f.source,
      // Store handle reference for web (IndexedDB can store handles)
      handle: f.handle || undefined,
    }));

    await this.indexedDB.put({ key: 'open-folders', value: serializable }, FS_HANDLES_STORE);
  }

  /**
   * Restore persisted folders on startup.
   * For web, the user may need to re-grant permission.
   */
  private async restorePersistedFolders(): Promise<void> {
    try {
      const stored = await this.indexedDB.get<{
        key: string;
        value: Array<{
          id: string;
          name: string;
          labelOverride?: string;
          nativePath?: string;
          openedAt: string;
          handle?: FileSystemDirectoryHandle;
          source?: 'local' | 'icloud';
        }>;
      }>('open-folders', FS_HANDLES_STORE);

      if (!stored?.value || stored.value.length === 0) return;

      const folders: LocalFolder[] = [];
      for (const item of stored.value) {
        const folder: LocalFolder = {
          id: item.id,
          name: item.name,
          labelOverride: item.labelOverride,
          nativePath: item.nativePath,
          openedAt: item.openedAt,
          handle: item.handle,
          source: item.source,
        };
        folders.push(folder);
      }

      this._openFolders.set(folders);
    } catch {
      // Silently ignore restoration errors
    }
  }

  /**
   * Verify permission for a web File System Access API handle.
   * Returns true if permission is still granted.
   */
  async verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') return true;

      const requested = await handle.requestPermission({ mode: 'readwrite' });
      return requested === 'granted';
    } catch {
      return false;
    }
  }
}
