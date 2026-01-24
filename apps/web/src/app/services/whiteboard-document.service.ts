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
import type { Page, SyncStatus, Camera, Layer, WhiteboardElement } from '@maple/shared';

// Generate UUID v4 for page IDs
function generatePageId(): string {
  return crypto.randomUUID();
}

/**
 * Open whiteboard document state
 */
interface OpenWhiteboard {
  ydoc: Y.Doc;
  awareness: Awareness;
  persistence: IndexeddbPersistence;
  wsProvider: YJSWSProvider | null;
  parentPageId?: string; // For embedded whiteboards
}

/**
 * Whiteboard Y.Doc structure helpers
 */
export interface WhiteboardYDoc {
  ydoc: Y.Doc;
  awareness: Awareness;
  metadata: Y.Map<unknown>;
  layers: Y.Array<Y.Map<unknown>>;
  elements: Y.Map<Y.Map<unknown>>;
}

/**
 * Whiteboard Document Service
 * Manages Y.Doc lifecycle for draw-type pages
 * Uses the same backend infrastructure as MemoDocumentService
 */
@Injectable({ providedIn: 'root' })
export class WhiteboardDocumentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly pageService = inject(PageService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly visibilityService = inject(VisibilityService);

  private openDocs = new Map<string, OpenWhiteboard>();

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
   */
  private syncOpenDocuments$(): Observable<void> {
    if (!this.connectivity.canSync() || this.openDocs.size === 0) {
      return of(undefined);
    }

    const syncs = Array.from(this.openDocs.entries()).map(([pageId, doc]) =>
      this.fetchInitialState$(pageId, doc.ydoc).pipe(catchError(() => of(undefined))),
    );

    return forkJoin(syncs).pipe(map(() => undefined));
  }

  private setupConnectivityListener(): void {
    effect(() => {
      const canSync = this.connectivity.canSync();

      for (const [pageId, doc] of this.openDocs) {
        if (canSync) {
          if (!doc.wsProvider || !doc.wsProvider.connected()) {
            this.connectProviders(pageId, doc);
          }
        } else {
          doc.wsProvider?.disconnect();
          doc.wsProvider = null;
        }
      }
    });
  }

  /**
   * Open a whiteboard document
   * Returns typed helpers for whiteboard-specific Y.Doc structures
   * @param pageId The whiteboard's document ID
   * @param parentPageId Optional parent memo's pageId for embedded whiteboards (used for authorization)
   */
  async openDocument(pageId: string, parentPageId?: string): Promise<WhiteboardYDoc> {
    // Check if already open
    if (this.openDocs.has(pageId)) {
      const doc = this.openDocs.get(pageId)!;
      return this.getWhiteboardHelpers(doc);
    }

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Create awareness for cursor sync
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence FIRST (offline-first)
    const persistence = new IndexeddbPersistence(`ydoc-whiteboard-${pageId}`, ydoc);
    await persistence.whenSynced;

    // Store reference
    const doc: OpenWhiteboard = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
      parentPageId,
    };
    this.openDocs.set(pageId, doc);

    // Check if document is empty (no layers from IndexedDB)
    const layers = ydoc.getArray<Y.Map<unknown>>('layers');
    const isDocEmpty = layers.length === 0;

    // Initialize default structure if empty
    if (isDocEmpty) {
      this.initializeEmptyWhiteboard(ydoc);
    }

    // Connect to server if online
    if (this.connectivity.canSync()) {
      this.syncDocument(pageId, doc, ydoc, isDocEmpty);
    }

    return this.getWhiteboardHelpers(doc);
  }

  /**
   * Initialize empty whiteboard with default structure
   */
  private initializeEmptyWhiteboard(ydoc: Y.Doc): void {
    const metadata = ydoc.getMap<unknown>('metadata');
    const layers = ydoc.getArray<Y.Map<unknown>>('layers');
    const elements = ydoc.getMap<Y.Map<unknown>>('elements');

    // Set default camera state
    if (!metadata.has('camera')) {
      metadata.set('camera', { x: 0, y: 0, zoom: 1 });
    }

    // Create default layer
    if (layers.length === 0) {
      const defaultLayer = new Y.Map<unknown>();
      const layerId = generatePageId();
      defaultLayer.set('id', layerId);
      defaultLayer.set('name', 'Layer 1');
      defaultLayer.set('visible', true);
      defaultLayer.set('locked', false);
      defaultLayer.set('opacity', 1);
      defaultLayer.set('elements', []);
      layers.push([defaultLayer]);

      metadata.set('activeLayerId', layerId);
    }
  }

  /**
   * Get typed whiteboard helpers
   */
  private getWhiteboardHelpers(doc: OpenWhiteboard): WhiteboardYDoc {
    return {
      ydoc: doc.ydoc,
      awareness: doc.awareness,
      metadata: doc.ydoc.getMap<unknown>('metadata'),
      layers: doc.ydoc.getArray<Y.Map<unknown>>('layers'),
      elements: doc.ydoc.getMap<Y.Map<unknown>>('elements'),
    };
  }

  /**
   * Add element to whiteboard
   */
  addElement(pageId: string, element: WhiteboardElement): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const elements = doc.ydoc.getMap<Y.Map<unknown>>('elements');
    const layers = doc.ydoc.getArray<Y.Map<unknown>>('layers');
    const metadata = doc.ydoc.getMap<unknown>('metadata');
    const activeLayerId = metadata.get('activeLayerId') as string;

    // Create Y.Map for element
    const yElement = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(element)) {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          const yArray = new Y.Array<unknown>();
          yArray.push(value);
          yElement.set(key, yArray);
        } else {
          const yMap = new Y.Map<unknown>();
          for (const [k, v] of Object.entries(value)) {
            yMap.set(k, v);
          }
          yElement.set(key, yMap);
        }
      } else {
        yElement.set(key, value);
      }
    }

    // Add to elements map
    elements.set(element.id, yElement);

    // Add to active layer's elements list
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      if (layer.get('id') === activeLayerId) {
        const layerElements = layer.get('elements') as string[];
        layer.set('elements', [...layerElements, element.id]);
        break;
      }
    }
  }

  /**
   * Update element
   */
  updateElement(pageId: string, elementId: string, updates: Partial<WhiteboardElement>): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const elements = doc.ydoc.getMap<Y.Map<unknown>>('elements');
    const yElement = elements.get(elementId);
    if (!yElement) return;

    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Update nested Y.Map
        let yMap = yElement.get(key) as Y.Map<unknown>;
        if (!yMap) {
          yMap = new Y.Map<unknown>();
          yElement.set(key, yMap);
        }
        for (const [k, v] of Object.entries(value)) {
          yMap.set(k, v);
        }
      } else {
        yElement.set(key, value);
      }
    }
  }

  /**
   * Delete element
   */
  deleteElement(pageId: string, elementId: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const elements = doc.ydoc.getMap<Y.Map<unknown>>('elements');
    const layers = doc.ydoc.getArray<Y.Map<unknown>>('layers');

    // Remove from elements map
    elements.delete(elementId);

    // Remove from all layers
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      const layerElements = layer.get('elements') as string[];
      const newElements = layerElements.filter((id) => id !== elementId);
      if (newElements.length !== layerElements.length) {
        layer.set('elements', newElements);
      }
    }
  }

  /**
   * Get camera state
   */
  getCamera(pageId: string): Camera | null {
    const doc = this.openDocs.get(pageId);
    if (!doc) return null;

    const metadata = doc.ydoc.getMap<unknown>('metadata');
    return metadata.get('camera') as Camera | null;
  }

  /**
   * Update camera state
   */
  updateCamera(pageId: string, camera: Partial<Camera>): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const metadata = doc.ydoc.getMap<unknown>('metadata');
    const currentCamera = (metadata.get('camera') as Camera) || { x: 0, y: 0, zoom: 1 };
    metadata.set('camera', { ...currentCamera, ...camera });
  }

  /**
   * Sync document with server
   */
  private async syncDocument(
    pageId: string,
    doc: OpenWhiteboard,
    ydoc: Y.Doc,
    isDocEmpty: boolean,
  ): Promise<void> {
    await this.waitForAuth();

    let hasSynced = false;

    // Try REST API for empty docs
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

    // Connect WebSocket provider
    try {
      await this.connectProviders(pageId, doc);

      if (doc.wsProvider?.synced()) {
        if (!hasSynced) {
          hasSynced = true;
        }
      }
    } catch {
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
    return this.http.get<{ state: string }>(`/api/whiteboards/${pageId}/state`).pipe(
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
   * Setup awareness with user info for whiteboard
   */
  private setupAwareness(awareness: Awareness): void {
    const user = this.authService.user();
    if (user) {
      awareness.setLocalStateField('user', {
        id: user._id,
        name: user.displayName?.split(' ')[0] || user.email || 'Anonymous',
        color: getUserColor(user._id),
      });
    }
  }

  /**
   * Update awareness cursor position
   */
  updateCursor(pageId: string, x: number, y: number): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    doc.awareness.setLocalStateField('cursor', { x, y });
  }

  /**
   * Update awareness selected elements
   */
  updateSelectedIds(pageId: string, ids: string[]): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    doc.awareness.setLocalStateField('selectedIds', ids);
  }

  /**
   * Update awareness active tool
   */
  updateActiveTool(
    pageId: string,
    tool: 'select' | 'pen' | 'line' | 'rectangle' | 'ellipse' | 'arrow' | 'text' | 'eraser',
  ): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    doc.awareness.setLocalStateField('activeTool', tool);
  }

  /**
   * Connect WebSocket provider
   */
  private async connectProviders(pageId: string, doc: OpenWhiteboard): Promise<void> {
    if (!this.realtimeWS.isConnected()) {
      this.realtimeWS.connect();

      const connected = await this.waitForConnection(10000);
      if (!connected) {
        return;
      }
    }

    doc.wsProvider = new YJSWSProvider(
      pageId,
      doc.ydoc,
      this.realtimeWS,
      doc.awareness,
      'whiteboard',
      doc.parentPageId,
    );

    doc.wsProvider.onSynced = (synced: boolean) => {
      this.updateSyncStatus(pageId, synced ? 'synced' : 'syncing');
    };

    doc.wsProvider.connect();
  }

  /**
   * Wait for WebSocket connection with timeout
   */
  private waitForConnection(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.realtimeWS.isConnected()) {
        resolve(true);
        return;
      }

      this.realtimeWS.connect();
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
   */
  private waitForAuth(): Promise<void> {
    return new Promise((resolve) => {
      if (this.authService.accessToken()) {
        resolve();
        return;
      }

      firstValueFrom(this.authService.initReady$).then(() => {
        resolve();
      });
    });
  }

  /**
   * Close a whiteboard document
   */
  closeDocument(pageId: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    doc.wsProvider?.destroy();
    doc.persistence.destroy();
    doc.ydoc.destroy();

    this.openDocs.delete(pageId);
  }

  /**
   * Create a new whiteboard (offline-capable)
   */
  async createWhiteboard(notebookId?: string): Promise<{
    page: Page;
    whiteboard: WhiteboardYDoc;
  }> {
    const pageId = generatePageId();
    const now = new Date().toISOString();

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Initialize whiteboard structure
    this.initializeEmptyWhiteboard(ydoc);

    // Create awareness
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence
    const persistence = new IndexeddbPersistence(`ydoc-whiteboard-${pageId}`, ydoc);
    await persistence.whenSynced;

    // Create page metadata
    const page: Page = {
      _id: pageId,
      id: pageId,
      userId: this.authService.user()?._id || '',
      type: 'whiteboard',
      title: 'Untitled Whiteboard',
      content: { type: 'doc', content: [] },
      notebookId: notebookId,
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    // Save page metadata locally
    this.pageService.addLocalPage(page);
    await this.pageService.persistToIndexedDB([page]);

    // Queue for server sync
    await this.offlineQueue.enqueue('create-note', pageId, pageId, {
      type: 'whiteboard',
      title: page.title,
      notebookId: notebookId,
      id: pageId,
    });

    // Queue Y.Doc sync
    const state = Y.encodeStateAsUpdate(ydoc);
    await this.offlineQueue.enqueue('sync-notebook', pageId, pageId, {
      state: Array.from(state),
      pageType: 'whiteboard',
    });

    // Store open document
    const doc: OpenWhiteboard = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(pageId, doc);

    // Update sync status
    this.updateSyncStatus(pageId, 'pending');

    // Connect if online
    if (this.connectivity.canSync()) {
      const created = await this.offlineQueue.waitForAction(pageId, 'create-note', 10000);
      if (created) {
        await this.connectProviders(pageId, doc);
      }
    }

    return { page, whiteboard: this.getWhiteboardHelpers(doc) };
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
