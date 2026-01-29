import { Injectable, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, forkJoin, of } from 'rxjs';
import { switchMap, catchError, tap, map } from 'rxjs/operators';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { AuthService } from './auth.service';
import { ConnectivityService } from './connectivity.service';
import { OfflineQueueService } from './offline-queue.service';
import { PageService } from './page.service';
import { RealtimeWSService } from './realtime-ws.service';
import { VisibilityService } from './visibility.service';
import { YJSWSProvider } from './yjs-ws-provider';
import { getUserColor } from '../utils/user-colors';
import type { Page, SyncStatus } from '@maple/shared';

// Doc page prefix for virtual documentation pages
const DOC_PAGE_PREFIX = 'doc-';

// Generate UUID v4 for page IDs
function generatePageId(): string {
  return crypto.randomUUID();
}

/**
 * Check if a page ID is a doc page (virtual documentation page)
 */
function isDocPage(pageId: string): boolean {
  return pageId.startsWith(DOC_PAGE_PREFIX);
}

/**
 * Open document state
 */
interface OpenDocument {
  ydoc: Y.Doc;
  awareness: Awareness;
  persistence: IndexeddbPersistence;
  wsProvider: YJSWSProvider | null;
}

/**
 * Memo Document Service
 * Manages Y.Doc lifecycle for memo-type pages
 * Handles offline-first creation and sync
 */
@Injectable({ providedIn: 'root' })
export class MemoDocumentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly pageService = inject(PageService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly visibilityService = inject(VisibilityService);

  private openDocs = new Map<string, OpenDocument>();

  // Document sync status
  private readonly _syncStatuses = signal<Map<string, SyncStatus>>(new Map());

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupConnectivityListener();
      this.setupVisibilityListener();
    }
  }

  /**
   * Setup visibility listener to sync documents when tab becomes visible
   */
  private setupVisibilityListener(): void {
    this.visibilityService.becameVisible$
      .pipe(switchMap(() => this.syncOpenDocuments$()))
      .subscribe();
  }

  /**
   * Sync all open documents with server
   * Called when document becomes visible to catch up on missed updates
   */
  private syncOpenDocuments$(): Observable<void> {
    if (!this.connectivity.canSync() || this.openDocs.size === 0) {
      return of(undefined);
    }

    const syncs = Array.from(this.openDocs.entries()).map(([pageId, doc]) =>
      this.fetchInitialState$(pageId, doc.ydoc).pipe(
        catchError(() => of(undefined)), // Silently fail individual syncs
      ),
    );

    return forkJoin(syncs).pipe(map(() => undefined));
  }

  private setupConnectivityListener(): void {
    // When connectivity changes, connect/disconnect WebSocket providers
    effect(() => {
      const canSync = this.connectivity.canSync();

      for (const [pageId, doc] of this.openDocs) {
        if (canSync) {
          // Reconnect if needed
          if (!doc.wsProvider || !doc.wsProvider.connected()) {
            this.connectProviders(pageId, doc);
          }
        } else {
          // Disconnect when offline
          doc.wsProvider?.disconnect();
          doc.wsProvider = null;
        }
      }
    });
  }

  /**
   * Open a memo document
   * Loads from IndexedDB first (offline-first), then syncs with server
   * For doc pages, returns markdown content instead of Y.js sync
   */
  async openDocument(pageId: string): Promise<{
    ydoc: Y.Doc;
    awareness: Awareness;
    markdownContent?: string;
    initialContent?: any; // ProseMirror JSON for new memos (e.g., from templates)
  }> {
    // Handle doc pages differently - they're read-only virtual pages
    if (isDocPage(pageId)) {
      return this.openDocPage(pageId);
    }

    // Check if already open
    if (this.openDocs.has(pageId)) {
      const doc = this.openDocs.get(pageId)!;
      return { ydoc: doc.ydoc, awareness: doc.awareness };
    }

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Create awareness for cursor sync
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence FIRST (offline-first)
    const persistence = new IndexeddbPersistence(`ydoc-${pageId}`, ydoc);
    await persistence.whenSynced;

    // Store reference
    const doc: OpenDocument = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(pageId, doc);

    // Check if document is empty (no content from IndexedDB)
    const prosemirror = ydoc.getXmlFragment('prosemirror');
    const isDocEmpty = prosemirror.length === 0;

    // If document is empty and we're online, fetch initial content from server
    // This handles templates and other server-side page creation
    let initialContent: any;
    if (isDocEmpty && this.connectivity.canSync()) {
      try {
        await this.waitForAuth();
        const response = await firstValueFrom(
          this.http.get<{ state: string; initialContent?: any }>(`/api/memos/${pageId}/state`),
        );
        if (response.state) {
          const state = this.base64ToUint8Array(response.state);
          Y.applyUpdate(ydoc, state, 'remote');
        }
        if (response.initialContent) {
          initialContent = response.initialContent;
        }
      } catch (error) {
        console.error(`[MemoDocumentService] Failed to fetch initial state for ${pageId}:`, error);
      }
    }

    // Connect to server if online (don't block on this - can work offline)
    if (this.connectivity.canSync()) {
      // Start sync process after auth is ready (continues WebSocket connection)
      this.syncDocument(pageId, doc, ydoc, isDocEmpty);
    }

    return { ydoc, awareness, initialContent };
  }

  /**
   * Open a doc page (virtual documentation page)
   * Returns markdown content for rendering, no Y.js sync
   */
  private async openDocPage(pageId: string): Promise<{
    ydoc: Y.Doc;
    awareness: Awareness;
    markdownContent?: string;
  }> {
    // Check if already open
    if (this.openDocs.has(pageId)) {
      const doc = this.openDocs.get(pageId)!;
      // Return cached result - markdownContent might be stored separately
      return { ydoc: doc.ydoc, awareness: doc.awareness };
    }

    // Create Y.Doc (needed for editor compatibility, but won't sync)
    const ydoc = new Y.Doc();

    // Create awareness (needed for editor compatibility)
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // No IndexedDB persistence for doc pages - they're virtual
    // Create a minimal persistence that does nothing
    const persistence = {
      destroy: () => {},
      whenSynced: Promise.resolve(),
    } as unknown as IndexeddbPersistence;

    // Store reference (no WebSocket provider for doc pages)
    const doc: OpenDocument = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(pageId, doc);

    // Fetch markdown content from API
    let markdownContent: string | undefined;
    try {
      await this.waitForAuth();
      const response = await firstValueFrom(
        this.http.get<{ state: string | null; markdown?: string }>(`/api/memos/${pageId}/state`),
      );
      if (response.markdown) {
        markdownContent = response.markdown;
      }
    } catch (error) {
      console.error(`[MemoDocumentService] Failed to fetch doc page ${pageId}:`, error);
    }

    return { ydoc, awareness, markdownContent };
  }

  /**
   * Sync document with server
   * Tries both WebSocket and REST API in parallel for faster sync
   */
  private async syncDocument(
    pageId: string,
    doc: OpenDocument,
    ydoc: Y.Doc,
    isDocEmpty: boolean,
  ): Promise<void> {
    // Wait for auth to be ready first
    await this.waitForAuth();

    // Track if we've already synced (to avoid applying state twice)
    let hasSynced = false;

    // Strategy: Try both REST and WebSocket in parallel
    // Whichever syncs first wins

    // 1. If document is empty, immediately try REST API (faster initial load)
    if (isDocEmpty) {
      this.fetchInitialState(pageId, ydoc)
        .then(() => {
          if (!hasSynced) {
            hasSynced = true;
          }
        })
        .catch(() => {
          // REST sync failed, will rely on WebSocket
        });
    }

    // 2. Also connect WebSocket provider (for real-time updates)
    try {
      await this.connectProviders(pageId, doc);

      // If WS connected and synced, mark as synced
      if (doc.wsProvider?.synced()) {
        if (!hasSynced) {
          hasSynced = true;
        }
      }
    } catch {
      // If WS failed and doc is still empty, try REST as final fallback
      if (isDocEmpty && !hasSynced) {
        try {
          await this.fetchInitialState(pageId, ydoc);
          hasSynced = true;
        } catch {
          // All sync methods failed
        }
      }
    }
  }

  /**
   * Fetch document state from REST API (Observable)
   */
  private fetchInitialState$(pageId: string, ydoc: Y.Doc): Observable<void> {
    return this.http.get<{ state: string }>(`/api/memos/${pageId}/state`).pipe(
      tap((data) => {
        if (data.state) {
          const state = this.base64ToUint8Array(data.state);
          Y.applyUpdate(ydoc, state, 'remote');
        }
      }),
      map(() => undefined),
    );
  }

  /**
   * Fetch document state from REST API (Promise)
   */
  private fetchInitialState(pageId: string, ydoc: Y.Doc): Promise<void> {
    return firstValueFrom(this.fetchInitialState$(pageId, ydoc));
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Setup awareness with user info
   */
  private setupAwareness(awareness: Awareness): void {
    const user = this.authService.user();
    if (user) {
      awareness.setLocalStateField('user', {
        name: user.displayName?.split(' ')[0] || user.email || 'Anonymous',
        color: getUserColor(user._id),
      });
    }
  }

  /**
   * Connect WebSocket provider
   */
  private async connectProviders(pageId: string, doc: OpenDocument): Promise<void> {
    // Ensure WebSocket is connected
    if (!this.realtimeWS.isConnected()) {
      this.realtimeWS.connect();

      // Wait for WebSocket to connect (up to 10 seconds)
      const connected = await this.waitForConnection(10000);
      if (!connected) {
        return;
      }
    }

    // Create WebSocket provider
    doc.wsProvider = new YJSWSProvider(pageId, doc.ydoc, this.realtimeWS, doc.awareness, 'memo');

    // Track sync status via callback
    doc.wsProvider.onSynced = (synced: boolean) => {
      this.updateSyncStatus(pageId, synced ? 'synced' : 'syncing');
    };

    // Connect to memo room
    doc.wsProvider.connect();
  }

  /**
   * Wait for WebSocket connection with timeout
   * Assumes auth is already ready (waitForAuth was called first)
   */
  private waitForConnection(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      // Already connected
      if (this.realtimeWS.isConnected()) {
        resolve(true);
        return;
      }

      // Trigger connection (auth should be ready at this point)
      this.realtimeWS.connect();

      // Poll for connection
      this.pollForConnection(timeoutMs, resolve);
    });
  }

  /**
   * Poll for WebSocket connection
   */
  private pollForConnection(timeoutMs: number, resolve: (connected: boolean) => void): void {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (this.realtimeWS.isConnected()) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  }

  /**
   * Wait for auth to be ready
   * Returns immediately if already authenticated
   */
  private waitForAuth(): Promise<void> {
    return new Promise((resolve) => {
      // If already authenticated, resolve immediately
      if (this.authService.accessToken()) {
        resolve();
        return;
      }

      // Wait for auth to be ready
      firstValueFrom(this.authService.initReady$).then(() => {
        resolve();
      });
    });
  }

  /**
   * Close a memo document
   */
  closeDocument(pageId: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    // Cleanup provider
    doc.wsProvider?.destroy();

    // Cleanup persistence
    doc.persistence.destroy();

    // Cleanup Y.Doc
    doc.ydoc.destroy();

    this.openDocs.delete(pageId);
  }

  /**
   * Create a new memo (offline-capable)
   * Creates locally first, queues server sync
   */
  async createMemo(notebookId?: string): Promise<{
    page: Page;
    ydoc: Y.Doc;
    awareness: Awareness;
  }> {
    // Generate IDs locally
    const pageId = generatePageId();
    const now = new Date().toISOString();

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Initialize with empty prosemirror content (creates the fragment)
    ydoc.getXmlFragment('prosemirror');

    // Create awareness
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence immediately
    const persistence = new IndexeddbPersistence(`ydoc-${pageId}`, ydoc);
    await persistence.whenSynced;

    // Create page metadata locally
    const page: Page = {
      _id: pageId, // Temporary, will be replaced by server
      id: pageId,
      userId: this.authService.user()?._id || '',
      type: 'memo',
      title: 'Untitled Memo',
      content: { type: 'doc', content: [] },
      notebookId: notebookId,
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    // Save page metadata locally via page service
    // This will be synced by the offline queue
    this.pageService.addLocalPage(page);
    await this.pageService.persistToIndexedDB([page]);

    // Queue for server sync
    await this.offlineQueue.enqueue('create-note', pageId, pageId, {
      type: 'memo',
      title: page.title,
      notebookId: notebookId,
      id: pageId,
    });

    // Queue memo Y.Doc sync
    // Store as Array for IndexedDB serialization, convert back when processing
    const state = Y.encodeStateAsUpdate(ydoc);
    await this.offlineQueue.enqueue('sync-notebook', pageId, pageId, {
      state: Array.from(state),
      pageType: 'memo',
    });

    // Store open document
    const doc: OpenDocument = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(pageId, doc);

    // Update sync status
    this.updateSyncStatus(pageId, 'pending');

    // Connect if online - but wait for page to be created on server first
    if (this.connectivity.canSync()) {
      // Wait for the create-page action to complete before connecting WS
      const created = await this.offlineQueue.waitForAction(pageId, 'create-note', 10000);
      if (created) {
        await this.connectProviders(pageId, doc);
      }
    }

    return { page, ydoc, awareness };
  }

  /**
   * Get sync status for a document
   */
  getSyncStatus(pageId: string): SyncStatus {
    return this._syncStatuses().get(pageId) || 'synced';
  }

  /**
   * Update sync status
   */
  private updateSyncStatus(pageId: string, status: SyncStatus): void {
    this._syncStatuses.update((map) => {
      const newMap = new Map(map);
      newMap.set(pageId, status);
      return newMap;
    });
  }

  /**
   * Get peers count for a document
   * Note: Peer count tracking was removed with WebRTC. Returns 0 for now.
   */
  getPeersCount(pageId: string): number {
    // Peer count tracking would need to be implemented in the WebSocket provider
    // if needed. For now, return 0.
    return 0;
  }

  /**
   * Check if document is open
   */
  isDocumentOpen(pageId: string): boolean {
    return this.openDocs.has(pageId);
  }

  /**
   * Close all open documents
   */
  closeAll(): void {
    for (const pageId of this.openDocs.keys()) {
      this.closeDocument(pageId);
    }
  }
}
