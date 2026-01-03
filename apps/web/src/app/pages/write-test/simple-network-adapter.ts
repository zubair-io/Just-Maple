import { NetworkAdapter, type PeerId, type Message } from '@automerge/automerge-repo/slim';

/**
 * Simple WebSocket network adapter for testing
 * No auth, single shared document
 */
export class SimpleNetworkAdapter extends NetworkAdapter {
  private ws: WebSocket | null = null;
  private _isReady = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    super();
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
    console.log(
      '[SimpleAdapter] send() called, isReady:',
      this._isReady,
      'wsState:',
      this.ws?.readyState,
    );

    if (!this._isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[SimpleAdapter] Not ready or WS not open, skipping send');
      return;
    }

    const syncData = (message as any).data;
    if (!syncData || !(syncData instanceof Uint8Array)) {
      console.error('[SimpleAdapter] Invalid message format');
      return;
    }

    const documentId = (message as any).documentId;
    const base64 = btoa(String.fromCharCode(...syncData));

    console.log('[SimpleAdapter] Sending message:', {
      documentId,
      dataLength: base64.length,
    });

    this.ws.send(
      JSON.stringify({
        type: 'sync',
        data: base64,
        documentId,
      }),
    );

    console.log('[SimpleAdapter] Message sent');
  }

  private connectWebSocket(): void {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws/test-sync`;

    console.log('[SimpleAdapter] Connecting to:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[SimpleAdapter] Connected');
      this._isReady = true;
      this.resolveReady();

      // Announce server as peer - this triggers the Repo to start syncing
      this.emit('peer-candidate', { peerId: 'server' as PeerId, peerMetadata: {} });

      // The Repo will automatically call send() to initiate sync
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
        }
      } catch (error) {
        console.error('[SimpleAdapter] Error processing message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[SimpleAdapter] WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('[SimpleAdapter] Disconnected');
      this._isReady = false;
      this.emit('peer-disconnected', { peerId: 'server' as PeerId });
    };
  }
}
