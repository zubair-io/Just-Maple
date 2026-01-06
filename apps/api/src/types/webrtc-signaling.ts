/**
 * WebRTC Signaling Types
 * Data models for peer-to-peer connection signaling
 */

/**
 * Represents an active peer session for a document
 */
export interface SignalingSession {
    documentId: string;
    userId: string;
    peerId: string;
    createdAt: Date;
    lastSeenAt: Date;
}

/**
 * Signal message passed between peers during WebRTC negotiation
 */
export interface SignalMessage {
    from: string;
    to: string;
    type: 'offer' | 'answer' | 'ice-candidate';
    payload: any;
}

/**
 * Information about a peer in a document session
 */
export interface PeerInfo {
    peerId: string;
    userId: string;
    lastSeenAt: Date;
}
