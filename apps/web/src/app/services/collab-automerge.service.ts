import { Injectable } from '@angular/core';
import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import type { NoteContent } from '@maple/shared';

/**
 * Automerge collaboration service using SignalR for sync
 * Does NOT use Automerge Repo - uses manual sync via SignalR instead
 */
@Injectable({ providedIn: 'root' })
export class CollabAutomergeService {
  private documents = new Map<string, Automerge.Doc<any>>();
  private syncStates = new Map<string, Automerge.SyncState>();
  private wasmInitialized = false;

  /**
   * Initialize Wasm for Automerge
   */
  async initialize(): Promise<void> {
    if (this.wasmInitialized) return;

    console.log('[Automerge] Initializing Wasm with base64');
    await Automerge.initializeBase64Wasm(automergeWasmBase64);
    this.wasmInitialized = true;
    console.log('[Automerge] Wasm initialized successfully');
  }

  /**
   * Load or create Automerge document for a note
   * Handles lazy migration from ProseMirror JSON if needed
   */
  loadOrCreateDocument(
    noteId: string,
    serverData: {
      automergeDoc?: Uint8Array;
      content?: any;
    },
  ): Automerge.Doc<any> {
    // Check if we already have a document
    const existingDoc = this.documents.get(noteId);
    if (existingDoc) {
      console.log('[Automerge] Using existing document for note', noteId);
      return existingDoc;
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

    // Store document
    this.documents.set(noteId, doc);

    // Initialize sync state for this note
    this.syncStates.set(noteId, Automerge.initSyncState());

    console.log('[Automerge] Document ready for note', noteId);

    return doc;
  }

  /**
   * Update document with new content
   */
  updateDocument(noteId: string, content: NoteContent): Automerge.Doc<any> {
    let doc = this.documents.get(noteId);
    if (!doc) {
      throw new Error(`Document not found for note ${noteId}`);
    }

    // Create change in document
    doc = Automerge.change(doc, (d: any) => {
      d.content = content;
    });

    this.documents.set(noteId, doc);
    return doc;
  }

  /**
   * Get current document
   */
  getDocument(noteId: string): Automerge.Doc<any> | undefined {
    return this.documents.get(noteId);
  }

  /**
   * Generate sync message to send to other clients
   */
  generateSyncMessage(noteId: string): Uint8Array | null {
    const doc = this.documents.get(noteId);
    const syncState = this.syncStates.get(noteId);

    if (!doc || !syncState) {
      return null;
    }

    const [newSyncState, message] = Automerge.generateSyncMessage(doc, syncState);

    // Update sync state
    this.syncStates.set(noteId, newSyncState);

    return message || null;
  }

  /**
   * Receive and apply sync message from another client
   */
  receiveSyncMessage(noteId: string, message: Uint8Array): Automerge.Doc<any> | null {
    let doc = this.documents.get(noteId);
    let syncState = this.syncStates.get(noteId);

    if (!doc || !syncState) {
      console.error('[Automerge] No document or sync state for note', noteId);
      return null;
    }

    // Apply sync message
    const [newDoc, newSyncState] = Automerge.receiveSyncMessage(doc, syncState, message);

    // Update stored document and sync state
    this.documents.set(noteId, newDoc);
    this.syncStates.set(noteId, newSyncState);

    return newDoc;
  }

  /**
   * Migrate ProseMirror JSON to Automerge document
   */
  private migrateFromProseMirror(content: any): Automerge.Doc<any> {
    const doc = Automerge.from({
      content: this.convertProseMirrorToAutomerge(content),
    });
    return doc;
  }

  /**
   * Convert ProseMirror JSON to Automerge-compatible format
   */
  private convertProseMirrorToAutomerge(prosemirrorContent: any): any {
    // Deep clone to avoid mutation
    return JSON.parse(JSON.stringify(prosemirrorContent));
  }

  /**
   * Clean up document when note is closed
   */
  cleanupDocument(noteId: string): void {
    this.documents.delete(noteId);
    this.syncStates.delete(noteId);
    console.log('[Automerge] Cleaned up document for note', noteId);
  }
}
