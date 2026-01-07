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
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

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
    const token = this.authService.accessToken();

    //  const networkAdapter = new SimpleNetworkAdapter(token);
    //const networkAdapter = new JustMapleNetworkAdapter(noteId, this.http, this.authService);

    // Initialize repo with storage only, no network adapters yet
    // WebRTC adapters will be added per-document

    //const storage = new IndexedDBStorageAdapter('just-maple-automerge');
    //const network = new WebSocketClientAdapter("ws://localhost:3030");
    const storage = new NoteServiceStorageAdapter(this.noteService, this.indexedDBService);
    this.repo = new Repo({
      storage,
      network: [new WebSocketClientAdapter('wss://sync.automerge.org')],
    });

    storage.setRepo(this.repo);
    this.ready.set(true);
  }
}
