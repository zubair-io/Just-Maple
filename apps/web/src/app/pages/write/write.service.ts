import { inject, Injectable, signal } from '@angular/core';
import { Automerge, Repo } from '@automerge/automerge-repo/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { AuthService } from '../../services/auth.service';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { HttpClient } from '@angular/common/http';
import { NoteService } from '../../services/note.service';
import { NoteServiceStorageAdapter } from './note-service-storage-adapter';
import { IndexedDBService } from '../../services/indexed-db.service';
import { SecureWebSocketAdapter } from './secure-websocket-adapter';
import { environment } from '../../../environments/environment';

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

    const networkAdapter = new SecureWebSocketAdapter(wsUrl, token);
    const storage = new NoteServiceStorageAdapter(this.noteService, this.indexedDBService);
    this.repo = new Repo({
      storage,
      network: [networkAdapter],
      peerId: peerId as any,
    });

    storage.setRepo(this.repo);

    // Wait for network to connect before marking ready
    await networkAdapter.whenReady();

    this.ready.set(true);
  }

  private buildWebSocketUrl(): string {
    // If wsUrl is configured, use it directly
    if (environment.wsUrl) {
      return `${environment.wsUrl}/ws/automerge-sync`;
    }

    // If apiUrl is configured, derive WebSocket URL from it
    if (environment.apiUrl) {
      const wsUrl = environment.apiUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
      return `${wsUrl}/ws/automerge-sync`;
    }

    // Development: proxy to backend via Angular dev server
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      return `${protocol}//${host}/ws/automerge-sync`;
    }

    // SSR fallback (shouldn't happen but be safe)
    return 'ws://localhost:4200/ws/automerge-sync';
  }
}
