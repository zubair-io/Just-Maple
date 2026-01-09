import { cbor, NetworkAdapter, PeerId, PeerMetadata } from '@automerge/automerge-repo/slim';

const { encode, decode } = cbor;

/**
 * Secure WebSocket Network Adapter
 * Passes JWT via Sec-WebSocket-Protocol header instead of query params
 */
export class SecureWebSocketAdapter extends NetworkAdapter {
  private socket: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private ready = false;
  private readyResolver?: () => void;
  private readyPromise: Promise<void> = new Promise<void>((resolve) => {
    this.readyResolver = resolve;
  });

  constructor(url: string, token: string) {
    super();
    this.url = url;
    this.token = token;
  }

  isReady() {
    return this.ready;
  }

  whenReady() {
    return this.readyPromise;
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    console.log('[SecureWS] connect() called with peerId:', peerId);
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.connectWebSocket();
  }

  private connectWebSocket() {
    console.log('[SecureWS] Attempting to connect to:', this.url);
    try {
      // Pass JWT via Sec-WebSocket-Protocol header for security
      // Format: "automerge-v1.${token}"
      this.socket = new WebSocket(this.url, [`automerge-v1.${this.token}`]);
      this.socket.binaryType = 'arraybuffer';
      console.log('[SecureWS] WebSocket created, waiting for connection...');

      this.socket.onopen = () => {
        console.log('[SecureWS] Connected to Automerge sync server');
        this.reconnectAttempts = 0;
        this.ready = true;
        this.readyResolver?.();

        // Send join message
        if (this.peerId && this.socket) {
          const joinMessage = {
            type: 'join',
            senderId: this.peerId,
            peerMetadata: this.peerMetadata || {},
          };
          console.log('[SecureWS] Sending join message:', joinMessage);
          this.socket.send(encode(joinMessage));
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const bytes = new Uint8Array(event.data);
          const message = decode(bytes) as any;
          console.log('[SecureWS] Received message:', message.type, 'from:', message.senderId);

          // When we receive 'peer' response from server, announce it to the Repo
          // This triggers the Repo to start syncing documents with this peer
          if (message.type === 'peer') {
            console.log('[SecureWS] Announcing server as peer candidate');
            this.emit('peer-candidate', {
              peerId: message.senderId,
              peerMetadata: message.peerMetadata || {},
            });
          }

          // Forward all messages (including 'peer') to the Repo
          this.emit('message', message);
        } catch (error) {
          console.error('[SecureWS] Failed to decode message:', error);
        }
      };

      this.socket.onerror = (error) => {
        console.error('[SecureWS] WebSocket error:', error);
      };

      this.socket.onclose = (event) => {
        console.log(`[SecureWS] Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.socket = null;
        this.ready = false;

        // Recreate ready promise for next connection
        this.readyPromise = new Promise<void>((resolve) => {
          this.readyResolver = resolve;
        });

        // Attempt reconnection with exponential backoff
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(
            this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts),
            30000,
          );
          this.reconnectAttempts++;

          console.log(
            `[SecureWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
          );

          setTimeout(() => {
            if (this.shouldReconnect) {
              this.connectWebSocket();
            }
          }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('[SecureWS] Max reconnection attempts reached');
        }
      };
    } catch (error) {
      console.error('[SecureWS] Failed to create WebSocket:', error);
    }
  }

  send(message: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[SecureWS] Cannot send - socket not open');
      return;
    }

    try {
      const encoded = encode(message);
      console.log('[SecureWS] Sending message:', message.type, 'documentId:', message.documentId);
      this.socket.send(encoded);
    } catch (error) {
      console.error('[SecureWS] Failed to send message:', error);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.socket) {
      try {
        this.socket.close(1000, 'Client disconnect');
      } catch (e) {
        console.error('[SecureWS] Error closing socket:', e);
      }
      this.socket = null;
    }
  }
}
