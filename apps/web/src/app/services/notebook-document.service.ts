import { Injectable, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { customAlphabet } from 'nanoid';
import { AuthService } from './auth.service';
import { ConnectivityService } from './connectivity.service';
import { OfflineQueueService } from './offline-queue.service';
import { NoteService } from './note.service';
import { YJSSSEProvider } from './yjs-sse-provider';
import { YJSWebRTCProvider } from './yjs-webrtc-provider';
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
  sseProvider: YJSSSEProvider | null;
  webrtcProvider: YJSWebRTCProvider | null;
}

/**
 * Notebook Document Service
 * Manages Y.Doc lifecycle for notebook-type notes
 * Handles offline-first creation and sync
 */
@Injectable({ providedIn: 'root' })
export class NotebookDocumentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly noteService = inject(NoteService);

  private openDocs = new Map<string, OpenDocument>();

  // Document sync status
  private readonly _syncStatuses = signal<Map<string, SyncStatus>>(new Map());

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupConnectivityListener();
    }
  }

  private setupConnectivityListener(): void {
    // When connectivity changes, connect/disconnect SSE providers
    effect(() => {
      const canSync = this.connectivity.canSync();

      for (const [noteId, doc] of this.openDocs) {
        if (canSync) {
          // Reconnect if needed
          if (!doc.sseProvider || !doc.sseProvider.connected()) {
            this.connectProviders(noteId, doc);
          }
        } else {
          // Disconnect when offline
          doc.sseProvider?.disconnect();
          doc.webrtcProvider?.destroy();
          doc.sseProvider = null;
          doc.webrtcProvider = null;
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
    console.log(`[NotebookDoc] Opening document: ${noteId}`);

    // Check if already open
    if (this.openDocs.has(noteId)) {
      console.log(`[NotebookDoc] Document already open: ${noteId}`);
      const doc = this.openDocs.get(noteId)!;
      return { ydoc: doc.ydoc, awareness: doc.awareness };
    }

    // Create Y.Doc
    const ydoc = new Y.Doc();
    console.log(`[NotebookDoc] Created Y.Doc for: ${noteId}`);

    // Create awareness for cursor sync
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);
    console.log(`[NotebookDoc] Created Awareness for: ${noteId}`);

    // Setup local persistence FIRST (offline-first)
    console.log(`[NotebookDoc] Setting up IndexedDB persistence for: ${noteId}`);
    const persistence = new IndexeddbPersistence(`ydoc-${noteId}`, ydoc);
    await persistence.whenSynced;
    console.log(`[NotebookDoc] Loaded from IndexedDB: ${noteId}`);

    // Store reference
    const doc: OpenDocument = {
      ydoc,
      awareness,
      persistence,
      sseProvider: null,
      webrtcProvider: null,
    };
    this.openDocs.set(noteId, doc);

    // Check if document is empty (no content from IndexedDB)
    const prosemirror = ydoc.getXmlFragment('prosemirror');
    const isDocEmpty = prosemirror.length === 0;

    // Connect to server if online (don't block on this - can work offline)
    if (this.connectivity.canSync()) {
      // Connect providers in background - don't fail document loading if SSE fails
      this.connectProviders(noteId, doc).catch(async (err) => {
        console.warn(`[NotebookDoc] Failed to connect providers (will work offline):`, err);

        // If document is empty and SSE failed, try to fetch initial state via REST API
        if (isDocEmpty) {
          await this.fetchInitialState(noteId, ydoc);
        }
      });

      // Also fetch initial state if doc is empty (in case SSE takes too long)
      if (isDocEmpty) {
        // Give SSE a short time to connect, then fallback to REST
        setTimeout(async () => {
          const docState = this.openDocs.get(noteId);
          if (docState && !docState.sseProvider?.synced()) {
            await this.fetchInitialState(noteId, ydoc);
          }
        }, 2000);
      }
    } else if (isDocEmpty) {
      // Offline and empty - nothing we can do, will sync when online
      console.warn(`[NotebookDoc] Document is empty and offline, will sync when connected`);
    }

    return { ydoc, awareness };
  }

  /**
   * Fetch initial document state from REST API (fallback when SSE fails)
   */
  private async fetchInitialState(noteId: string, ydoc: Y.Doc): Promise<void> {
    const token = this.authService.accessToken();
    if (!token) return;

    try {
      console.log(`[NotebookDoc] Fetching initial state via REST API for: ${noteId}`);

      const response = await fetch(`/api/notebook/${noteId}/state`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.state) {
        const state = this.base64ToUint8Array(data.state);
        Y.applyUpdate(ydoc, state, 'remote');
        console.log(`[NotebookDoc] Applied initial state from REST API for: ${noteId}`);
      }
    } catch (err) {
      console.error(`[NotebookDoc] Failed to fetch initial state:`, err);
    }
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
        name: user.displayName || user.email || 'Anonymous',
        color: this.generateUserColor(user._id),
      });
    }
  }

  /**
   * Connect SSE and WebRTC providers
   */
  private async connectProviders(noteId: string, doc: OpenDocument): Promise<void> {
    const token = this.authService.accessToken();
    if (!token) return;

    // Create SSE provider
    doc.sseProvider = new YJSSSEProvider(noteId, doc.ydoc, token);

    // Create WebRTC provider (with awareness for cursor sync)
    doc.webrtcProvider = new YJSWebRTCProvider(noteId, doc.ydoc, doc.sseProvider, doc.awareness);

    // Setup connection handler - announce WebRTC presence once SSE connects
    doc.sseProvider.onConnected = () => {
      doc.webrtcProvider?.announcePresence();
    };

    // Track sync status via callback
    doc.sseProvider.onSynced = (synced: boolean) => {
      this.updateSyncStatus(noteId, synced ? 'synced' : 'syncing');
    };

    // Connect SSE
    doc.sseProvider.connect();
  }

  /**
   * Close a notebook document
   */
  closeDocument(noteId: string): void {
    const doc = this.openDocs.get(noteId);
    if (!doc) return;

    // Cleanup providers
    doc.sseProvider?.destroy();
    doc.webrtcProvider?.destroy();

    // Cleanup persistence
    doc.persistence.destroy();

    // Cleanup Y.Doc
    doc.ydoc.destroy();

    this.openDocs.delete(noteId);
    console.log(`[NotebookDoc] Closed: ${noteId}`);
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
      sseProvider: null,
      webrtcProvider: null,
    };
    this.openDocs.set(documentId, doc);

    // Update sync status
    this.updateSyncStatus(documentId, 'pending');

    // Connect if online
    if (this.connectivity.canSync()) {
      await this.connectProviders(documentId, doc);
    }

    console.log(`[NotebookDoc] Created new notebook: ${documentId}`);

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
   */
  getPeersCount(noteId: string): number {
    const doc = this.openDocs.get(noteId);
    return doc?.webrtcProvider?.peersConnected() ?? 0;
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
