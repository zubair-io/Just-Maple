import {
  NetworkAdapter,
  type PeerId,
  type Message,
  type PeerMetadata,
} from '@automerge/automerge-repo/slim';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { DEFAULT_ICE_SERVERS } from '../../config/ice-servers';
import { firstValueFrom } from 'rxjs';

// ============================================================
// WebRTC Network Adapter (P2P)
// ============================================================

interface SignalMessage {
  from: string;
  to: string;
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: any;
}

interface PeerInfo {
  peerId: string;
  userId: string;
  lastSeenAt: Date;
}

/**
 * WebRTC Network Adapter for Automerge
 * Enables peer-to-peer collaboration using WebRTC DataChannels
 * Uses HTTP polling for signaling instead of WebSocket
 */
export class WebRTCNetworkAdapter extends NetworkAdapter {
  // Note: peerId is inherited from NetworkAdapter base class
  private documentId: string;
  private userId: string;

  // WebRTC connections to other peers
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();

  // Signaling via HTTP
  private http: HttpClient;
  private authService: AuthService;
  private pollingActive = false;
  private heartbeatInterval: any;

  // Connection state
  private _isReady = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  // ICE servers (STUN + TURN)
  private iceServers: RTCIceServer[];

  // Configuration
  private readonly HEARTBEAT_INTERVAL = 15000; // Heartbeat every 15 seconds
  private readonly API_BASE = '/api/webrtc'; // Use relative URL for dev server proxy

  constructor(
    documentId: string,
    userId: string,
    http: HttpClient,
    authService: AuthService,
    iceServers?: RTCIceServer[],
  ) {
    super();
    this.documentId = documentId;
    this.userId = userId;
    this.http = http;
    this.authService = authService;
    this.iceServers = iceServers || DEFAULT_ICE_SERVERS;

    // Create ready promise
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Connect to the signaling server and establish P2P connections
   */
  connect(peerId: PeerId): void {
    this.peerId = peerId;

    // Register with signaling server and discover peers
    this.registerWithSignalingServer()
      .then(() => {
        // Start polling for signals
        this.startSignalPolling();

        // Start heartbeat to keep session alive
        this.startHeartbeat();

        // Mark as ready
        this._isReady = true;
        this.resolveReady();
      })
      .catch((error) => {
        console.error('[WebRTC Adapter] Failed to connect:', error);
      });
  }

  /**
   * Disconnect from all peers and clean up
   */
  disconnect(): void {
    // Stop polling and heartbeat
    this.pollingActive = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all peer connections
    for (const [peerId, connection] of this.peerConnections.entries()) {
      connection.close();
    }
    this.peerConnections.clear();
    this.dataChannels.clear();

    // Unregister from signaling server
    this.unregisterFromSignalingServer().catch((error) => {
      console.error('[WebRTC Adapter] Failed to unregister:', error);
    });

    this._isReady = false;
  }

  /**
   * Send a message to all connected peers
   */
  send(message: Message): void {
    const openChannels = Array.from(this.dataChannels.values()).filter(
      (dc) => dc.readyState === 'open',
    );

    if (openChannels.length === 0) {
      console.warn('[WebRTC Adapter] No open data channels, message not sent');
      // TODO: Implement HTTP fallback here
      return;
    }

    // Send via all open channels
    if (!message.data) {
      console.warn('[WebRTC Adapter] Message has no data');
      return;
    }

    const messageData =
      message.data instanceof Uint8Array
        ? message.data
        : new Uint8Array(message.data as ArrayBuffer);
    openChannels.forEach((dc) => {
      try {
        // Cast to any to bypass strict TypeScript checking - at runtime, RTCDataChannel accepts Uint8Array
        dc.send(messageData as any);
      } catch (error) {
        console.error('[WebRTC Adapter] Failed to send via data channel:', error);
      }
    });
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
   * Register with signaling server and discover existing peers
   */
  private async registerWithSignalingServer(): Promise<void> {
    try {
      const token = this.authService.accessToken();
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; peers: PeerInfo[] }>(
          `${this.API_BASE}/register`,
          {
            documentId: this.documentId,
            peerId: this.peerId,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        ),
      );

      // Create connections to existing peers
      for (const peer of response.peers) {
        await this.createOfferForPeer(peer.peerId);
      }
    } catch (error) {
      console.error('[WebRTC Adapter] Registration failed:', error);
      throw error;
    }
  }

  /**
   * Unregister from signaling server
   */
  private async unregisterFromSignalingServer(): Promise<void> {
    try {
      const token = this.authService.accessToken();
      await firstValueFrom(
        this.http.post(
          `${this.API_BASE}/unregister`,
          {
            documentId: this.documentId,
            peerId: this.peerId,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        ),
      );
    } catch (error) {
      console.error('[WebRTC Adapter] Unregistration failed:', error);
    }
  }

  /**
   * Start polling for signals from the signaling server
   * Uses continuous long-polling (not setInterval) to avoid request buildup
   */
  private startSignalPolling(): void {
    this.pollingActive = true;

    const poll = async () => {
      // Exit if polling was stopped
      if (!this.pollingActive) return;

      try {
        const token = this.authService.accessToken();
        const response = await firstValueFrom(
          this.http.get<{ signals: SignalMessage[] }>(
            `${this.API_BASE}/poll/${this.peerId}?timeout=15000`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          ),
        );

        // Process incoming signals
        for (const signal of response.signals) {
          await this.handleIncomingSignal(signal);
        }
      } catch (error) {
        console.error('[WebRTC Adapter] Polling error:', error);
      }

      // Continue polling if still active
      if (this.pollingActive) {
        poll();
      }
    };

    // Start the continuous polling loop
    poll();
  }

  /**
   * Start heartbeat to keep session alive
   */
  private startHeartbeat(): void {
    const sendHeartbeat = async () => {
      try {
        const token = this.authService.accessToken();
        await firstValueFrom(
          this.http.post<{ success: boolean; peers: PeerInfo[] }>(
            `${this.API_BASE}/heartbeat`,
            {
              documentId: this.documentId,
              peerId: this.peerId,
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          ),
        );
      } catch (error) {
        console.error('[WebRTC Adapter] Heartbeat error:', error);
      }
    };

    this.heartbeatInterval = setInterval(sendHeartbeat, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Handle incoming signal from another peer
   */
  private async handleIncomingSignal(signal: SignalMessage): Promise<void> {
    switch (signal.type) {
      case 'offer':
        await this.handleOffer(signal.from, signal.payload);
        break;
      case 'answer':
        await this.handleAnswer(signal.from, signal.payload);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(signal.from, signal.payload);
        break;
    }
  }

  /**
   * Handle incoming offer from a peer
   */
  private async handleOffer(remotePeerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    // Create peer connection if it doesn't exist
    let pc = this.peerConnections.get(remotePeerId);
    if (!pc) {
      pc = this.createPeerConnection(remotePeerId);
    }

    // Set remote description
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Create and send answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.sendSignal(remotePeerId, 'answer', answer);
  }

  /**
   * Handle incoming answer from a peer
   */
  private async handleAnswer(
    remotePeerId: string,
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) {
      console.warn('[WebRTC Adapter] Received answer but no peer connection exists');
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Handle incoming ICE candidate from a peer
   */
  private async handleIceCandidate(
    remotePeerId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) {
      console.warn('[WebRTC Adapter] Received ICE candidate but no peer connection exists');
      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * Create an offer for a peer (initiator)
   */
  private async createOfferForPeer(remotePeerId: string): Promise<void> {
    const pc = this.createPeerConnection(remotePeerId);

    // Create data channel (as initiator)
    const dataChannel = pc.createDataChannel('automerge-sync', {
      ordered: true,
    });
    this.setupDataChannel(dataChannel, remotePeerId);

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.sendSignal(remotePeerId, 'offer', offer);
  }

  /**
   * Create an RTCPeerConnection for a remote peer
   */
  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
      // Disable mDNS candidates for better localhost testing
      // This forces the browser to use IP addresses instead of .local addresses
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    this.peerConnections.set(remotePeerId, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(remotePeerId, 'ice-candidate', event.candidate.toJSON());
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        console.log('[WebRTC Adapter] P2P connection established with', remotePeerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.warn('[WebRTC Adapter] Connection failed/disconnected with', remotePeerId);
        this.handlePeerDisconnect(remotePeerId);
      }
    };

    // Handle incoming data channel (as responder)
    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, remotePeerId);
    };

    return pc;
  }

  /**
   * Set up a data channel for Automerge sync
   */
  private setupDataChannel(dataChannel: RTCDataChannel, remotePeerId: string): void {
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
      this.dataChannels.set(remotePeerId, dataChannel);

      // Notify Automerge Repo about the new peer
      this.emit('peer-candidate', {
        peerId: remotePeerId as PeerId,
        peerMetadata: {} as PeerMetadata,
      });
    };

    dataChannel.onmessage = (event) => {
      const data = new Uint8Array(event.data);

      // Emit message to Automerge Repo with documentId
      this.emit('message', {
        type: 'sync',
        senderId: remotePeerId as PeerId,
        targetId: this.peerId!,
        data,
        documentId: this.documentId,
      } as any);
    };

    dataChannel.onclose = () => {
      this.dataChannels.delete(remotePeerId);

      // Notify Automerge Repo about peer disconnect
      this.emit('peer-disconnected', {
        peerId: remotePeerId as PeerId,
      });
    };

    dataChannel.onerror = (error) => {
      console.error('[WebRTC Adapter] Data channel error with', remotePeerId, error);
    };
  }

  /**
   * Send a signal to another peer via the signaling server
   */
  private async sendSignal(to: string, type: SignalMessage['type'], payload: any): Promise<void> {
    try {
      const token = this.authService.accessToken();
      await firstValueFrom(
        this.http.post(
          `${this.API_BASE}/signal`,
          {
            from: this.peerId,
            to,
            type,
            payload,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        ),
      );
    } catch (error) {
      console.error('[WebRTC Adapter] Failed to send signal:', error);
    }
  }

  /**
   * Handle peer disconnection
   */
  private handlePeerDisconnect(remotePeerId: string): void {
    // Close and remove connection
    const pc = this.peerConnections.get(remotePeerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(remotePeerId);
    }

    // Remove data channel
    this.dataChannels.delete(remotePeerId);

    // Notify Automerge Repo
    this.emit('peer-disconnected', {
      peerId: remotePeerId as PeerId,
    });

    // Check if all peers are disconnected
    if (this.peerConnections.size === 0 && this.dataChannels.size === 0) {
      console.warn('[WebRTC Adapter] All peers disconnected - no P2P connections remain');
      // Emit custom event that can be listened to
      this.emit('all-peers-disconnected' as any, {});
    }
  }

  /**
   * Get count of active peer connections
   */
  getActivePeerCount(): number {
    return Array.from(this.dataChannels.values()).filter((dc) => dc.readyState === 'open').length;
  }
}
