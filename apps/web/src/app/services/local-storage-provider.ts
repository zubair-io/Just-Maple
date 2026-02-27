import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FileSystemService, type LocalFolder } from './file-system.service';
import { IndexedDBService } from './indexed-db.service';
import { DB_STORES } from './db-stores';
import {
  parseFrontmatter,
  serializeFrontmatter,
  toFilename,
  parseFilename,
  toAssetFilename,
  computeAssetHash,
  buildIndex,
  mergeIndex,
  parseIndexCache,
} from '@maple/shared';
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
import type { FrontmatterMeta, IndexCache, IndexEntry } from '@maple/shared';

const SNAPSHOTS_STORE = DB_STORES.LOCAL_SNAPSHOTS;

/**
 * StorageProvider backed by the local file system via FileSystemService.
 *
 * Uses Phase 1 modules (frontmatter, filename, index-cache, etc.) for
 * parsing and serializing .maple.md files. Delegates actual I/O to
 * FileSystemService which handles both web (File System Access API)
 * and native (Mac/iOS bridge) backends.
 */
@Injectable({ providedIn: 'root' })
export class LocalStorageProvider implements StorageProvider {
  readonly type: StorageProviderType = 'local';

  private readonly fsService = inject(FileSystemService);
  private readonly indexedDB = inject(IndexedDBService);

  /** In-memory index caches per notebook */
  private indexCaches = new Map<string, IndexCache>();

  // ─── Notebook operations ──────────────────────────────────────────

  async listNotebooks(): Promise<LocalNotebook[]> {
    await this.fsService.whenReady;
    return this.fsService.openFolders().map((f) => this.folderToNotebook(f));
  }

  async createNotebook(label: string): Promise<LocalNotebook> {
    const folder = await firstValueFrom(this.fsService.openFolderPicker());
    if (!folder) {
      throw new Error('No folder selected');
    }
    if (label && label !== folder.name) {
      this.fsService.updateFolderLabel(folder.id, label);
    }
    return this.folderToNotebook(folder);
  }

  // ─── Page operations ──────────────────────────────────────────────

  async listPages(notebookId: string): Promise<PageMeta[]> {
    await this.fsService.whenReady;

    // Try loading from index cache first
    const cached = await this.loadIndexCache(notebookId);
    if (cached) {
      return cached.pages.map((entry) => this.indexEntryToPageMeta(entry, notebookId));
    }

    // Fall back to scanning all files
    return this.scanAndBuildIndex(notebookId);
  }

  async getPage(pageId: string): Promise<PageData> {
    const { folderId, filename } = this.resolvePageLocation(pageId);
    const content = await this.readFileByName(folderId, filename);

    const result = parseFrontmatter(content);
    if ('error' in result) {
      // File exists but has no/bad frontmatter — treat as plain markdown
      return {
        meta: {
          id: pageId,
          title: filename.replace(/\.maple\.md$/, ''),
          type: 'memo',
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
        },
        body: content,
      };
    }

    return {
      meta: this.frontmatterToPageMeta(result.meta),
      body: result.body,
    };
  }

  async savePage(pageId: string, data: PageData, options?: SaveOptions): Promise<void> {
    const { folderId } = this.resolvePageLocation(pageId);
    const filename = toFilename(data.meta.title, data.meta.id);

    const meta: FrontmatterMeta = {
      id: data.meta.id,
      type: data.meta.type,
      created: data.meta.created,
      modified: new Date().toISOString(),
      ...(data.meta.tags?.length ? { tags: data.meta.tags } : {}),
      ...(data.meta.isFavorite ? { isFavorite: true } : {}),
      ...(data.meta.isArchived ? { isArchived: true } : {}),
      ...(data.meta.todoMeta ? { todoMeta: data.meta.todoMeta } : {}),
    };

    const content = serializeFrontmatter(meta, data.body);
    await this.writeFileByName(folderId, filename, content);

    // Update index cache
    this.updateIndexEntry(folderId, {
      id: data.meta.id,
      title: data.meta.title,
      type: data.meta.type,
      filename,
      modified: meta.modified,
      isFavorite: data.meta.isFavorite,
      todoMeta: data.meta.todoMeta,
    });

    // Create snapshot on significant saves
    if (options?.significant) {
      await this.createSnapshot(pageId, content);
    }
  }

  async deletePage(pageId: string): Promise<void> {
    const { folderId, filename } = this.resolvePageLocation(pageId);

    // Find the file ID using FileSystemService conventions
    const folder = this.getFolder(folderId);
    if (!folder) throw new Error(`Notebook not found: ${folderId}`);

    const files = await firstValueFrom(this.fsService.listMarkdownFiles(folderId));
    const file = files.find(
      (f) => f.name === filename.replace(/\.maple\.md$/, '') || f.name === filename,
    );
    if (file) {
      await firstValueFrom(this.fsService.deleteFile(folderId, file.id));
    }

    // Remove from index cache
    this.removeIndexEntry(folderId, pageId);
  }

  // ─── Assets ───────────────────────────────────────────────────────

  async saveAsset(notebookId: string, file: AssetFile): Promise<string> {
    const hash = await computeAssetHash(file.content);
    const ext = file.name.includes('.') ? file.name.split('.').pop()! : 'bin';
    const assetFilename = toAssetFilename(hash, ext);
    const assetPath = `.maple/assets/${assetFilename}`;

    // Write asset file to the .maple/assets/ directory
    await this.ensureDirectory(notebookId, '.maple/assets');
    await this.writeFileByName(notebookId, assetPath, new TextDecoder().decode(file.content));

    return `./assets/${assetFilename}`;
  }

  getAssetUrl(notebookId: string, path: string): string {
    // For local files, return a relative path.
    // The editor will resolve this when rendering.
    return path;
  }

  // ─── History ──────────────────────────────────────────────────────

  async getHistory(pageId: string): Promise<PageSnapshot[]> {
    try {
      const stored = await this.indexedDB.get<{ key: string; snapshots: PageSnapshot[] }>(
        `snapshots-${pageId}`,
        SNAPSHOTS_STORE,
      );
      return (stored?.snapshots ?? []).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } catch {
      return [];
    }
  }

  async restoreSnapshot(pageId: string, snapshotId: string): Promise<void> {
    const snapshots = await this.getHistory(pageId);
    const snap = snapshots.find((s) => s.id === snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

    // Read snapshot content from the .maple/history/ directory
    const { folderId } = this.resolvePageLocation(pageId);
    const content = await this.readFileByName(folderId, `.maple/history/${snap.filename}`);

    // Parse and write back as the current page
    const result = parseFrontmatter(content);
    if ('error' in result) throw new Error(`Corrupt snapshot: ${snap.filename}`);

    const filename = toFilename(result.meta.id, result.meta.id);
    result.meta.modified = new Date().toISOString();
    const newContent = serializeFrontmatter(result.meta, result.body);
    await this.writeFileByName(folderId, filename, newContent);
  }

  // ─── Search ───────────────────────────────────────────────────────

  async search(query: string, notebookId?: string): Promise<LocalSearchResult[]> {
    const lowerQuery = query.toLowerCase();
    const results: LocalSearchResult[] = [];

    const notebookIds = notebookId ? [notebookId] : this.fsService.openFolders().map((f) => f.id);

    for (const nbId of notebookIds) {
      const pages = await this.listPages(nbId);
      for (const page of pages) {
        if (page.title.toLowerCase().includes(lowerQuery)) {
          results.push({
            pageId: page.id,
            title: page.title,
            snippet: page.title,
            score: 2,
          });
          continue;
        }

        // Check body content for matches
        try {
          const pageData = await this.getPage(page.id);
          if (pageData.body.toLowerCase().includes(lowerQuery)) {
            const idx = pageData.body.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, idx - 40);
            const end = Math.min(pageData.body.length, idx + query.length + 40);
            results.push({
              pageId: page.id,
              title: page.title,
              snippet: pageData.body.slice(start, end),
              score: 1,
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ─── Watch ────────────────────────────────────────────────────────

  watch(_notebookId: string, _callback: (changes: FileChange[]) => void): () => void {
    // TODO: Implement polling-based file watcher for external changes
    // File System Access API doesn't provide native watch events,
    // so this will need periodic polling in a future iteration.
    return () => {};
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private folderToNotebook(folder: LocalFolder): LocalNotebook {
    return {
      id: folder.id,
      label: folder.labelOverride || folder.name,
      createdAt: folder.openedAt,
    };
  }

  private getFolder(folderId: string): LocalFolder | undefined {
    return this.fsService.openFolders().find((f) => f.id === folderId);
  }

  /**
   * Resolve a page ID to its folder ID and expected filename.
   * Uses the index cache or falls back to scanning.
   */
  private resolvePageLocation(pageId: string): { folderId: string; filename: string } {
    // Check all index caches for this page ID
    for (const [folderId, cache] of this.indexCaches) {
      const entry = cache.pages.find((p) => p.id === pageId);
      if (entry) {
        return { folderId, filename: entry.filename };
      }
    }

    // Fall back: check all open folders by convention
    for (const folder of this.fsService.openFolders()) {
      if (this.fsService.pageBelongsToFolder(pageId, folder.id)) {
        const filename = this.fsService.getFilenameFromId(pageId, folder.id);
        return { folderId: folder.id, filename };
      }
    }

    // Last resort: use the first open folder
    const folders = this.fsService.openFolders();
    if (folders.length === 0) throw new Error('No notebooks open');
    return { folderId: folders[0]!.id, filename: `${pageId}.maple.md` };
  }

  private frontmatterToPageMeta(meta: FrontmatterMeta): PageMeta {
    return {
      id: meta.id,
      title: (meta['title'] as string) || '',
      type: meta.type,
      modified: meta.modified,
      created: meta.created,
      isFavorite: meta.isFavorite,
      isArchived: meta.isArchived,
      todoMeta: meta.todoMeta,
      tags: meta.tags,
    };
  }

  private indexEntryToPageMeta(entry: IndexEntry, _notebookId: string): PageMeta {
    return {
      id: entry.id,
      title: entry.title,
      type: entry.type,
      filename: entry.filename,
      modified: entry.modified,
      created: entry.modified, // Index doesn't store created separately
      isFavorite: entry.isFavorite,
      todoMeta: entry.todoMeta,
    };
  }

  /**
   * Scan all .maple.md files in a notebook folder and build the index.
   */
  private async scanAndBuildIndex(notebookId: string): Promise<PageMeta[]> {
    const files = await firstValueFrom(this.fsService.listMarkdownFiles(notebookId));
    const entries: IndexEntry[] = [];
    const metas: PageMeta[] = [];

    for (const file of files) {
      // Only process .maple.md files
      if (!file.name.endsWith('.maple')) continue; // file.name excludes .md extension

      try {
        const content = await firstValueFrom(this.fsService.readFile(notebookId, file.id));
        const result = parseFrontmatter(content);
        if ('error' in result) continue;

        const parsed = parseFilename(`${file.name}.md`);
        const entry: IndexEntry = {
          id: result.meta.id,
          title: (result.meta['title'] as string) || parsed?.title || file.name,
          type: result.meta.type,
          filename: `${file.name}.md`,
          modified: result.meta.modified,
          isFavorite: result.meta.isFavorite,
          todoMeta: result.meta.todoMeta,
        };
        entries.push(entry);
        metas.push(this.frontmatterToPageMeta(result.meta));
      } catch {
        // Skip unreadable files
      }
    }

    // Build and cache the index
    const index = buildIndex(entries);
    this.indexCaches.set(notebookId, index);
    await this.persistIndexCache(notebookId, index);

    return metas;
  }

  private updateIndexEntry(notebookId: string, entry: IndexEntry): void {
    const existing = this.indexCaches.get(notebookId);
    if (existing) {
      const updated = mergeIndex(existing, {
        added: [],
        updated: [entry],
        removed: [],
      });
      this.indexCaches.set(notebookId, updated);
      this.persistIndexCache(notebookId, updated);
    }
  }

  private removeIndexEntry(notebookId: string, pageId: string): void {
    const existing = this.indexCaches.get(notebookId);
    if (existing) {
      const updated = mergeIndex(existing, {
        added: [],
        updated: [],
        removed: [pageId],
      });
      this.indexCaches.set(notebookId, updated);
      this.persistIndexCache(notebookId, updated);
    }
  }

  private async loadIndexCache(notebookId: string): Promise<IndexCache | null> {
    // Check memory cache first
    const memCached = this.indexCaches.get(notebookId);
    if (memCached) return memCached;

    // Try reading .maple/index.json from the folder
    try {
      const content = await this.readFileByName(notebookId, '.maple/index.json');
      const cache = parseIndexCache(content);
      if (cache) {
        this.indexCaches.set(notebookId, cache);
        return cache;
      }
    } catch {
      // No index file — will rebuild
    }
    return null;
  }

  private async persistIndexCache(notebookId: string, cache: IndexCache): Promise<void> {
    try {
      await this.ensureDirectory(notebookId, '.maple');
      await this.writeFileByName(notebookId, '.maple/index.json', JSON.stringify(cache, null, 2));
    } catch {
      // Best-effort persistence
    }
  }

  private async createSnapshot(pageId: string, content: string): Promise<void> {
    const snap: PageSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pageId,
      timestamp: new Date().toISOString(),
      filename: `${pageId}-${Date.now()}.maple.md`,
    };

    // Write snapshot file to .maple/history/
    try {
      const { folderId } = this.resolvePageLocation(pageId);
      await this.ensureDirectory(folderId, '.maple/history');
      await this.writeFileByName(folderId, `.maple/history/${snap.filename}`, content);

      // Persist snapshot metadata to IndexedDB
      const existing = await this.getHistory(pageId);
      existing.push(snap);
      await this.indexedDB.put(
        { key: `snapshots-${pageId}`, snapshots: existing },
        SNAPSHOTS_STORE,
      );
    } catch {
      // Best-effort snapshot creation
    }
  }

  /**
   * Read a file by its filename (not the FileSystemService file ID).
   */
  private async readFileByName(folderId: string, filename: string): Promise<string> {
    const folder = this.getFolder(folderId);
    if (!folder) throw new Error(`Notebook not found: ${folderId}`);

    if (folder.handle) {
      return this.readWebFileByPath(folder.handle, filename);
    }

    if (folder.nativePath) {
      const fileId = this.fsService.generateFileId(folderId, filename);
      return firstValueFrom(this.fsService.readFile(folderId, fileId));
    }

    throw new Error('No handle or path for folder');
  }

  /**
   * Write a file by its filename (not the FileSystemService file ID).
   */
  private async writeFileByName(
    folderId: string,
    filename: string,
    content: string,
  ): Promise<void> {
    const folder = this.getFolder(folderId);
    if (!folder) throw new Error(`Notebook not found: ${folderId}`);

    if (folder.handle) {
      await this.writeWebFileByPath(folder.handle, filename, content);
      return;
    }

    if (folder.nativePath) {
      const fileId = this.fsService.generateFileId(folderId, filename);
      await firstValueFrom(this.fsService.writeFile(folderId, fileId, content));
      return;
    }

    throw new Error('No handle or path for folder');
  }

  /**
   * Read a file from a web FileSystemDirectoryHandle by path.
   * Supports nested paths like ".maple/index.json".
   */
  private async readWebFileByPath(root: FileSystemDirectoryHandle, path: string): Promise<string> {
    const parts = path.split('/');
    let dir = root;

    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!);
    }

    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!);
    const file = await fileHandle.getFile();
    return file.text();
  }

  /**
   * Write a file to a web FileSystemDirectoryHandle by path.
   * Creates intermediate directories as needed.
   */
  private async writeWebFileByPath(
    root: FileSystemDirectoryHandle,
    path: string,
    content: string,
  ): Promise<void> {
    const parts = path.split('/');
    let dir = root;

    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
    }

    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * Ensure a directory exists within a notebook folder.
   */
  private async ensureDirectory(notebookId: string, dirPath: string): Promise<void> {
    const folder = this.getFolder(notebookId);
    if (!folder) return;

    if (folder.handle) {
      const parts = dirPath.split('/');
      let dir = folder.handle;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
    }
    // For native, the bridge handles directory creation implicitly
  }
}
