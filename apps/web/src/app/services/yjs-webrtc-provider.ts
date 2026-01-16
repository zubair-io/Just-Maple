import * as Y from 'yjs';
import { signal } from '@angular/core';
import type { SignalMessage } from '@maple/shared';
import { YJSSSEProvider } from './yjs-sse-provider';

// SimplePeer types (imported dynamically to avoid SSR issues)
type SimplePeerInstance = {
  signal: (data: any) => void;
  send: (data: Uint8Array) => void;
  destroy: () => void;
  connected: boolean;
  on: (event: string, callback: (...args: any[]) => void) => void;
};

type SimplePeerConstructor = new (opts?: {
  initiator?: boolean;
  trickle?: boolean;
}) => SimplePeerInstance;

/**
 * YJS WebRTC Provider
 * Enables P2P sync between clients via WebRTC
 * Uses SSE provider for signaling
 */
export class YJSWebRTCProvider {
  private peers = new Map<string, SimplePeerInstance>();
  private SimplePeer: SimplePeerConstructor | null = null;

  // Reactive state
  readonly peersConnected = signal(0);
  readonly peerIds = signal<string[]>([]);

  constructor(
    private readonly noteId: string,
    private readonly ydoc: Y.Doc,
    private readonly sseProvider: YJSSSEProvider,
  ) {
    // Setup signaling message handler
    this.sseProvider.onSignal = this.handleSignal.bind(this);

    // Listen for local Y.Doc changes to broadcast to peers
    this.ydoc.on('update', this.handleLocalUpdate.bind(this));

    // Load SimplePeer dynamically (for SSR compatibility)
    this.loadSimplePeer();
  }

  get clientId(): string {
    return this.sseProvider.clientId;
  }

  /**
   * Dynamically load SimplePeer (avoid SSR issues)
   */
  private async loadSimplePeer(): Promise<void> {
    try {
      const module = await import('simple-peer');
      this.SimplePeer = module.default || module;
    } catch (err) {
      console.warn('[YJS-WebRTC] SimplePeer not available:', err);
    }
  }

  /**
   * Announce presence to other peers
   */
  announcePresence(): void {
    this.sseProvider.sendSignal({
      type: 'announce',
      payload: { noteId: this.noteId },
    });
  }

  /**
   * Handle incoming signaling message
   */
  private handleSignal(message: SignalMessage): void {
    // Ignore our own messages
    if (message.from === this.clientId) return;

    switch (message.type) {
      case 'announce':
        // New peer announced - initiate connection
        this.initiateConnection(message.from);
        break;
      case 'offer':
        // Received offer - respond with answer
        this.handleOffer(message);
        break;
      case 'answer':
        // Received answer - complete connection
        this.handleAnswer(message);
        break;
      case 'ice-candidate':
        // Received ICE candidate
        this.handleIceCandidate(message);
        break;
      case 'leave':
        // Peer left
        this.removePeer(message.from);
        break;
    }
  }

  /**
   * Initiate WebRTC connection to a peer
   */
  private initiateConnection(peerId: string): void {
    if (!this.SimplePeer || this.peers.has(peerId)) return;

    console.log(`[YJS-WebRTC] Initiating connection to ${peerId}`);

    const peer = new this.SimplePeer({
      initiator: true,
      trickle: true,
    });

    this.setupPeer(peerId, peer);
  }

  /**
   * Handle incoming WebRTC offer
   */
  private handleOffer(message: SignalMessage): void {
    if (!this.SimplePeer) return;

    const peerId = message.from;

    // If we already have a connection, ignore
    if (this.peers.has(peerId)) {
      const existingPeer = this.peers.get(peerId)!;
      if (existingPeer.connected) return;
    }

    console.log(`[YJS-WebRTC] Received offer from ${peerId}`);

    const peer = new this.SimplePeer({
      initiator: false,
      trickle: true,
    });

    this.setupPeer(peerId, peer);
    peer.signal(message.payload);
  }

  /**
   * Handle incoming WebRTC answer
   */
  private handleAnswer(message: SignalMessage): void {
    const peer = this.peers.get(message.from);
    if (peer) {
      peer.signal(message.payload);
    }
  }

  /**
   * Handle incoming ICE candidate
   */
  private handleIceCandidate(message: SignalMessage): void {
    const peer = this.peers.get(message.from);
    if (peer) {
      peer.signal(message.payload);
    }
  }

  /**
   * Setup peer event handlers
   */
  private setupPeer(peerId: string, peer: SimplePeerInstance): void {
    // Signal events (for WebRTC negotiation)
    peer.on('signal', (data: any) => {
      const type =
        data.type === 'offer' ? 'offer' : data.type === 'answer' ? 'answer' : 'ice-candidate';
      this.sseProvider.sendSignal({
        type: type as any,
        to: peerId,
        payload: data,
      });
    });

    // Connection established
    peer.on('connect', () => {
      console.log(`[YJS-WebRTC] Connected to ${peerId}`);
      this.peers.set(peerId, peer);
      this.updatePeerState();

      // Send current document state to new peer
      const state = Y.encodeStateAsUpdate(this.ydoc);
      peer.send(state);
    });

    // Data received from peer
    peer.on('data', (data: Uint8Array) => {
      try {
        Y.applyUpdate(this.ydoc, new Uint8Array(data), 'remote');
      } catch (err) {
        console.error('[YJS-WebRTC] Failed to apply peer update:', err);
      }
    });

    // Connection closed
    peer.on('close', () => {
      console.log(`[YJS-WebRTC] Connection closed with ${peerId}`);
      this.removePeer(peerId);
    });

    // Error
    peer.on('error', (err: Error) => {
      console.error(`[YJS-WebRTC] Error with peer ${peerId}:`, err);
      this.removePeer(peerId);
    });

    // Store peer (even before connected, for signal routing)
    this.peers.set(peerId, peer);
  }

  /**
   * Remove peer connection
   */
  private removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        peer.destroy();
      } catch {}
      this.peers.delete(peerId);
      this.updatePeerState();
    }
  }

  /**
   * Update peer state signals
   */
  private updatePeerState(): void {
    const connectedPeers = Array.from(this.peers.entries())
      .filter(([_, peer]) => peer.connected)
      .map(([id]) => id);

    this.peersConnected.set(connectedPeers.length);
    this.peerIds.set(connectedPeers);
  }

  /**
   * Handle local Y.Doc update - broadcast to all connected peers
   */
  private handleLocalUpdate(update: Uint8Array, origin: any): void {
    // Don't echo back remote updates
    if (origin === 'remote') return;

    // Send to all connected peers
    for (const [peerId, peer] of this.peers) {
      if (peer.connected) {
        try {
          peer.send(update);
        } catch (err) {
          console.error(`[YJS-WebRTC] Failed to send to ${peerId}:`, err);
        }
      }
    }
  }

  /**
   * Destroy provider and all connections
   */
  destroy(): void {
    // Announce leave
    this.sseProvider.sendSignal({
      type: 'leave',
      payload: {},
    });

    // Destroy all peer connections
    for (const [peerId, peer] of this.peers) {
      try {
        peer.destroy();
      } catch {}
    }
    this.peers.clear();
    this.updatePeerState();

    // Remove Y.Doc listener
    this.ydoc.off('update', this.handleLocalUpdate.bind(this));
  }
}
