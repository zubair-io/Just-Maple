import {
  NetworkAdapter,
  type PeerId,
  type Message,
  type PeerMetadata,
} from '@automerge/automerge-repo/slim';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { firstValueFrom } from 'rxjs';

// ============================================================
// HTTP Network Adapter (Server Sync)
// ============================================================

/**
 * HTTP Network Adapter for Automerge
 * Syncs documents with server using Automerge sync protocol over HTTP
 */
export class HTTPNetworkAdapter extends NetworkAdapter {
  // private documentId: string;
  // private noteId: string;
  //private userId: string;
  private http: HttpClient;
  private authService: AuthService;

  // Connection state
  private _isReady = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  // Polling for server changes
  private syncInterval: any;
  private readonly SYNC_INTERVAL = 5000; // Sync every 5 seconds
  private readonly API_BASE = '/api/collab';

  constructor(http: HttpClient, authService: AuthService) {
    super();

    this.http = http;
    this.authService = authService;

    // Create ready promise
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Connect to the server
   */
  connect(peerId: PeerId): void {
    this.peerId = peerId;

    // Mark as ready immediately (HTTP is always available)
    this._isReady = true;
    this.resolveReady();

    // Announce "server" as a peer so Repo knows to sync with it
    this.emit('peer-candidate', {
      peerId: 'server' as PeerId,
      peerMetadata: { type: 'http-server' } as PeerMetadata,
    });
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    // Stop sync polling
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this._isReady = false;
  }

  /**
   * Send a message to the server
   */
  send(message: Message): void {
    if (!message.data) {
      console.warn('[HTTP Adapter] Message has no data');
      return;
    }

    // Only send to server peer
    if (message.targetId !== 'server') {
      return;
    }

    const messageData =
      message.data instanceof Uint8Array
        ? message.data
        : new Uint8Array(message.data as ArrayBuffer);

    // Send sync message to server via HTTP
    // this.sendSyncMessageToServer(messageData, message.targetId as string).catch((error) => {
    //   console.error('[HTTP Adapter] Failed to send message to server:', error);
    // });
  }

  /**
   * Check if the adapter is ready
   */
  isReady(): boolean {
    return this._isReady;
  }

  /**
   * Wait for the adapter to be ready
   */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  // ==================== Private Methods ====================

  /**
   * Start periodic sync with server
   */
  private startPeriodicSync(): void {
    // Sync happens automatically when Repo has changes (via send())
    // But we should trigger an initial sync to pull server state
  }

  /**
   * Trigger a manual sync with server (not used for now - Repo drives sync)
   */
  private async syncWithServer(): Promise<void> {
    // This would be used for periodic polling, but Automerge Repo
    // will call send() when it has changes to push/pull
    // So we don't need to poll - we react to Repo's send() calls
  }

  /**
   * Send sync message to server via HTTP
   */
  // private async sendSyncMessageToServer(syncMessage: Uint8Array, targetId: string): Promise<void> {
  //   try {
  //     const token = this.authService.accessToken();

  //     // Convert to base64
  //     const base64Message = this.uint8ArrayToBase64(syncMessage);

  //     console.log(
  //       '[HTTP Adapter] Sending sync message to server, size:',
  //       syncMessage.length,
  //       'bytes',
  //     );

  //     // Use the noteId passed to constructor
  //     const response = await firstValueFrom(
  //       this.http.post<{ syncMessage: string }>(
  //         `${this.API_BASE}/${this.noteId}/automerge-sync`,
  //         {
  //           syncMessage: base64Message,
  //           clientID: this.peerId,
  //         },
  //         {
  //           headers: {
  //             Authorization: `Bearer ${token}`,
  //           },
  //         },
  //       ),
  //     );

  //     console.log('[HTTP Adapter] Received response from server');

  //     // Decode response
  //     const serverSyncMessage = this.base64ToUint8Array(response.syncMessage);

  //     if (serverSyncMessage.length > 0) {
  //       // Emit server's response back to Automerge Repo
  //       this.emit('message', {
  //         type: 'sync',
  //         senderId: 'server' as PeerId,
  //         targetId: this.peerId!,
  //         data: serverSyncMessage,
  //         documentId: this.documentId,
  //       } as any);

  //       console.log(
  //         '[HTTP Adapter] Received sync message from server, size:',
  //         serverSyncMessage.length,
  //         'bytes',
  //       );
  //     }
  //   } catch (error) {
  //     console.error('[HTTP Adapter] Failed to send sync message:', error);
  //   }
  // }

  /**
   * Convert Uint8Array to base64
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}
