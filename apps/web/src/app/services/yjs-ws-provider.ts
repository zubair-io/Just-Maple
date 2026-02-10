import * as Y from 'yjs';
import { signal } from '@angular/core';
import { customAlphabet } from 'nanoid';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import type { MemoSSEEvent } from '@maple/shared';
import type { RealtimeWSService } from './realtime-ws.service';

// Generate client IDs using nanoid
const generateClientId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  21,
);

/**
 * Y.js WebSocket Provider
 * Syncs Y.Doc with server via unified WebSocket connection
 * Handles document updates and peer awareness
 */
export class YJSWSProvider {
  private readonly _clientId: string;
  private unsubscribeHandler: (() => void) | null = null;
  private awarenessUpdateHandler: ((changes: any) => void) | null = null;

  // Reactive state
  readonly connected = signal(false);
  readonly synced = signal(false);
  readonly error = signal<string | null>(null);

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
    private readonly pageId: string,
    private readonly ydoc: Y.Doc,
    private readonly realtimeWS: RealtimeWSService,
    private readonly awareness?: Awareness,
    private readonly pageType?: 'memo' | 'whiteboard' | 'kanban',
    private readonly parentPageId?: string, // For embedded whiteboards
  ) {
    this._clientId = generateClientId();

    // Listen for local Y.Doc changes
    this.ydoc.on('update', this.handleLocalUpdate.bind(this));

    // Listen for local awareness changes
    if (this.awareness) {
      this.awarenessUpdateHandler = ({ added, updated, removed }: any) => {
        const changedClients = added.concat(updated).concat(removed);
        this.handleLocalAwarenessUpdate(changedClients);
      };
      this.awareness.on('update', this.awarenessUpdateHandler);
    }
  }

  get clientId(): string {
    return this._clientId;
  }

  /**
   * Connect to memo room via WebSocket
   */
  connect(): void {
    console.log(
      `[YJS-WS] Connecting to memo: ${this.pageId}, clientId: ${this._clientId}, parentPageId: ${this.parentPageId}`,
    );

    // Register event handler for this memo
    this.realtimeWS.onMemoEvent(this.pageId, this.handleEvent.bind(this));

    // Join the memo room (pass parentPageId for embedded whiteboards)
    this.realtimeWS.joinMemo(this.pageId, this._clientId, this.parentPageId);

    // Track connection state based on realtimeWS
    // Note: The actual connected state depends on the WebSocket connection
    // and whether we've successfully joined the room
    this.connected.set(this.realtimeWS.isConnected());

    console.log(`[YJS-WS] WS connected: ${this.realtimeWS.isConnected()}`);

    if (this.realtimeWS.isConnected()) {
      this.onConnected?.();
    }
  }

  /**
   * Disconnect from memo room
   */
  disconnect(): void {
    this.realtimeWS.leaveMemo(this.pageId);
    this.connected.set(false);
    this.synced.set(false);
    this.onSynced?.(false);
  }

  /**
   * Handle incoming memo event
   */
  private handleEvent(event: MemoSSEEvent): void {
    console.log(`[YJS-WS] Received event: ${event.type}`, event);

    switch (event.type) {
      case 'ydoc-init':
        this.handleInit(event.data);
        break;
      case 'ydoc-update':
        this.handleRemoteUpdate(event.data);
        break;
      case 'awareness-update':
        this.handleRemoteAwarenessUpdate(event.data);
        break;
      case 'peer-join':
        this.onPeerJoin?.(event.data);
        break;
      case 'peer-leave':
        this.onPeerLeave?.(event.data.clientId);
        break;
      case 'ping':
        // Keepalive, no action needed
        break;
      case 'joined':
        // Join confirmation received - connection is ready
        console.log(`[YJS-WS] Joined room for ${this.pageId}`);
        break;
      default:
        console.log(`[YJS-WS] Unhandled event type: ${(event as any).type}`);
    }
  }

  /**
   * Handle initial document state from server
   */
  private handleInit(data: { state: string; version: number; peers: any[] }): void {
    console.log(
      `[YJS-WS] handleInit - state size: ${data.state?.length || 0}, version: ${data.version}, peers: ${data.peers?.length || 0}`,
    );

    try {
      const state = this.base64ToUint8Array(data.state);
      console.log(`[YJS-WS] Decoded state: ${state.length} bytes`);

      Y.applyUpdate(this.ydoc, state, 'remote');
      console.log(`[YJS-WS] Applied update to ydoc`);

      this.connected.set(true);
      this.synced.set(true);
      this.onConnected?.();
      this.onSynced?.(true);

      // Notify about existing peers
      for (const peer of data.peers || []) {
        this.onPeerJoin?.(peer);
      }

      // Send initial awareness state after sync
      this.sendInitialAwareness();

      // Send client's state diff to server (data the server doesn't have)
      // This ensures locally stored IndexedDB data is synced to the server
      const serverStateVector = Y.encodeStateVectorFromUpdate(state);
      const clientDiff = Y.encodeStateAsUpdate(this.ydoc, serverStateVector);
      if (clientDiff.length > 2) {
        // More than just header = we have data to send
        console.log(`[YJS-WS] Sending client state diff to server: ${clientDiff.length} bytes`);
        this.realtimeWS.sendMemoUpdate(this.pageId, clientDiff, this.pageType);
      }

      console.log(`[YJS-WS] Initial sync complete`);
    } catch (err) {
      console.error(`[YJS-WS] handleInit error:`, err);
      this.error.set('Failed to load document');
    }
  }

  /**
   * Send initial awareness state to other peers
   */
  private sendInitialAwareness(): void {
    if (!this.awareness) return;

    const localClientId = this.awareness.clientID;
    const update = encodeAwarenessUpdate(this.awareness, [localClientId]);
    this.realtimeWS.sendAwarenessUpdate(this.pageId, update);
  }

  /**
   * Handle remote document update
   */
  private handleRemoteUpdate(data: { update: string; from: string }): void {
    try {
      const update = this.base64ToUint8Array(data.update);
      Y.applyUpdate(this.ydoc, update, 'remote');
    } catch {
      // Failed to apply remote update
    }
  }

  /**
   * Handle local Y.Doc update
   */
  private handleLocalUpdate(update: Uint8Array, origin: any): void {
    // Don't send back remote updates
    if (origin === 'remote') return;

    // Only send if connected and synced
    if (!this.connected() || !this.synced()) {
      console.log(
        `[YJS-WS] Skipping update - connected: ${this.connected()}, synced: ${this.synced()}, pageId: ${this.pageId}`,
      );
      return;
    }

    // Send update via WebSocket with pageType for routing to correct backend service
    this.realtimeWS.sendMemoUpdate(this.pageId, update, this.pageType);
  }

  /**
   * Handle local awareness update (cursor moved, selection changed, etc.)
   */
  private handleLocalAwarenessUpdate(changedClients: number[]): void {
    if (!this.awareness || !this.connected() || !this.synced()) {
      return;
    }

    // Only send if local client changed
    const localClientId = this.awareness.clientID;
    if (!changedClients.includes(localClientId)) {
      return;
    }

    // Encode and send awareness update
    const update = encodeAwarenessUpdate(this.awareness, [localClientId]);
    this.realtimeWS.sendAwarenessUpdate(this.pageId, update);
  }

  /**
   * Handle remote awareness update from server
   */
  private handleRemoteAwarenessUpdate(data: { update: string; from: string }): void {
    if (!this.awareness) return;

    try {
      const update = this.base64ToUint8Array(data.update);
      applyAwarenessUpdate(this.awareness, update, 'remote');
    } catch {
      // Failed to apply awareness update
    }
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

    // Remove Y.Doc update listener
    this.ydoc.off('update', this.handleLocalUpdate.bind(this));

    // Remove awareness listener
    if (this.awareness && this.awarenessUpdateHandler) {
      this.awareness.off('update', this.awarenessUpdateHandler);
      this.awarenessUpdateHandler = null;
    }
  }
}
