import type { SignalingSession, SignalMessage, PeerInfo } from '../types/webrtc-signaling';

/**
 * WebRTC Signaling Service
 * Manages peer registration, signal routing, and cleanup for WebRTC connections
 */
export class WebRTCSignalingService {
    // Document ID -> Map of Peer ID -> Session
    private sessions = new Map<string, Map<string, SignalingSession>>();

    // Peer ID -> Queue of pending signals
    private signalQueue = new Map<string, SignalMessage[]>();

    // Peer ID -> SSE stream controller
    private sseConnections = new Map<string, ReadableStreamDefaultController>();

    // Cleanup interval (30 seconds)
    private readonly STALE_PEER_TIMEOUT = 30000;
    private cleanupInterval: Timer;

    constructor() {
        // Start automatic cleanup of stale peers
        this.cleanupInterval = setInterval(() => {
            this.cleanupStalePeers();
        }, 10000); // Check every 10 seconds
    }

    /**
     * Register a peer for a document
     */
    registerPeer(documentId: string, peerId: string, userId: string): void {
        // Get or create document session map
        let documentSessions = this.sessions.get(documentId);
        if (!documentSessions) {
            documentSessions = new Map();
            this.sessions.set(documentId, documentSessions);
        }

        // Create or update session
        const now = new Date();
        const session: SignalingSession = {
            documentId,
            userId,
            peerId,
            createdAt: documentSessions.has(peerId) ? documentSessions.get(peerId)!.createdAt : now,
            lastSeenAt: now,
        };

        documentSessions.set(peerId, session);

        // Initialize signal queue if needed
        if (!this.signalQueue.has(peerId)) {
            this.signalQueue.set(peerId, []);
        }

        console.log(
            `[WebRTC Signaling] Peer registered: ${peerId} for document ${documentId} (user: ${userId})`,
        );
    }

    /**
     * Unregister a peer from a document
     */
    unregisterPeer(documentId: string, peerId: string): void {
        const documentSessions = this.sessions.get(documentId);
        if (!documentSessions) return;

        documentSessions.delete(peerId);

        // Clean up empty document sessions
        if (documentSessions.size === 0) {
            this.sessions.delete(documentId);
        }

        // Clean up signal queue
        this.signalQueue.delete(peerId);

        // Close SSE connection if exists
        this.unregisterSSEConnection(peerId);

        console.log(`[WebRTC Signaling] Peer unregistered: ${peerId} from document ${documentId}`);
    }

    /**
     * Get all peers for a document
     */
    getPeersForDocument(documentId: string): PeerInfo[] {
        const documentSessions = this.sessions.get(documentId);
        if (!documentSessions) return [];

        return Array.from(documentSessions.values()).map((session) => ({
            peerId: session.peerId,
            userId: session.userId,
            lastSeenAt: session.lastSeenAt,
        }));
    }

    /**
     * Queue a signal message for a peer
     * If peer has an active SSE connection, push immediately
     */
    queueSignal(message: SignalMessage): void {
        const { to } = message;

        // Get or create queue for target peer
        if (!this.signalQueue.has(to)) {
            console.warn(`[WebRTC Signaling] Cannot queue signal - peer not found: ${to}`);
            return;
        }

        const queue = this.signalQueue.get(to)!;
        queue.push(message);

        // If peer has active SSE connection, push signal immediately
        const controller = this.sseConnections.get(to);
        if (controller) {
            try {
                // Format as SSE message
                const data = JSON.stringify({ signals: [message] });
                const sseMessage = `data: ${data}\n\n`;

                controller.enqueue(new TextEncoder().encode(sseMessage));

                // Clear the queue since we just delivered it
                this.signalQueue.set(to, []);

                console.log(
                    `[WebRTC SSE] Signal pushed via SSE: ${message.type} from ${message.from} to ${to}`,
                );
            } catch (error) {
                console.error(`[WebRTC SSE] Failed to push signal to ${to}:`, error);
                // Leave in queue for polling fallback
            }
        } else {
            console.log(
                `[WebRTC Signaling] Signal queued: ${message.type} from ${message.from} to ${to}`,
            );
        }
    }

    /**
     * Poll for pending signals for a peer
     * Returns all queued signals and clears the queue
     */
    pollSignals(peerId: string): SignalMessage[] {
        const queue = this.signalQueue.get(peerId);
        if (!queue || queue.length === 0) {
            return [];
        }

        // Return all signals and clear queue
        const signals = [...queue];
        this.signalQueue.set(peerId, []);

        console.log(`[WebRTC Signaling] Peer ${peerId} polled ${signals.length} signal(s)`);
        return signals;
    }

    /**
     * Update last-seen timestamp for a peer (heartbeat)
     */
    updateHeartbeat(documentId: string, peerId: string): boolean {
        const documentSessions = this.sessions.get(documentId);
        if (!documentSessions) return false;

        const session = documentSessions.get(peerId);
        if (!session) return false;

        session.lastSeenAt = new Date();
        return true;
    }

    /**
     * Register an SSE connection for a peer
     */
    registerSSEConnection(peerId: string, controller: ReadableStreamDefaultController): void {
        // Close existing connection if any
        const existing = this.sseConnections.get(peerId);
        if (existing) {
            try {
                existing.close();
            } catch {}
        }

        this.sseConnections.set(peerId, controller);
        console.log(`[WebRTC SSE] Registered SSE connection for peer: ${peerId}`);
    }

    /**
     * Unregister SSE connection for a peer
     */
    unregisterSSEConnection(peerId: string): void {
        const controller = this.sseConnections.get(peerId);
        if (controller) {
            try {
                controller.close();
            } catch {}
            this.sseConnections.delete(peerId);
            console.log(`[WebRTC SSE] Unregistered SSE connection for peer: ${peerId}`);
        }
    }

    /**
     * Clean up peers that haven't sent a heartbeat in > 30 seconds
     */
    cleanupStalePeers(): void {
        const now = Date.now();
        let cleanupCount = 0;

        for (const [documentId, documentSessions] of this.sessions.entries()) {
            const stalePeers: string[] = [];

            for (const [peerId, session] of documentSessions.entries()) {
                const timeSinceLastSeen = now - session.lastSeenAt.getTime();
                if (timeSinceLastSeen > this.STALE_PEER_TIMEOUT) {
                    stalePeers.push(peerId);
                }
            }

            // Remove stale peers
            for (const peerId of stalePeers) {
                // Close SSE connection if exists
                this.unregisterSSEConnection(peerId);

                // Unregister peer from session
                this.unregisterPeer(documentId, peerId);
                cleanupCount++;
            }
        }

        if (cleanupCount > 0) {
            console.log(`[WebRTC Signaling] Cleaned up ${cleanupCount} stale peer(s)`);
        }
    }

    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    shutdown(): void {
        clearInterval(this.cleanupInterval);
        console.log('[WebRTC Signaling] Service shutdown');
    }

    /**
     * Get statistics about active sessions
     */
    getStats(): {
        totalDocuments: number;
        totalPeers: number;
        totalQueuedSignals: number;
    } {
        let totalPeers = 0;
        let totalQueuedSignals = 0;

        for (const documentSessions of this.sessions.values()) {
            totalPeers += documentSessions.size;
        }

        for (const queue of this.signalQueue.values()) {
            totalQueuedSignals += queue.length;
        }

        return {
            totalDocuments: this.sessions.size,
            totalPeers,
            totalQueuedSignals,
        };
    }
}

// Singleton instance
export const webrtcSignalingService = new WebRTCSignalingService();
