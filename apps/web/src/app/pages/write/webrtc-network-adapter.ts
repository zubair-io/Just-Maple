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
 * Uses Server-Sent Events (SSE) for signaling
 */
export class WebRTCNetworkAdapter extends NetworkAdapter {
  // Note: peerId is inherited from NetworkAdapter base class
  private documentId: string;
  private userId: string;

  // WebRTC connections to other peers
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();

  // Signaling via SSE
  private http: HttpClient;
  private authService: AuthService;
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 2000; // 2 seconds
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
        // Start SSE connection for signals (replaces polling)
        this.startSSEConnection();

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
    // Stop SSE connection
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Stop heartbeat
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
    console.log('[WebRTC Adapter] Sending message to peers:', message);
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
      console.log('[WebRTC Adapter] Registering with signaling server...');
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

      console.log(
        `[WebRTC Adapter] Registered with ${response.peers.length} other peer(s)`,
        response.peers,
      );

      // Create connections to existing peers
      for (const peer of response.peers) {
        console.log(`[WebRTC Adapter] Creating offer for peer: ${peer.peerId}`);
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
   * Start SSE connection for real-time signal delivery
   */
  private startSSEConnection(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const token = this.authService.accessToken();

    // EventSource doesn't support custom headers, so pass token in query param
    const url = `${this.API_BASE}/stream/${this.peerId}?token=${token}`;

    console.log('[WebRTC Adapter] Opening SSE connection...');
    this.eventSource = new EventSource(url);

    // Handle incoming messages
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log('[WebRTC Adapter] SSE connected:', data.peerId);
          this.reconnectAttempts = 0; // Reset on successful connection
          return;
        }

        if (data.signals && Array.isArray(data.signals)) {
          // Process all signals
          for (const signal of data.signals) {
            this.handleIncomingSignal(signal);
          }
        }
      } catch (error) {
        console.error('[WebRTC Adapter] Failed to parse SSE message:', error);
      }
    };

    // Handle connection open
    this.eventSource.onopen = () => {
      console.log('[WebRTC Adapter] SSE connection established');
      this.reconnectAttempts = 0;
    };

    // Handle errors and reconnection
    this.eventSource.onerror = (error) => {
      console.error('[WebRTC Adapter] SSE error:', error);

      // Close the failed connection
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      // Attempt reconnection with exponential backoff
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        const delay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);

        console.log(
          `[WebRTC Adapter] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`,
        );

        setTimeout(() => {
          if (this._isReady) {
            // Only reconnect if adapter still active
            this.startSSEConnection();
          }
        }, delay);
      } else {
        console.error('[WebRTC Adapter] Max reconnection attempts reached');
        // Could emit an event here to notify WriteService
      }
    };
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
    console.log(`[WebRTC Adapter] Received signal: ${signal.type} from ${signal.from}`);

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
    console.log(`[WebRTC Adapter] Handling offer from ${remotePeerId}`);

    // Create peer connection if it doesn't exist
    let pc = this.peerConnections.get(remotePeerId);
    if (!pc) {
      pc = this.createPeerConnection(remotePeerId);
    }

    // Set remote description
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log(`[WebRTC Adapter] Set remote description (offer) for ${remotePeerId}`);

    // Process any queued ICE candidates
    await this.processPendingIceCandidates(remotePeerId);

    // Create and send answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.sendSignal(remotePeerId, 'answer', answer);
    console.log(`[WebRTC Adapter] Sent answer to ${remotePeerId}`);
  }

  /**
   * Handle incoming answer from a peer
   */
  private async handleAnswer(
    remotePeerId: string,
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    console.log(`[WebRTC Adapter] Handling answer from ${remotePeerId}`);

    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) {
      console.warn('[WebRTC Adapter] Received answer but no peer connection exists');
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log(`[WebRTC Adapter] Set remote description (answer) for ${remotePeerId}`);

    // Process any queued ICE candidates
    await this.processPendingIceCandidates(remotePeerId);
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

    // If remote description isn't set yet, queue the candidate
    if (!pc.remoteDescription) {
      console.log(
        `[WebRTC Adapter] Queueing ICE candidate for ${remotePeerId} (remote description not set yet)`,
      );
      if (!this.pendingIceCandidates.has(remotePeerId)) {
        this.pendingIceCandidates.set(remotePeerId, []);
      }
      this.pendingIceCandidates.get(remotePeerId)!.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log(`[WebRTC Adapter] Added ICE candidate for ${remotePeerId}`);
    } catch (error) {
      console.error(`[WebRTC Adapter] Failed to add ICE candidate for ${remotePeerId}:`, error);
    }
  }

  /**
   * Process any queued ICE candidates for a peer (after remote description is set)
   */
  private async processPendingIceCandidates(remotePeerId: string): Promise<void> {
    const pendingCandidates = this.pendingIceCandidates.get(remotePeerId);
    if (!pendingCandidates || pendingCandidates.length === 0) {
      return;
    }

    console.log(
      `[WebRTC Adapter] Processing ${pendingCandidates.length} queued ICE candidates for ${remotePeerId}`,
    );
    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) return;

    for (const candidate of pendingCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error(`[WebRTC Adapter] Failed to add queued ICE candidate:`, error);
      }
    }

    // Clear the queue
    this.pendingIceCandidates.delete(remotePeerId);
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
      //bundlePolicy: 'max-bundle',
      //rtcpMuxPolicy: 'require',
    });

    this.peerConnections.set(remotePeerId, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(
          `[WebRTC Adapter] Generated ICE candidate for ${remotePeerId}:`,
          event.candidate.type,
          event.candidate.candidate,
        );
        this.sendSignal(remotePeerId, 'ice-candidate', event.candidate.toJSON());
      } else {
        console.log(`[WebRTC Adapter] ICE gathering complete for ${remotePeerId}`);
      }
    };

    // Handle ICE gathering state
    pc.onicegatheringstatechange = () => {
      console.log(
        `[WebRTC Adapter] ICE gathering state for ${remotePeerId}: ${pc.iceGatheringState}`,
      );
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(
        `[WebRTC Adapter] Connection state changed for ${remotePeerId}: ${pc.connectionState}`,
      );

      if (pc.connectionState === 'connected') {
        console.log('[WebRTC Adapter] P2P connection established with', remotePeerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.warn('[WebRTC Adapter] Connection failed/disconnected with', remotePeerId);
        this.handlePeerDisconnect(remotePeerId);
      }
    };

    // Log ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(
        `[WebRTC Adapter] ICE connection state for ${remotePeerId}: ${pc.iceConnectionState}`,
      );
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
      console.log(`[WebRTC Adapter] Data channel opened with peer: ${remotePeerId}`);
      this.dataChannels.set(remotePeerId, dataChannel);

      // Notify Automerge Repo about the new peer
      this.emit('peer-candidate', {
        peerId: remotePeerId as PeerId,
        peerMetadata: {} as PeerMetadata,
      });
    };

    dataChannel.onmessage = (event) => {
      console.log(
        `[WebRTC Adapter] Received data channel message from ${remotePeerId}`,
        event.data.byteLength,
        'bytes',
      );
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
      console.log(`[WebRTC Adapter] Data channel closed with peer: ${remotePeerId}`);
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
