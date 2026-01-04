import { NetworkAdapter, type PeerId, type Message } from '@automerge/automerge-repo/slim';

/**
 * WebSocket network adapter with JWT authentication
 */
export class SimpleNetworkAdapter extends NetworkAdapter {
  private ws: WebSocket | null = null;
  private _isReady = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private token: string | null;

  constructor(token: string | null = null) {
    super();
    this.token = token;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  isReady(): boolean {
    return this._isReady;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  connect(peerId: PeerId): void {
    this.peerId = peerId;
    this.connectWebSocket();
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isReady = false;
  }

  send(message: Message): void {
    if (!this._isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (message.type === 'ephemeral') {
      const ephemeralMessage = message as any;
      const data = ephemeralMessage.data;
      // Convert Uint8Array to base64
      const base64 = data instanceof Uint8Array ? btoa(String.fromCharCode(...data)) : data; // Should be Uint8Array but just in case

      this.ws.send(
        JSON.stringify({
          ...ephemeralMessage,
          data: base64,
        }),
      );
      return;
    }

    const syncData = (message as any).data;
    if (!syncData || !(syncData instanceof Uint8Array)) {
      console.error('[SimpleAdapter] Invalid message format');
      return;
    }

    const documentId = (message as any).documentId;
    const base64 = btoa(String.fromCharCode(...syncData));

    this.ws.send(
      JSON.stringify({
        type: 'sync',
        data: base64,
        documentId,
      }),
    );
  }

  private connectWebSocket(): void {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    let wsUrl = `${wsProtocol}//${wsHost}/ws/test-sync`;

    // Add token as query parameter if available
    if (this.token) {
      wsUrl += `?token=${encodeURIComponent(this.token)}`;
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this._isReady = true;
      this.resolveReady();

      // Announce server as peer - this triggers the Repo to start syncing
      this.emit('peer-candidate', { peerId: 'server' as PeerId, peerMetadata: {} });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'sync' && data.data) {
          // Convert base64 to message
          const binaryString = atob(data.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const message: any = {
            type: 'sync',
            senderId: 'server' as PeerId,
            targetId: this.peerId!,
            data: bytes,
          };

          // Include documentId if provided
          if (data.documentId) {
            message.documentId = data.documentId;
          }

          this.emit('message', message);
        } else if (data.type === 'ephemeral') {
          // Convert base64 to Uint8Array
          let bytes: Uint8Array;
          if (typeof data.data === 'string') {
            const binaryString = atob(data.data);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
          } else {
            // Fallback if somehow not base64?
            bytes = data.data;
          }

          const ephemeralMsg: any = {
            type: 'ephemeral',
            senderId: 'server' as PeerId,
            targetId: this.peerId!,
            documentId: data.documentId,
            data: bytes,
          };
          this.emit('message', ephemeralMsg);
        }
      } catch (error) {
        console.error('[SimpleAdapter] Error processing message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[SimpleAdapter] WebSocket error:', error);
    };

    this.ws.onclose = () => {
      this._isReady = false;
      this.emit('peer-disconnected', { peerId: 'server' as PeerId });
    };
  }
}
