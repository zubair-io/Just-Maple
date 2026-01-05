import { Injectable, inject } from '@angular/core';
import { Repo } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import type { DocHandle } from '@automerge/automerge-repo/slim';
import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { JustMapleNetworkAdapter } from './automerge-network-adapter';
import type { NoteContent } from '@maple/shared';

/**
 * Automerge collaboration service using Automerge Repo
 * Uses IndexedDB storage and custom network adapter for sync
 */
@Injectable({ providedIn: 'root' })
export class CollabAutomergeService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  private repo: Repo | null = null;
  private handles = new Map<string, DocHandle<any>>();
  private networkAdapters = new Map<string, JustMapleNetworkAdapter>();
  private wasmInitialized = false;

  /**
   * Initialize Automerge Repo with IndexedDB storage
   */
  async initialize(): Promise<void> {
    if (this.repo) return;

    // Initialize Wasm first
    if (!this.wasmInitialized) {
      await Automerge.initializeBase64Wasm(automergeWasmBase64);
      this.wasmInitialized = true;
    }

    // Create repo with IndexedDB storage
    // Network adapters are added per-note in getOrCreateHandle()
    this.repo = new Repo({
      storage: new IndexedDBStorageAdapter('just-maple-automerge'),
      // Network will be added per-note
      network: [],
    });
  }

  /**
   * Get or create DocHandle for a note
   * This will create a network adapter for syncing with the backend
   *
   * Migration strategy:
   * - If automergeDoc exists: Load from binary (already in CRDT format)
   * - If automergeDoc missing: Create empty doc, AutoMirror will populate from ProseMirror JSON
   */
  async getOrCreateHandle(
    noteId: string,
    serverData: {
      automergeDoc?: any;
      automergeUrl?: string;
      content?: any;
    },
  ): Promise<{ handle: DocHandle<any>; shouldMigrate: boolean }> {
    if (!this.repo) {
      throw new Error('Repo not initialized');
    }

    // Check if we already have a handle
    // const existingHandle = this.handles.get(noteId);
    // if (existingHandle) {
    //   return { handle: existingHandle, shouldMigrate: false };
    // }

    // Create and connect network adapter BEFORE creating document
    // This is critical - the repo needs the adapter before the document exists
    // const networkAdapter = new JustMapleNetworkAdapter(noteId, this.http, this.authService);
    // this.networkAdapters.set(noteId, networkAdapter);
    //this.repo.networkSubsystem.addNetworkAdapter(networkAdapter);

    // Wait for adapter to be ready
    //await networkAdapter.whenReady();

    let handle: DocHandle<any>;
    let shouldMigrate = false;

    // STRATEGY: Use automergeUrl from database to ensure all clients get the same document
    if (serverData.automergeUrl) {
      // Use stored URL to find existing document
      try {
        handle = await this.repo.find(serverData.automergeUrl as any);
        shouldMigrate = false;
      } catch (error) {
        console.error('[Automerge Repo] Failed to find document by URL:', error);
        // Fallback: create new document
        // Fallback: create new document
        handle = this.repo.create({ text: '' });
        handle.change((d) => {
          // Initialize with a paragraph block
          Automerge.splitBlock(d, ['text'], 0, { type: 'paragraph' });
        });
        shouldMigrate = true;
      }
    } else {
      // No URL stored yet - create new document and we'll save the URL to DB
      // No URL stored yet - create new document and we'll save the URL to DB
      handle = this.repo.create({ text: '' });
      handle.change((d) => {
        // Initialize with a paragraph block
        Automerge.splitBlock(d, ['text'], 0, { type: 'paragraph' });
      });

      shouldMigrate = true;
    }

    // Save document URL to database if it's a new document
    if (shouldMigrate && !serverData.automergeUrl) {
      try {
        await this.http
          .put(`/api/notes/${noteId}`, {
            automergeUrl: handle.url,
          })
          .toPromise();
      } catch (error) {
        console.error('[Automerge Repo] Failed to save document URL:', error);
      }
    }

    // Store handle
    this.handles.set(noteId, handle);

    return { handle, shouldMigrate };
  }

  /**
   * Get handle for a note
   */
  getHandle(noteId: string): DocHandle<any> | undefined {
    return this.handles.get(noteId);
  }

  /**
   * Manually trigger sync for a document
   * Tell the Repo to sync this document with all peers
   */
  syncDocument(noteId: string): void {
    const handle = this.handles.get(noteId);

    if (!handle || !this.repo) {
      return;
    }

    // Request the repo to sync this specific document
    // The repo will call our network adapter's send() method
    try {
      // Force the repo to sync by accessing the document
      // This should trigger the sync protocol
      const doc = handle.doc();
      if (doc) {
        // The repo should notice the document has changes and sync
        // But we need to explicitly tell it to sync

        // Try using the repo's sync API
        // @ts-ignore - accessing internal API
        if (this.repo.syncProtocol) {
          // @ts-ignore
          this.repo.syncProtocol.beginSync(handle.url);
        }
      }
    } catch (error) {
      console.error('[Automerge Repo] Error requesting sync:', error);
    }
  }

  /**
   * Get empty ProseMirror content
   */
  private getEmptyContent(): NoteContent {
    return {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [],
        },
      ],
    };
  }

  /**
   * Convert various binary formats to Uint8Array
   * Handles MongoDB Buffer serialization formats
   */
  private convertToUint8Array(data: any): Uint8Array {
    // Already a Uint8Array
    if (data instanceof Uint8Array) {
      return data;
    }

    // MongoDB Buffer object format: { type: 'Buffer', data: [1, 2, 3, ...] }
    if (data && typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
      return new Uint8Array(data.data);
    }

    // Base64 string
    if (typeof data === 'string') {
      const binaryString = atob(data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }

    // Array of numbers
    if (Array.isArray(data)) {
      return new Uint8Array(data);
    }

    console.error('[Automerge Repo] Unknown binary data format:', typeof data, data);
    throw new Error('Unable to convert data to Uint8Array');
  }

  /**
   * Clean up document when note is closed
   */
  cleanupDocument(noteId: string): void {
    // Disconnect network adapter
    const networkAdapter = this.networkAdapters.get(noteId);
    if (networkAdapter && this.repo) {
      this.repo.networkSubsystem.removeNetworkAdapter(networkAdapter);
      networkAdapter.disconnect();
      this.networkAdapters.delete(noteId);
    }

    // Remove handle
    this.handles.delete(noteId);
  }
}
