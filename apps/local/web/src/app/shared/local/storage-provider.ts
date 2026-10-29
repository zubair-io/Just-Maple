/**
 * StorageProvider interface — abstract data layer for folders.
 *
 * Components inject a provider via StorageContextService instead
 * of depending on a specific storage backend.
 *
 * Implementations: LocalStorageProvider (File System Access API),
 * CloudStorageProvider (existing REST API wrapper).
 */

// ─── Supporting types ─────────────────────────────────────────────────────

export type StorageProviderType = 'icloud' | 'local' | 'cloud';

export interface LocalFolderMeta {
  id: string;
  label: string;
  createdAt: string;
  sortOrder?: string;
  defaultPageType?: string;
}

export interface PageMeta {
  id: string;
  title: string;
  type: string;
  filename?: string;
  modified: string;
  created: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  todoMeta?: {
    hasTodos: boolean;
    todoCount: number;
    completedCount: number;
    overdueCount: number;
  };
  tags?: string[];
}

export interface PageData {
  meta: PageMeta;
  body: string;
  sidecar?: Record<string, unknown>;
}

export interface PageSnapshot {
  id: string;
  pageId: string;
  timestamp: string;
  filename: string;
  label?: string;
}

export interface FileChange {
  type: 'added' | 'modified' | 'removed';
  filename: string;
  pageId?: string;
}

export interface LocalSearchResult {
  pageId: string;
  title: string;
  snippet: string;
  score: number;
}

export interface SaveOptions {
  /** Whether this is a significant save (Cmd+S, navigate away, etc.) that creates a history snapshot */
  significant: boolean;
}

/** Minimal file-like object for asset uploads (avoids DOM File dependency) */
export interface AssetFile {
  name: string;
  content: Uint8Array;
}

// ─── StorageProvider interface ─────────────────────────────────────────────

export interface StorageProvider {
  readonly type: StorageProviderType;

  // Folder operations
  listFolders(): Promise<LocalFolderMeta[]>;
  createFolder(label: string): Promise<LocalFolderMeta>;

  // Page operations
  listPages(folderId: string): Promise<PageMeta[]>;
  getPage(pageId: string): Promise<PageData>;
  savePage(pageId: string, data: PageData, options?: SaveOptions): Promise<void>;
  deletePage(pageId: string): Promise<void>;

  // Assets
  saveAsset(folderId: string, file: AssetFile): Promise<string>;
  getAssetUrl(folderId: string, path: string): string;

  // History
  getHistory(pageId: string): Promise<PageSnapshot[]>;
  restoreSnapshot(pageId: string, snapshotId: string): Promise<void>;

  // Search
  search(query: string, folderId?: string): Promise<LocalSearchResult[]>;

  // Watch for external changes (iCloud sync, other apps editing files)
  watch(folderId: string, callback: (changes: FileChange[]) => void): () => void;
}

// ─── MockStorageProvider ──────────────────────────────────────────────────

/**
 * In-memory mock for testing. Stores everything in Maps.
 */
export class MockStorageProvider implements StorageProvider {
  readonly type: StorageProviderType = 'local';

  private folderMap = new Map<string, LocalFolderMeta>();
  private pages = new Map<string, PageData>();
  private pageMetas = new Map<string, PageMeta[]>();
  private snapshots = new Map<string, PageSnapshot[]>();
  private assets = new Map<string, string>();

  async listFolders(): Promise<LocalFolderMeta[]> {
    return [...this.folderMap.values()];
  }

  async createFolder(label: string): Promise<LocalFolderMeta> {
    const nb: LocalFolderMeta = {
      id: `mock-nb-${Date.now()}`,
      label,
      createdAt: new Date().toISOString(),
    };
    this.folderMap.set(nb.id, nb);
    this.pageMetas.set(nb.id, []);
    return nb;
  }

  async listPages(folderId: string): Promise<PageMeta[]> {
    return this.pageMetas.get(folderId) ?? [];
  }

  async getPage(pageId: string): Promise<PageData> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    return page;
  }

  async savePage(pageId: string, data: PageData, options?: SaveOptions): Promise<void> {
    this.pages.set(pageId, data);

    // Update meta in the folder's page list
    for (const [nbId, metas] of this.pageMetas) {
      const idx = metas.findIndex((m) => m.id === pageId);
      if (idx >= 0) {
        metas[idx] = data.meta;
      } else if (nbId === data.meta.id) {
        metas.push(data.meta);
      }
    }

    if (options?.significant) {
      const snap: PageSnapshot = {
        id: `snap-${Date.now()}`,
        pageId,
        timestamp: new Date().toISOString(),
        filename: `${pageId}-${Date.now()}.maple.md`,
      };
      const existing = this.snapshots.get(pageId) ?? [];
      existing.push(snap);
      this.snapshots.set(pageId, existing);
    }
  }

  async deletePage(pageId: string): Promise<void> {
    this.pages.delete(pageId);
    for (const metas of this.pageMetas.values()) {
      const idx = metas.findIndex((m) => m.id === pageId);
      if (idx >= 0) metas.splice(idx, 1);
    }
  }

  async saveAsset(_folderId: string, file: AssetFile): Promise<string> {
    const path = `./assets/${file.name}`;
    this.assets.set(path, file.name);
    return path;
  }

  getAssetUrl(_folderId: string, path: string): string {
    return path;
  }

  async getHistory(pageId: string): Promise<PageSnapshot[]> {
    return (this.snapshots.get(pageId) ?? []).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  async restoreSnapshot(pageId: string, snapshotId: string): Promise<void> {
    const snaps = this.snapshots.get(pageId) ?? [];
    const snap = snaps.find((s) => s.id === snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);
    // In a real implementation, this would copy snapshot content to the live file
  }

  async search(query: string, _folderId?: string): Promise<LocalSearchResult[]> {
    const results: LocalSearchResult[] = [];
    for (const [pageId, data] of this.pages) {
      if (
        data.meta.title.toLowerCase().includes(query.toLowerCase()) ||
        data.body.toLowerCase().includes(query.toLowerCase())
      ) {
        results.push({
          pageId,
          title: data.meta.title,
          snippet: data.body.slice(0, 100),
          score: 1,
        });
      }
    }
    return results;
  }

  watch(_folderId: string, _callback: (changes: FileChange[]) => void): () => void {
    // No-op for mock
    return () => {};
  }

  // ─── Test helpers ───────────────────────────────────────────────────

  /** Seed a folder with pages for testing */
  seed(folderId: string, folder: LocalFolderMeta, pages: PageData[]): void {
    this.folderMap.set(folderId, folder);
    this.pageMetas.set(
      folderId,
      pages.map((p) => p.meta),
    );
    for (const page of pages) {
      this.pages.set(page.meta.id, page);
    }
  }

  /** Clear all data */
  clear(): void {
    this.folderMap.clear();
    this.pages.clear();
    this.pageMetas.clear();
    this.snapshots.clear();
    this.assets.clear();
  }
}
