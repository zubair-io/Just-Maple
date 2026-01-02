import { Injectable } from '@angular/core';
import { Repo, DocHandle } from '@automerge/automerge-repo/slim';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';

/**
 * Automerge collaboration service for the frontend
 * Manages Automerge Repo for automatic CRDT sync and offline support
 */
@Injectable({ providedIn: 'root' })
export class CollabAutomergeService {
  private repo: Repo | null = null;
  private handles = new Map<string, DocHandle<any>>();
  private wasmInitialized = false;

  /**
   * Initialize Automerge Repo with IndexedDB storage (offline-only mode)
   * TODO: Add network sync adapter once backend Automerge Repo is set up
   */
  async initializeRepo(wsUrl: string): Promise<Repo> {
    if (this.repo) return this.repo;

    // Initialize Wasm first (if not already done)
    if (!this.wasmInitialized) {
      console.log('[Automerge] Initializing Wasm with base64');
      await Automerge.initializeBase64Wasm(automergeWasmBase64);
      this.wasmInitialized = true;
      console.log('[Automerge] Wasm initialized successfully');
    }

    console.log('[Automerge] Initializing Automerge Repo (offline-only mode)');

    this.repo = new Repo({
      // NOTE: Network adapter disabled for now - backend needs Automerge Repo server adapter
      // network: [new BrowserWebSocketClientAdapter(wsUrl)],

      // IndexedDB for offline persistence
      storage: new IndexedDBStorageAdapter(),

      // Enable all peers
      sharePolicy: async () => true,
    });

    console.log('[Automerge] Repo initialized with IndexedDB storage (offline-only)');

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
