import { NetworkAdapter, type PeerId, type Message } from '@automerge/automerge-repo/slim';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import type { CollabEvent } from '@maple/shared';
import { environment } from '../../environments/environment';

/**
 * Custom network adapter for Automerge Repo
 * Bridges our existing HTTP/WebSocket sync with automerge-repo protocol
 */
export class JustMapleNetworkAdapter extends NetworkAdapter {
  private ws: WebSocket | null = null;
  private clientID: string | null = null;
  private readonly noteId: string;
  private readonly http: HttpClient;
  private readonly authService: AuthService;
  private _isReady = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private processingBroadcast = false; // Flag to prevent sending responses to broadcasts

  constructor(noteId: string, http: HttpClient, authService: AuthService) {
    super();
    this.noteId = noteId;
    this.http = http;
    this.authService = authService;

    // Create promise for whenReady
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Check if adapter is ready
   */
  isReady(): boolean {
    return this._isReady;
  }

  /**
   * Promise that resolves when adapter is ready
   */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Connect to WebSocket for real-time sync
   * Called by Automerge Repo when adapter is added
   */
  connect(peerId: PeerId): void {
    console.log('[AutomergeNetworkAdapter] ⭐ connect() called with peerId:', peerId);
    //console.log('[AutomergeNetworkAdapter] Note ID:', this.noteId);
    this.peerId = peerId;

    // Only use WebSocket in dev mode (non-SignalR mode)
    if (!environment.useSignalR) {
      console.log('[AutomergeNetworkAdapter] Connecting WebSocket (dev mode)');
      this.connectWebSocket();
    } else {
      console.log('[AutomergeNetworkAdapter] Skipping WebSocket (SignalR mode)');
    }

    // Mark as ready after connection
    setTimeout(() => {
      console.log('[AutomergeNetworkAdapter] Marked as ready');
      this._isReady = true;
      this.resolveReady();
    }, 100);
  }

  /**
   * Disconnect from network
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.clientID = null;
    this._isReady = false;
  }

  /**
   * Send sync message to server
   * Uses WebSocket if available, falls back to HTTP
   */
  send(message: Message): void {
    console.log('[AutomergeNetworkAdapter] send() called, isReady:', this._isReady);
    console.log('[AutomergeNetworkAdapter] Message type:', message.type);

    if (!this._isReady) {
      console.log('[AutomergeNetworkAdapter] Not ready yet, queueing message');
      setTimeout(() => this.send(message), 100);
      return;
    }

    // If processing a broadcast, allow Repo to update state but don't send over network
    if (this.processingBroadcast) {
      console.log(
        '[AutomergeNetworkAdapter] Processing broadcast - Repo state updated, no network send',
      );
      return;
    }

    // Convert message to base64 sync message
    const syncMessage = this.messageToBase64(message);

    // Extract documentId from message
    const documentId = (message as any).documentId;
    console.log('[AutomergeNetworkAdapter] Message documentId:', documentId);

    // Prefer WebSocket if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.clientID) {
      console.log(
        '[AutomergeNetworkAdapter] Sending sync message via WebSocket:',
        `${syncMessage.length} bytes`,
      );

      const wsMessage: any = {
        type: 'automerge-sync',
        noteId: this.noteId,
        clientID: this.clientID,
        syncMessage,
      };

      // Include documentId if available
      if (documentId) {
        wsMessage.documentId = documentId;
      }

      this.ws.send(JSON.stringify(wsMessage));
      console.log('[AutomergeNetworkAdapter] Sync message sent via WebSocket');
      return;
    }

    // Fallback to HTTP
    console.log(
      '[AutomergeNetworkAdapter] Sending sync message via HTTP:',
      `${syncMessage.length} bytes`,
    );

    this.http
      .post<any>(`/api/collab/${this.noteId}/automerge-sync`, {
        syncMessage,
        clientID: this.clientID,
      })
      .subscribe({
        next: (response) => {
          console.log('[AutomergeNetworkAdapter] Sync message sent successfully');
          if (response.syncMessage) {
            // Server responded with sync message
            const responseMsg = this.base64ToMessage(response.syncMessage);
            if (responseMsg) {
              this.emit('message', responseMsg);
            }
          }
        },
        error: (error) => {
          console.error('[AutomergeNetworkAdapter] Failed to send sync message:', error);
          this.emit('peer-disconnected', { peerId: 'server' as PeerId });
        },
      });
  }

  /**
   * Connect to WebSocket for real-time updates (dev mode only)
   */
  private connectWebSocket(): void {
    const token = this.authService.accessToken();
    if (!token) {
      console.error('[AutomergeNetworkAdapter] No access token available');
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws/collab/${this.noteId}?token=${token}`;

    console.log('[AutomergeNetworkAdapter] Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[AutomergeNetworkAdapter] WebSocket connected');
      // Wait for init message with clientID before announcing peer
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as CollabEvent;
        console.log('[AutomergeNetworkAdapter] Received message:', data.type);

        // Store clientID from init message
        if (data.type === 'init' && data.clientID) {
          this.clientID = data.clientID;
          console.log('[AutomergeNetworkAdapter] Received clientID:', this.clientID);

          // Now announce server as a peer so Repo knows to sync with it
          console.log('[AutomergeNetworkAdapter] Announcing server peer');
          this.emit('peer-candidate', { peerId: 'server' as PeerId, peerMetadata: {} });
        }

        // Handle Automerge sync messages
        if (data.type === 'automerge-sync' && data.syncMessage) {
          const isBroadcast = (data as any).isBroadcast === true;
          console.log(
            `[AutomergeNetworkAdapter] Processing automerge-sync message (broadcast: ${isBroadcast})`,
          );

          // If this is a broadcast message, process it but don't let Repo send a response
          if (isBroadcast) {
            console.log(
              '[AutomergeNetworkAdapter] Broadcast message - processing without response',
            );
            // Extract documentId from the original message if available
            const documentId = (data as any).documentId;
            const message = this.base64ToMessage(data.syncMessage, documentId);
            if (message) {
              // Set flag to prevent send() from working
              this.processingBroadcast = true;
              // Emit to Repo (it will try to send, but send() will skip)
              this.emit('message', message);
              // Reset flag after a small delay to allow Repo to finish processing
              setTimeout(() => {
                this.processingBroadcast = false;
              }, 500);
            }
          } else {
            // Normal sync message - full bidirectional sync
            const documentId = (data as any).documentId;
            const message = this.base64ToMessage(data.syncMessage, documentId);
            if (message) {
              console.log('[AutomergeNetworkAdapter] Emitting message to Repo');
              this.emit('message', message);
            }
          }
        }
      } catch (error) {
        console.error('[AutomergeNetworkAdapter] Error processing WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[AutomergeNetworkAdapter] WebSocket error:', error);
    };

    this.ws.onclose = (event) => {
      console.log('[AutomergeNetworkAdapter] WebSocket closed:', event.code, event.reason);
      this.emit('peer-disconnected', { peerId: 'server' as PeerId });
    };
  }

  /**
   * Convert Automerge Repo message to base64 sync message
   */
  private messageToBase64(message: Message): string {
    // Automerge Repo messages contain a 'data' field with the sync message
    const syncData = (message as any).data;
    if (!syncData || !(syncData instanceof Uint8Array)) {
      console.error('[AutomergeNetworkAdapter] Invalid message format:', message);
      throw new Error('Invalid message format');
    }
    return btoa(String.fromCharCode(...syncData));
  }

  /**
   * Convert base64 sync message to Automerge Repo message
   */
  private base64ToMessage(base64: string, documentId?: string): Message | null {
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Wrap in Automerge Repo message format
      const message: any = {
        type: 'sync',
        senderId: 'server' as PeerId,
        targetId: this.peerId!,
        data: bytes,
      };

      // Add documentId if provided
      if (documentId) {
        message.documentId = documentId;
      }

      console.log('[AutomergeNetworkAdapter] Converted message with documentId:', documentId);
      return message as Message;
    } catch (error) {
      console.error(
        '[AutomergeNetworkAdapter] Error converting base64 to message:',
        error,
        'Base64 length:',
        base64?.length,
      );
      return null;
    }
  }
}
