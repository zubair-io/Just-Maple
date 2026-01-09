import { Elysia } from 'elysia';
import { Repo, NetworkAdapter, type PeerId, type PeerMetadata } from '@automerge/automerge-repo';
import { cbor } from '@automerge/automerge-repo/slim';
import { jwtPlugin } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNoteByDocumentId } from '../repositories/note.repo';
import { authenticateWebSocket } from './ws-auth';
import { MongoDBAutomergeStorageAdapter } from '../storage/mongodb-automerge-storage.adapter';

const { encode, decode } = cbor;

/**
 * Bun-compatible Network Adapter for Automerge Repo
 * Bridges Elysia WebSocket with Automerge Repo
 */
class ElysiaNetworkAdapter extends NetworkAdapter {
    sockets: Map<PeerId, any> = new Map();
    #ready = false;
    #readyResolver?: () => void;
    #readyPromise: Promise<void> = new Promise<void>((resolve) => {
        this.#readyResolver = resolve;
    });

    isReady() {
        return this.#ready;
    }

    whenReady() {
        return this.#readyPromise;
    }

    connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
        this.peerId = peerId;
        this.peerMetadata = peerMetadata;
        this.#ready = true;
        this.#readyResolver?.();
    }

    disconnect() {
        this.sockets.forEach((socket) => {
            try {
                socket.close();
            } catch (e) {
                // Ignore
            }
        });
        this.sockets.clear();
    }

    send(message: any) {
        if (!('targetId' in message)) return;

        const socket = this.sockets.get(message.targetId);
        if (!socket) {
            console.log(`[Automerge] No socket found for peer ${message.targetId}`);
            return;
        }

        try {
            const encoded = encode(message);
            socket.send(encoded);
        } catch (error) {
            console.error('[Automerge] Failed to send message:', error);
        }
    }

    addSocket(peerId: PeerId, socket: any, peerMetadata?: PeerMetadata) {
        this.sockets.set(peerId, socket);
        this.emit('peer-candidate', { peerId, peerMetadata: peerMetadata || {} });
    }

    removeSocket(peerId: PeerId) {
        this.sockets.delete(peerId);
        this.emit('peer-disconnected', { peerId });
    }

    handleMessage(message: any) {
        this.emit('message', message);
    }
}

// Create network adapter
const networkAdapter = new ElysiaNetworkAdapter();

// Repo and storage - initialized after database connection
let repo: Repo;
let storage: MongoDBAutomergeStorageAdapter;

/**
 * Initialize Automerge Repo with MongoDB storage
 * Must be called after database connection is established
 */
export function initializeAutomergeRepo() {
    // Create MongoDB storage adapter (requires DB connection)
    storage = new MongoDBAutomergeStorageAdapter();

    // Create Automerge repository with MongoDB persistence
    repo = new Repo({
        network: [networkAdapter],
        storage, // MongoDB persistence - prevents data loss on server restart
        peerId: 'just-maple-server' as PeerId,
        sharePolicy: async () => false, // Only sync documents clients request
    });

    networkAdapter.connect('just-maple-server' as PeerId, { isServer: true });

    console.log('[Automerge Repo] Repository created with MongoDB persistence');
}

// Track peer IDs to client IDs
const peerIdToClientId = new Map<string, string>();
const clientIdToPeerId = new Map<string, string>();

export const automergeSyncWs = new Elysia().use(jwtPlugin).ws('/ws/automerge-sync', {
    async open(ws) {
        // Try Sec-WebSocket-Protocol header first (secure method)
        const protocol = ws.data.request?.headers.get('sec-websocket-protocol');
        let token: string | null = null;

        if (protocol) {
            // Extract token from protocol header: "automerge-v1.${token}"
            const parts = protocol.split('.');
            if (parts.length >= 2 && parts[0] === 'automerge-v1') {
                token = parts.slice(1).join('.'); // Rejoin in case token contains dots
            }
        }

        // Fall back to query parameter (backwards compatibility, but log warning)
        if (!token) {
            const url = new URL(ws.data.request?.url || '', 'http://localhost');
            token = url.searchParams.get('token');
            if (token) {
                console.warn(
                    '[Automerge] JWT in query parameter - this is deprecated, use Sec-WebSocket-Protocol header',
                );
            }
        }

        let auth;
        if (token) {
            try {
                const payload = await ws.data.jwt.verify(token);
                if (!payload || !payload.sub) {
                    ws.close(1008, 'Invalid token');
                    return;
                }
                const user = await findUserById(payload.sub);
                if (!user) {
                    ws.close(1008, 'User not found');
                    return;
                }
                auth = { userId: user._id, email: user.email };
            } catch (error) {
                console.error('[Automerge] Token verification failed:', error);
                ws.close(1008, 'Authentication failed');
                return;
            }
        } else {
            auth = await authenticateWebSocket(ws);
            if (!auth) {
                return;
            }
        }

        const clientId = Math.random().toString(36).substring(7);
        ws.data.clientId = clientId;
        ws.data.userId = auth.userId;

        // Initialize rate limiting and message size tracking
        ws.data.messageCount = 0;
        ws.data.rateLimitReset = Date.now() + 60000; // 1 minute window
        ws.data.maxMessageSize = 5 * 1024 * 1024; // 5MB max per message

        console.log(`[Automerge] Client ${clientId} connected (user: ${auth.email})`);
    },

    async message(ws, messageBytes) {
        try {
            // MESSAGE SIZE LIMIT: Reject oversized messages
            const messageSize =
                messageBytes instanceof ArrayBuffer
                    ? messageBytes.byteLength
                    : messageBytes instanceof Buffer
                      ? messageBytes.byteLength
                      : messageBytes.byteLength;

            if (messageSize > ws.data.maxMessageSize) {
                console.warn(
                    `[Automerge] Message size ${messageSize} exceeds limit ${ws.data.maxMessageSize}`,
                );
                ws.close(1009, 'Message too large');
                return;
            }

            // RATE LIMITING: Check message rate
            const now = Date.now();

            // Reset counter if window expired
            if (now > ws.data.rateLimitReset) {
                ws.data.messageCount = 0;
                ws.data.rateLimitReset = now + 60000; // Next 1-minute window
            }

            // Increment and check limit
            ws.data.messageCount++;
            if (ws.data.messageCount > 100) {
                console.warn(
                    `[Automerge] Client ${ws.data.clientId} exceeded rate limit (${ws.data.messageCount} messages/min)`,
                );
                ws.close(1008, 'Rate limit exceeded');
                return;
            }

            // Convert to Uint8Array
            const bytes =
                messageBytes instanceof ArrayBuffer
                    ? new Uint8Array(messageBytes)
                    : messageBytes instanceof Buffer
                      ? new Uint8Array(messageBytes)
                      : messageBytes;

            // Decode CBOR message
            const message = decode(bytes as Uint8Array);
            const { type, senderId } = message;

            console.log(`[Automerge] Received ${type} from ${senderId}`);

            // Handle join message - this can arrive before open() completes
            if (type === 'join') {
                const { peerMetadata } = message;
                const peerId = senderId as PeerId;

                // Get or create clientId (may not be set yet if join arrives during open())
                let clientId = ws.data.clientId;
                if (!clientId) {
                    // Use peerId as clientId if open() hasn't completed yet
                    clientId = peerId;
                    ws.data.clientId = clientId;
                }

                // Map peer ID to client ID
                peerIdToClientId.set(peerId, clientId);
                clientIdToPeerId.set(clientId, peerId);

                // Add socket to network adapter
                networkAdapter.addSocket(peerId, ws, peerMetadata);

                // Send peer response
                const response = {
                    type: 'peer',
                    senderId: repo.peerId,
                    peerMetadata: { isServer: true },
                    selectedProtocolVersion: 1,
                    targetId: senderId,
                };

                try {
                    ws.send(encode(response));
                } catch (error) {
                    console.error('[Automerge] Failed to send peer response:', error);
                }
            } else {
                // ACCESS CONTROL: Verify user has access to document before syncing
                const documentId = message.documentId;

                if (documentId && (type === 'sync' || type === 'request')) {
                    // Extract automerge document ID (format: "automerge:base58id")
                    const docId = documentId.replace('automerge:', '');
                    const userId = ws.data.userId;

                    if (!userId) {
                        console.error('[Automerge] No userId found for access control');
                        try {
                            ws.send(
                                encode({
                                    type: 'error',
                                    error: 'Authentication required',
                                    code: 'UNAUTHORIZED',
                                    targetId: senderId,
                                }),
                            );
                        } catch (e) {
                            console.error('[Automerge] Failed to send error:', e);
                        }
                        return;
                    }

                    // Verify access using existing tag-based permissions
                    const hasAccess = await findNoteByDocumentId(docId, userId);

                    if (!hasAccess) {
                        console.warn(
                            `[Automerge] Access denied: user ${userId} attempted to access document ${docId}`,
                        );
                        try {
                            ws.send(
                                encode({
                                    type: 'error',
                                    error: 'Access denied',
                                    code: 'FORBIDDEN',
                                    targetId: senderId,
                                }),
                            );
                        } catch (e) {
                            console.error('[Automerge] Failed to send error:', e);
                        }
                        return;
                    }

                    console.log(
                        `[Automerge] Access granted: user ${userId} can access document ${docId}`,
                    );
                }

                // Forward other messages to the repo
                networkAdapter.handleMessage(message);
            }
        } catch (error) {
            console.error('[Automerge] Error processing message:', error);
        }
    },

    close(ws) {
        const clientId = ws.data.clientId;
        if (clientId) {
            const peerId = clientIdToPeerId.get(clientId);
            if (peerId) {
                networkAdapter.removeSocket(peerId as PeerId);
                peerIdToClientId.delete(peerId);
                clientIdToPeerId.delete(clientId);
            }
            console.log(`[Automerge] Client ${clientId} disconnected`);
        }
    },
});

// Export empty function for compatibility
export function attachAutomergeWebSocket(_server: any) {
    // Not needed for Elysia approach
}
