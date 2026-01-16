import * as Y from 'yjs';
import { signal } from '@angular/core';
import { customAlphabet } from 'nanoid';
import type { NotebookSSEEvent, SignalMessage } from '@maple/shared';

// Generate client IDs using nanoid (works in all browsers)
const generateClientId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21,
);

/**
 * YJS SSE Provider
 * Syncs Y.Doc with server via Server-Sent Events
 * Handles document updates and WebRTC signaling relay
 */
export class YJSSSEProvider {
  private eventSource: EventSource | null = null;
  private readonly _clientId: string;
  private authToken: string;

  // Reactive state
  readonly connected = signal(false);
  readonly synced = signal(false);
  readonly error = signal<string | null>(null);

  // Reconnection settings
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Signal handler (set by WebRTC provider)
  onSignal?: (message: SignalMessage) => void;

  // Connection event handlers
  onConnected?: () => void;
  onSynced?: (synced: boolean) => void;

  // Peer event handlers
  onPeerJoin?: (peer: {
    clientId: string;
    userId: string;
    userName: string;
    userColor: string;
  }) => void;
  onPeerLeave?: (clientId: string) => void;

  constructor(
    private readonly noteId: string,
    private readonly ydoc: Y.Doc,
    authToken: string,
  ) {
    this._clientId = generateClientId();
    this.authToken = authToken;

    // Listen for local Y.Doc changes
    this.ydoc.on('update', this.handleLocalUpdate.bind(this));
  }

  get clientId(): string {
    return this._clientId;
  }

  /**
   * Connect to SSE stream
   */
  connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    const url = `/api/notebook/${this.noteId}/events?token=${encodeURIComponent(this.authToken)}&clientId=${this._clientId}`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        console.log(`[YJS-SSE] Connected to ${this.noteId}`);
        this.connected.set(true);
        this.error.set(null);
        this.reconnectAttempts = 0;
        this.onConnected?.();
      };

      this.eventSource.onmessage = this.handleMessage.bind(this);

      this.eventSource.onerror = (event) => {
        console.error('[YJS-SSE] Connection error:', event);
        this.handleError();
      };
    } catch (err) {
      console.error('[YJS-SSE] Failed to create EventSource:', err);
      this.handleError();
    }
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connected.set(false);
    this.synced.set(false);
    this.onSynced?.(false);
  }

  /**
   * Handle incoming SSE message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data: NotebookSSEEvent = JSON.parse(event.data);

      switch (data.type) {
        case 'ydoc-init':
          this.handleInit(data.data);
          break;
        case 'ydoc-update':
          this.handleRemoteUpdate(data.data);
          break;
        case 'signal':
          this.handleSignal(data.data);
          break;
        case 'peer-join':
          this.onPeerJoin?.(data.data);
          break;
        case 'peer-leave':
          this.onPeerLeave?.(data.data.clientId);
          break;
        case 'ping':
          // Keepalive, no action needed
          break;
        default:
          console.log('[YJS-SSE] Unknown event type:', data.type);
      }
    } catch (err) {
      console.error('[YJS-SSE] Failed to parse message:', err);
    }
  }

  /**
   * Handle initial document state from server
   */
  private handleInit(data: { state: string; version: number; peers: any[] }): void {
    try {
      const state = this.base64ToUint8Array(data.state);
      Y.applyUpdate(this.ydoc, state, 'remote');
      this.synced.set(true);
      this.onSynced?.(true);
      console.log(`[YJS-SSE] Initial state applied, version: ${data.version}`);

      // Notify about existing peers
      for (const peer of data.peers || []) {
        this.onPeerJoin?.(peer);
      }
    } catch (err) {
      console.error('[YJS-SSE] Failed to apply initial state:', err);
    }
  }

  /**
   * Handle remote document update
   */
  private handleRemoteUpdate(data: { update: string; from: string }): void {
    try {
      const update = this.base64ToUint8Array(data.update);
      Y.applyUpdate(this.ydoc, update, 'remote');
    } catch (err) {
      console.error('[YJS-SSE] Failed to apply remote update:', err);
    }
  }

  /**
   * Handle signaling message (for WebRTC)
   */
  private handleSignal(data: SignalMessage): void {
    this.onSignal?.(data);
  }

  /**
   * Handle local Y.Doc update
   */
  private async handleLocalUpdate(update: Uint8Array, origin: any): Promise<void> {
    // Don't send back remote updates
    if (origin === 'remote') return;

    // Only send if connected
    if (!this.connected()) {
      // Update will be synced when reconnected via y-indexeddb
      return;
    }

    try {
      await fetch(`/api/notebook/${this.noteId}/update?clientId=${this._clientId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: update as unknown as BodyInit,
      });
    } catch (err) {
      console.error('[YJS-SSE] Failed to send update:', err);
    }
  }

  /**
   * Send signaling message to server for relay
   */
  async sendSignal(message: Omit<SignalMessage, 'from' | 'roomId' | 'timestamp'>): Promise<void> {
    try {
      await fetch(`/api/signal/${this.noteId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          ...message,
          from: this._clientId,
        }),
      });
    } catch (err) {
      console.error('[YJS-SSE] Failed to send signal:', err);
    }
  }

  /**
   * Handle connection error with reconnection logic
   */
  private handleError(): void {
    this.connected.set(false);
    this.synced.set(false);

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Attempt reconnection with exponential backoff
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      const delay = this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;

      console.log(`[YJS-SSE] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      this.error.set(`Connection lost. Reconnecting...`);

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      this.error.set('Connection failed. Please refresh the page.');
      console.error('[YJS-SSE] Max reconnection attempts reached');
    }
  }

  /**
   * Update auth token (e.g., after token refresh)
   */
  updateAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Destroy provider
   */
  destroy(): void {
    this.disconnect();
    this.ydoc.off('update', this.handleLocalUpdate.bind(this));
  }
}
