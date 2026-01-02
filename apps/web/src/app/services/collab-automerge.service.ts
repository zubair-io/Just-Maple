import { Injectable } from '@angular/core';
import { Repo, DocHandle } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as Automerge from '@automerge/automerge/slim';

/**
 * Automerge collaboration service for the frontend
 * Manages Automerge Repo for automatic CRDT sync and offline support
 */
@Injectable({ providedIn: 'root' })
export class CollabAutomergeService {
  private repo: Repo | null = null;
  private handles = new Map<string, DocHandle<any>>();

  /**
   * Initialize Automerge Repo with WebSocket and IndexedDB storage
   */
  async initializeRepo(wsUrl: string): Promise<Repo> {
    if (this.repo) return this.repo;

    console.log('[Automerge] Initializing Automerge Repo with WebSocket:', wsUrl);

    this.repo = new Repo({
      // WebSocket for server sync
      network: [new BrowserWebSocketClientAdapter(wsUrl)],

      // IndexedDB for offline persistence (AUTOMATIC)
      storage: new IndexedDBStorageAdapter(),

      // Enable all peers
      sharePolicy: async () => true,
    });

    // Monitor connection status
    // Note: Repo events are handled automatically by Automerge Repo
    console.log('[Automerge] Repo initialized with automatic network sync');

    return this.repo;
  }

  /**
   * Load or create Automerge document for a note
   * Handles lazy migration from ProseMirror JSON if needed
   */
  async loadOrCreateDocument(
    noteId: string,
    serverData: {
      automergeDoc?: Uint8Array;
      content?: any;
    },
  ): Promise<DocHandle<any>> {
    const repo = this.repo;
    if (!repo) throw new Error('Automerge Repo not initialized');

    // Check if we already have a handle for this note
    const existingHandle = this.handles.get(noteId);
    if (existingHandle) {
      console.log('[Automerge] Using existing document handle for note', noteId);
      return existingHandle;
    }

    let doc: Automerge.Doc<any>;

    if (serverData.automergeDoc) {
      // Load from binary (already migrated)
      console.log('[Automerge] Loading existing Automerge document for note', noteId);
      doc = Automerge.load(serverData.automergeDoc);
    } else {
      // MIGRATE: Convert ProseMirror JSON to Automerge
      console.log('[Automerge] Migrating note', noteId, 'from ProseMirror JSON to Automerge');
      doc = this.migrateFromProseMirror(serverData.content);
    }

    // Create handle from existing document
    const handle = repo.create(doc);

    // Save to IndexedDB immediately
    await handle.whenReady();

    // Store handle for reuse
    this.handles.set(noteId, handle);

    console.log('[Automerge] Document ready for note', noteId);

    return handle;
  }

  /**
   * Migrate ProseMirror JSON to Automerge document
   */
  private migrateFromProseMirror(content: any): Automerge.Doc<any> {
    // Convert ProseMirror JSON to Automerge format
    // For now, we store it directly - full implementation uses SchemaAdapter
    const doc = Automerge.from({
      content: this.convertProseMirrorToAutomerge(content),
    });
    return doc;
  }

  /**
   * Convert ProseMirror JSON to Automerge-compatible format
   * NOTE: Simplified conversion - full implementation uses SchemaAdapter
   */
  private convertProseMirrorToAutomerge(prosemirrorContent: any): any {
    // Deep clone to avoid mutation
    return JSON.parse(JSON.stringify(prosemirrorContent));
  }

  /**
   * Clean up document handle when note is closed
   */
  cleanupDocument(noteId: string): void {
    const handle = this.handles.get(noteId);
    if (handle) {
      // DocHandle cleanup is automatic in Automerge Repo
      this.handles.delete(noteId);
      console.log('[Automerge] Cleaned up document handle for note', noteId);
    }
  }

  /**
   * Get repository instance
   */
  getRepo(): Repo | null {
    return this.repo;
  }
}
