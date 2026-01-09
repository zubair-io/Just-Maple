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
import { IndexedDBService } from '../../services/indexed-db.service';
import { SimpleNetworkAdapter } from './simple-network-adapter';
import { JustMapleNetworkAdapter } from '../../services/automerge-network-adapter';
import { SecureWebSocketAdapter } from './secure-websocket-adapter';

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
  private indexedDBService = inject(IndexedDBService);

  constructor() {
    this.init();
  }

  private async init() {
    await Automerge.initializeBase64Wasm(automergeWasmBase64);

    // Get authentication token
    const token = this.authService.accessToken() as string;

    // Build WebSocket URL (no token in query params)
    const wsUrl = this.buildWebSocketUrl();

    // Generate unique peer ID for this client
    const peerId = `client-${Math.random().toString(36).substring(2, 15)}`;
    console.log('[WriteService] Initializing Automerge Repo with peerId:', peerId);

    const networkAdapter = new SecureWebSocketAdapter(wsUrl, token);
    const storage = new NoteServiceStorageAdapter(this.noteService, this.indexedDBService);
    this.repo = new Repo({
      storage,
      network: [networkAdapter],
      peerId: peerId as any,
    });

    storage.setRepo(this.repo);

    // IMPORTANT: Wait for network to connect before marking ready
    // This ensures documents will sync with server when opened
    console.log('[WriteService] Waiting for network connection...');
    await networkAdapter.whenReady();
    console.log('[WriteService] Network connected!');

    this.ready.set(true);
    console.log('[WriteService] Repo initialized and ready');
  }

  private buildWebSocketUrl(): string {
    // Development: proxy to backend via Angular dev server
    // Production: direct connection to backend
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      return `${protocol}//${host}/ws/automerge-sync`;
    }
    // SSR fallback (shouldn't happen but be safe)
    return 'ws://localhost:4200/ws/automerge-sync';
  }
}
