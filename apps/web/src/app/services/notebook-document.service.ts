import { Injectable, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, forkJoin, of } from 'rxjs';
import { switchMap, catchError, tap, map } from 'rxjs/operators';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { customAlphabet } from 'nanoid';
import { AuthService } from './auth.service';
import { ConnectivityService } from './connectivity.service';
import { OfflineQueueService } from './offline-queue.service';
import { NoteService } from './note.service';
import { RealtimeWSService } from './realtime-ws.service';
import { VisibilityService } from './visibility.service';
import { YJSWSProvider } from './yjs-ws-provider';
import type { Note, SyncStatus } from '@maple/shared';

// Generate document IDs (base58, URL-safe)
const nanoidBase58 = customAlphabet(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  32,
);

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
 * Notebook Document Service
 * Manages Y.Doc lifecycle for notebook-type notes
 * Handles offline-first creation and sync
 */
@Injectable({ providedIn: 'root' })
export class NotebookDocumentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly noteService = inject(NoteService);
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

    const syncs = Array.from(this.openDocs.entries()).map(([noteId, doc]) =>
      this.fetchInitialState$(noteId, doc.ydoc).pipe(
        catchError(() => of(undefined)), // Silently fail individual syncs
      ),
    );

    return forkJoin(syncs).pipe(map(() => undefined));
  }

  private setupConnectivityListener(): void {
    // When connectivity changes, connect/disconnect WebSocket providers
    effect(() => {
      const canSync = this.connectivity.canSync();

      for (const [noteId, doc] of this.openDocs) {
        if (canSync) {
          // Reconnect if needed
          if (!doc.wsProvider || !doc.wsProvider.connected()) {
            this.connectProviders(noteId, doc);
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
   * Open a notebook document
   * Loads from IndexedDB first (offline-first), then syncs with server
   */
  async openDocument(noteId: string): Promise<{
    ydoc: Y.Doc;
    awareness: Awareness;
  }> {
    // Check if already open
    if (this.openDocs.has(noteId)) {
      const doc = this.openDocs.get(noteId)!;
      return { ydoc: doc.ydoc, awareness: doc.awareness };
    }

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Create awareness for cursor sync
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence FIRST (offline-first)
    const persistence = new IndexeddbPersistence(`ydoc-${noteId}`, ydoc);
    await persistence.whenSynced;

    // Store reference
    const doc: OpenDocument = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(noteId, doc);

    // Check if document is empty (no content from IndexedDB)
    const prosemirror = ydoc.getXmlFragment('prosemirror');
    const isDocEmpty = prosemirror.length === 0;

    // Connect to server if online (don't block on this - can work offline)
    if (this.connectivity.canSync()) {
      // Start sync process after auth is ready
      this.syncDocument(noteId, doc, ydoc, isDocEmpty);
    }

    return { ydoc, awareness };
  }

  /**
   * Sync document with server
   * Tries both WebSocket and REST API in parallel for faster sync
   */
  private async syncDocument(
    noteId: string,
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
      this.fetchInitialState(noteId, ydoc)
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
      await this.connectProviders(noteId, doc);

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
          await this.fetchInitialState(noteId, ydoc);
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
  private fetchInitialState$(noteId: string, ydoc: Y.Doc): Observable<void> {
    return this.http.get<{ state: string }>(`/api/notebook/${noteId}/state`).pipe(
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
  private fetchInitialState(noteId: string, ydoc: Y.Doc): Promise<void> {
    return firstValueFrom(this.fetchInitialState$(noteId, ydoc));
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
        color: this.generateUserColor(user._id),
      });
    }
  }

  /**
   * Connect WebSocket provider
   */
  private async connectProviders(noteId: string, doc: OpenDocument): Promise<void> {
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
    doc.wsProvider = new YJSWSProvider(noteId, doc.ydoc, this.realtimeWS, doc.awareness);

    // Track sync status via callback
    doc.wsProvider.onSynced = (synced: boolean) => {
      this.updateSyncStatus(noteId, synced ? 'synced' : 'syncing');
    };

    // Connect to notebook room
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
   * Close a notebook document
   */
  closeDocument(noteId: string): void {
    const doc = this.openDocs.get(noteId);
    if (!doc) return;

    // Cleanup provider
    doc.wsProvider?.destroy();

    // Cleanup persistence
    doc.persistence.destroy();

    // Cleanup Y.Doc
    doc.ydoc.destroy();

    this.openDocs.delete(noteId);
  }

  /**
   * Create a new notebook (offline-capable)
   * Creates locally first, queues server sync
   */
  async createNotebook(tagId?: string): Promise<{
    note: Note;
    ydoc: Y.Doc;
    awareness: Awareness;
  }> {
    // Generate IDs locally
    const documentId = nanoidBase58();
    const now = new Date().toISOString();

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Initialize with empty prosemirror content (creates the fragment)
    ydoc.getXmlFragment('prosemirror');

    // Create awareness
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence immediately
    const persistence = new IndexeddbPersistence(`ydoc-${documentId}`, ydoc);
    await persistence.whenSynced;

    // Create note metadata locally
    const note: Note = {
      _id: documentId, // Temporary, will be replaced by server
      userId: this.authService.user()?._id || '',
      type: 'notebook',
      title: 'Untitled Notebook',
      content: { type: 'doc', content: [] },
      documentId,
      tagId,
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    // Save note metadata locally via note service
    // This will be synced by the offline queue
    this.noteService.addLocalNote(note);
    await this.noteService.persistToIndexedDB([note]);

    // Queue for server sync
    await this.offlineQueue.enqueue('create-note', documentId, documentId, {
      type: 'notebook',
      title: note.title,
      tagId,
      documentId,
    });

    // Queue notebook Y.Doc sync
    // Store as Array for IndexedDB serialization, convert back when processing
    const state = Y.encodeStateAsUpdate(ydoc);
    await this.offlineQueue.enqueue('sync-notebook', documentId, documentId, {
      state: Array.from(state),
    });

    // Store open document
    const doc: OpenDocument = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(documentId, doc);

    // Update sync status
    this.updateSyncStatus(documentId, 'pending');

    // Connect if online - but wait for note to be created on server first
    if (this.connectivity.canSync()) {
      // Wait for the create-note action to complete before connecting WS
      const created = await this.offlineQueue.waitForAction(documentId, 'create-note', 10000);
      if (created) {
        await this.connectProviders(documentId, doc);
      }
    }

    return { note, ydoc, awareness };
  }

  /**
   * Get sync status for a document
   */
  getSyncStatus(noteId: string): SyncStatus {
    return this._syncStatuses().get(noteId) || 'synced';
  }

  /**
   * Update sync status
   */
  private updateSyncStatus(noteId: string, status: SyncStatus): void {
    this._syncStatuses.update((map) => {
      const newMap = new Map(map);
      newMap.set(noteId, status);
      return newMap;
    });
  }

  /**
   * Get peers count for a document
   * Note: Peer count tracking was removed with WebRTC. Returns 0 for now.
   */
  getPeersCount(noteId: string): number {
    // Peer count tracking would need to be implemented in the WebSocket provider
    // if needed. For now, return 0.
    return 0;
  }

  /**
   * Check if document is open
   */
  isDocumentOpen(noteId: string): boolean {
    return this.openDocs.has(noteId);
  }

  /**
   * Generate consistent user color based on ID
   */
  private generateUserColor(userId: string): string {
    const colors = [
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#96CEB4',
      '#FFEAA7',
      '#DDA0DD',
      '#98D8C8',
      '#F7DC6F',
      '#BB8FCE',
      '#85C1E9',
    ];
    const hash = userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  /**
   * Close all open documents
   */
  closeAll(): void {
    for (const noteId of this.openDocs.keys()) {
      this.closeDocument(noteId);
    }
  }
}
