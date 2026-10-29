import { Injectable, inject, PLATFORM_ID, signal, effect, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, tap, map, ReplaySubject } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { createStore, filterNil } from '@ngneat/elf';
import {
  withEntities,
  withActiveId,
  selectAllEntities,
  selectActiveEntity,
  selectEntity,
  setEntities,
  updateEntities,
  deleteEntities,
  upsertEntities,
  setActiveId,
  resetActiveId,
  getEntity,
  getAllEntities,
  getEntitiesCount,
  getActiveEntity,
} from '@ngneat/elf-entities';
import { IndexedDBService } from './indexed-db.service';
import { VisibilityService } from './visibility.service';
import { DB_STORES } from './db-stores';
import {
  isLocalFolder,
  type ProviderCapabilities,
  LOCAL_FS_CAPABILITIES,
} from '../providers/data-provider.interface';
import { FileSystemFolderProvider } from '../providers/filesystem-data.provider';
import { FileSystemService } from './file-system.service';
import type { Folder, CreateFolderInput, UpdateFolderInput } from '../shared/schemas/folder';

const STORE_NAME = DB_STORES.FOLDER;

@Injectable({ providedIn: 'root' })
export class FolderService {
  private readonly indexedDB = inject(IndexedDBService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly visibilityService = inject(VisibilityService);
  private readonly fsProvider = inject(FileSystemFolderProvider);
  private readonly fsService = inject(FileSystemService);
  private readonly destroyRef = inject(DestroyRef);

  // ELF Store
  private readonly store = createStore(
    { name: STORE_NAME },
    withEntities<Folder, '_id'>({ idKey: '_id' }),
    withActiveId(),
  );

  // Observable selectors
  readonly folders$ = this.store.pipe(selectAllEntities());
  readonly activeFolder$ = this.store.pipe(selectActiveEntity()).pipe(filterNil());

  // Signal wrappers for Angular reactivity
  private readonly _foldersSignal = toSignal(this.folders$, { initialValue: [] as Folder[] });

  // UI state signals
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _opened = signal<string[]>([]); // Track opened folders

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly opened = this._opened.asReadonly();

  // Initialization state: resolves after IndexedDB hydration completes
  private readonly _cacheReady$ = new ReplaySubject<void>(1);
  readonly cacheReady$ = this._cacheReady$.asObservable();

  /** Whether local file system folders are supported on this platform */
  readonly isLocalFSSupported = this.fsService.isSupported;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.hydrateFromIndexedDB();

      // Refresh local folders when document becomes visible (user returns to tab)
      this.visibilityService.becameVisible$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.syncLocalFolders());

      // Sync local folders into the store when they change
      effect(() => {
        const folders = this.fsService.openFolders();
        this.syncLocalFolders();
      });
    } else {
      this._cacheReady$.next();
      this._cacheReady$.complete();
    }
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    try {
      const cached = await this.indexedDB.getAll<Folder>(STORE_NAME);
      if (cached.length > 0 && this.store.query(getEntitiesCount()) === 0) {
        const normalized = cached.map((n) => ({
          ...n,
          sharing: n.sharing ?? { sharedWith: [], isPublic: false },
        }));
        this.store.update(setEntities(normalized));
      }
    } finally {
      this._cacheReady$.next();
      this._cacheReady$.complete();
    }
  }

  /**
   * Sync local file system folders into the Elf store.
   * Called reactively when open folders change.
   */
  private syncLocalFolders(): void {
    this.fsProvider.loadFolders().subscribe((localFolders) => {
      // Remove stale local folders from store
      const current = this.store.query(getAllEntities());
      const staleLocalIds = current
        .filter((n) => isLocalFolder(n._id))
        .filter((n) => !localFolders.find((ln) => ln._id === n._id))
        .map((n) => n._id);

      if (staleLocalIds.length > 0) {
        this.store.update(deleteEntities(staleLocalIds));
      }

      // Upsert current local folders
      if (localFolders.length > 0) {
        this.store.update(upsertEntities(localFolders));
      }
    });
  }

  /**
   * Get all folders as a reactive signal
   */
  folders(): Folder[] {
    return this._foldersSignal();
  }

  /**
   * Get capabilities for a specific folder.
   * All folders are local, so always return local FS capabilities.
   */
  getCapabilities(_folderId: string): ProviderCapabilities {
    return LOCAL_FS_CAPABILITIES;
  }

  /**
   * Check if a folder is backed by the local file system.
   * In local-only mode, this always returns true.
   */
  isLocal(_folderId: string): boolean {
    return true;
  }

  /**
   * Check if a local folder is from the iCloud container
   */
  isICloud(folderId: string): boolean {
    const folder = this.fsService.openFolders().find((f) => f.id === folderId);
    return folder?.source === 'icloud';
  }

  /**
   * Open a local folder via file picker.
   */
  openLocalFolder(): Observable<Folder | null> {
    return this.fsService.openFolderPicker().pipe(
      tap((folder) => {
        if (folder) {
          // Sync will happen via the effect, but also upsert immediately for responsiveness
          this.syncLocalFolders();
        }
      }),
      map((folder) => {
        if (!folder) return null;
        return this.store.query(getEntity(folder.id)) || null;
      }),
    );
  }

  /**
   * Close/remove a local folder.
   * Does NOT delete the folder from disk.
   */
  closeLocalFolder(folderId: string): void {
    this.fsService.closeFolder(folderId);
    this.store.update(deleteEntities(folderId));
  }

  /**
   * Create a new folder by opening a folder picker.
   * In local-only mode, creating a folder means selecting a local folder.
   */
  createFolder(_data?: CreateFolderInput): Observable<Folder | null> {
    return this.openLocalFolder();
  }

  /**
   * Create a new subfolder inside the iCloud container.
   */
  createICloudFolder(name: string): Observable<Folder | null> {
    return this.fsService.createICloudFolder(name).pipe(
      tap(() => this.syncLocalFolders()),
      map((localFolder) => {
        if (!localFolder) return null;
        return this.store.query(getEntity(localFolder.id)) || null;
      }),
    );
  }

  /**
   * Update a folder via the file system provider.
   */
  updateFolder(id: string, data: UpdateFolderInput): Observable<Folder> {
    return this.fsProvider.updateFolder(id, data).pipe(
      tap((folder) => {
        this.store.update(updateEntities(id, () => folder));
      }),
    );
  }

  /**
   * Delete a folder (closes the folder, does NOT delete from disk).
   */
  deleteFolder(id: string): Observable<void> {
    this.store.update(deleteEntities(id));
    return this.fsProvider.deleteFolder(id);
  }

  /**
   * Get folder by ID synchronously
   */
  getFolderById(id: string): Folder | undefined {
    return this.store.query(getEntity(id));
  }

  /**
   * Select a folder as active
   */
  setActiveFolder(id: string | null): void {
    if (id) {
      this.store.update(setActiveId(id));
    } else {
      this.store.update(resetActiveId());
    }
  }

  /**
   * Get active folder synchronously
   */
  getActiveFolder(): Folder | undefined {
    return this.store.query(getActiveEntity());
  }

  /**
   * Select a single folder as observable
   */
  select(id: string): Observable<Folder | undefined> {
    return this.store.pipe(selectEntity(id));
  }

  /**
   * Open a folder in the sidebar
   */
  openFolder(id: string): void {
    this._opened.update((ids) => {
      if (ids.includes(id)) return ids;
      return [...ids, id];
    });
  }

  /**
   * Close a folder in the sidebar
   */
  closeFolder(id: string): void {
    this._opened.update((ids) => ids.filter((i) => i !== id));
  }

  /**
   * Toggle folder open/closed
   */
  toggleFolder(id: string): void {
    if (this._opened().includes(id)) {
      this.closeFolder(id);
    } else {
      this.openFolder(id);
    }
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    this.store.update(setEntities([]));
    this.store.update(resetActiveId());

    if (isPlatformBrowser(this.platformId)) {
      await this.indexedDB.clear(STORE_NAME);
    }
  }

  private async persistToIndexedDB(folders: Folder[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || folders.length === 0) return;
    await this.indexedDB.putMany(folders, STORE_NAME);
  }
}
