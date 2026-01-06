import { inject, Injectable, signal } from '@angular/core';
import { Automerge, Repo } from '@automerge/automerge-repo/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { AuthService } from '../../services/auth.service';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { HttpClient } from '@angular/common/http';
import { WebRTCNetworkAdapter } from './webrtc-network-adapter';
import { HTTPNetworkAdapter } from './http-network-adapter';
import { NoteService } from '../../services/note.service';
import { NoteServiceStorageAdapter } from './note-service-storage-adapter';
import * as AutomergeCore from '@automerge/automerge/slim';
import { firstValueFrom } from 'rxjs';

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

@Injectable({ providedIn: 'root' })
export class WriteService {
  ready = signal(false);
  repo!: Repo;
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private noteService = inject(NoteService);

  // Store active adapters for cleanup
  private activeWebRTCAdapters: WebRTCNetworkAdapter[] = [];
  private activeHTTPAdapters: HTTPNetworkAdapter[] = [];

  constructor() {
    this.init();
  }

  private async init() {
    await Automerge.initializeBase64Wasm(automergeWasmBase64);

    // Initialize repo with storage only, no network adapters yet
    // WebRTC adapters will be added per-document

    // const httpAdapter = new HTTPNetworkAdapter(this.http, this.authService);

    this.repo = new Repo({
      storage: new NoteServiceStorageAdapter(this.noteService),
      network: [],
    });
    this.ready.set(true);

    // Subscribe to note updates to merge server changes
    // This handles the "background sync" part where server data comes in
    // and we need to merge it into the local Automerge doc
    // Note: This relies on NoteService emitting updates via notes$ or activeNote$
    // We might need a more targeted subscription if performance becomes an issue
    // but for now, we'll listen to specific note updates if we have a handle open.
    // TODO: Ideally we only subscribe when we have an open handle.
    // For now, let's add a method to sync a specific note when requested.
  }

  /**
   * Sync a document with the server
   * - Fetches latest from server
   * - Merges into local repo
   */
  async syncDocument(documentId: string): Promise<void> {
    try {
      if (!this.repo) return;
      const handle = await this.repo.find(documentId as any);
      if (!handle) return;

      console.log('[WriteService] Syncing document...', documentId);
      // Fetch latest note from server
      const note = await firstValueFrom(this.noteService.getNote(documentId));

      if (note.automergeDoc) {
        const serverBinary = base64ToBytes(note.automergeDoc as string);
        const serverDoc = AutomergeCore.load(serverBinary);

        handle.change((doc: any) => {
          AutomergeCore.merge(doc, serverDoc);
        });
        console.log('[WriteService] Merged server changes for', documentId);
      }
    } catch (err) {
      console.error('[WriteService] Error syncing document:', err);
    }
  }

  /**
   * Enable both HTTP and WebRTC adapters for a specific document
   * Creates HTTP sync + P2P connections to other peers
   */
  enableNetworkAdapters(
    documentId: string,
    noteId: string,
    userId: string,
    options?: {
      onAllPeersDisconnected?: (noteId: string, docHandle: any) => void;
    },
  ): { webrtc: WebRTCNetworkAdapter } {
    if (!this.repo) {
      throw new Error('[WriteService] Cannot enable adapters - repo not initialized');
    }

    // Create WebRTC adapter for P2P sync
    const webrtcAdapter = new WebRTCNetworkAdapter(documentId, userId, this.http, this.authService);

    // Listen for all peers disconnecting
    if (options?.onAllPeersDisconnected) {
      (webrtcAdapter as any).on('all-peers-disconnected', async () => {
        console.warn('[WriteService] All WebRTC peers disconnected');
        // Get the doc handle from repo
        const handle = this.repo.find(documentId as any);
        if (handle && options.onAllPeersDisconnected) {
          options.onAllPeersDisconnected(documentId, handle);
        }
      });
    }

    this.repo.networkSubsystem.addNetworkAdapter(webrtcAdapter);
    this.activeWebRTCAdapters.push(webrtcAdapter);

    return { webrtc: webrtcAdapter };
  }

  /**
   * Clean up all network adapters
   */
  cleanup(): void {
    // Clean up WebRTC adapters
    for (const adapter of this.activeWebRTCAdapters) {
      try {
        adapter.disconnect();
      } catch (error) {
        console.error('[WriteService] Error disconnecting WebRTC adapter:', error);
      }
    }
    this.activeWebRTCAdapters = [];

    // Clean up HTTP adapters
    for (const adapter of this.activeHTTPAdapters) {
      try {
        adapter.disconnect();
      } catch (error) {
        console.error('[WriteService] Error disconnecting HTTP adapter:', error);
      }
    }
    this.activeHTTPAdapters = [];
  }
}
