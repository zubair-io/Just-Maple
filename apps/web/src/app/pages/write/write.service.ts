import { inject, Injectable, signal } from '@angular/core';
import { Automerge, Repo } from '@automerge/automerge-repo/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { AuthService } from '../../services/auth.service';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { SimpleNetworkAdapter } from './simple-network-adapter';

@Injectable({ providedIn: 'root' })
export class WriteService {
  ready = signal(false);
  repo!: Repo;
  private authService = inject(AuthService);

  constructor() {
    this.init();
  }

  private async init() {
    await Automerge.initializeBase64Wasm(automergeWasmBase64);
    const token = this.authService.accessToken();
    const networkAdapter = new SimpleNetworkAdapter(token);

    this.repo = new Repo({
      storage: new IndexedDBStorageAdapter('just-maple-notes'),
      network: [networkAdapter],
    });
    this.ready.set(true);
  }
}
