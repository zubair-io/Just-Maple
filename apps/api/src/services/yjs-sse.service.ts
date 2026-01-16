import type { SignalMessage, NotebookSSEEvent } from '@maple/shared';

/**
 * Connected client info
 */
interface ConnectedClient {
    controller: ReadableStreamDefaultController;
    oderId: string;
    userName: string;
    userColor: string;
    connectedAt: Date;
    lastPing: Date;
}

/**
 * YJS SSE Service
 * Manages Server-Sent Events connections for notebook collaboration
 * Handles Y.Doc updates and WebRTC signaling
 */
class YJSSSEService {
    // noteId -> clientId -> client info
    private rooms = new Map<string, Map<string, ConnectedClient>>();

    // Keepalive interval (15 seconds)
    private readonly KEEPALIVE_INTERVAL = 15000;

    // Stale connection timeout (60 seconds without ping response)
    private readonly STALE_TIMEOUT = 60000;

    private keepaliveInterval: Timer;

    constructor() {
        // Start keepalive pings
        this.keepaliveInterval = setInterval(() => {
            this.sendKeepalives();
        }, this.KEEPALIVE_INTERVAL);
    }

    /**
     * Register a new SSE connection for a notebook room
     */
    registerClient(
        noteId: string,
        clientId: string,
        controller: ReadableStreamDefaultController,
        userInfo: { userId: string; userName: string; userColor: string },
    ): void {
        // Get or create room
        if (!this.rooms.has(noteId)) {
            this.rooms.set(noteId, new Map());
        }

        const room = this.rooms.get(noteId)!;

        // Store client info
        room.set(clientId, {
            controller,
            oderId: userInfo.userId,
            userName: userInfo.userName,
            userColor: userInfo.userColor,
            connectedAt: new Date(),
            lastPing: new Date(),
        });

        console.log(
            `[YJS-SSE] Client ${clientId} joined room ${noteId} (${room.size} clients total)`,
        );

        // Notify other clients about new peer
        this.broadcastToPeers(
            noteId,
            {
                type: 'peer-join',
                data: {
                    clientId,
                    userId: userInfo.userId,
                    userName: userInfo.userName,
                    userColor: userInfo.userColor,
                },
                timestamp: new Date().toISOString(),
            },
            clientId,
        );
    }

    /**
     * Unregister a client from a room
     */
    unregisterClient(noteId: string, clientId: string): void {
        const room = this.rooms.get(noteId);
        if (!room) return;

        const client = room.get(clientId);
        if (client) {
            // Try to close the controller
            try {
                client.controller.close();
            } catch {}

            room.delete(clientId);

            console.log(
                `[YJS-SSE] Client ${clientId} left room ${noteId} (${room.size} clients remaining)`,
            );

            // Notify other clients about peer leaving
            this.broadcastToPeers(
                noteId,
                {
                    type: 'peer-leave',
                    data: { clientId },
                    timestamp: new Date().toISOString(),
                },
                clientId,
            );
        }

        // Clean up empty room
        if (room.size === 0) {
            this.rooms.delete(noteId);
            console.log(`[YJS-SSE] Room ${noteId} is now empty`);
        }
    }

    /**
     * Send initial document state to a newly connected client
     */
    sendInitialState(noteId: string, clientId: string, state: Uint8Array, version: number): void {
        const room = this.rooms.get(noteId);
        if (!room) return;

        const client = room.get(clientId);
        if (!client) return;

        // Send initial state as base64
        const event: NotebookSSEEvent = {
            type: 'ydoc-init',
            data: {
                state: Buffer.from(state).toString('base64'),
                version,
                peers: this.getRoomPeers(noteId, clientId),
            },
            timestamp: new Date().toISOString(),
        };

        this.sendToClient(client, event);
    }

    /**
     * Broadcast Y.Doc update to all clients except sender
     */
    broadcastUpdate(noteId: string, update: Uint8Array, excludeClientId: string): void {
        const event: NotebookSSEEvent = {
            type: 'ydoc-update',
            data: {
                update: Buffer.from(update).toString('base64'),
                from: excludeClientId,
            },
            timestamp: new Date().toISOString(),
        };

        this.broadcastToPeers(noteId, event, excludeClientId);
    }

    /**
     * Relay WebRTC signaling message
     */
    relaySignal(noteId: string, message: SignalMessage): void {
        const room = this.rooms.get(noteId);
        if (!room) return;

        const event: NotebookSSEEvent = {
            type: 'signal',
            data: message,
            timestamp: new Date().toISOString(),
        };

        if (message.to) {
            // Direct message to specific client
            const targetClient = room.get(message.to);
            if (targetClient) {
                this.sendToClient(targetClient, event);
            }
        } else {
            // Broadcast to all except sender
            this.broadcastToPeers(noteId, event, message.from);
        }
    }

    /**
     * Get list of peers in a room (excluding a specific client)
     */
    private getRoomPeers(
        noteId: string,
        excludeClientId: string,
    ): Array<{
        clientId: string;
        userId: string;
        userName: string;
        userColor: string;
    }> {
        const room = this.rooms.get(noteId);
        if (!room) return [];

        const peers: Array<{
            clientId: string;
            userId: string;
            userName: string;
            userColor: string;
        }> = [];

        for (const [clientId, client] of room) {
            if (clientId !== excludeClientId) {
                peers.push({
                    clientId,
                    userId: client.oderId,
                    userName: client.userName,
                    userColor: client.userColor,
                });
            }
        }

        return peers;
    }

    /**
     * Broadcast event to all peers except one
     */
    private broadcastToPeers(
        noteId: string,
        event: NotebookSSEEvent,
        excludeClientId: string,
    ): void {
        const room = this.rooms.get(noteId);
        if (!room) return;

        const failedClients: string[] = [];

        for (const [clientId, client] of room) {
            if (clientId !== excludeClientId) {
                const success = this.sendToClient(client, event);
                if (!success) {
                    failedClients.push(clientId);
                }
            }
        }

        // Clean up failed connections
        for (const clientId of failedClients) {
            this.unregisterClient(noteId, clientId);
        }
    }

    /**
     * Send event to a specific client
     */
    private sendToClient(client: ConnectedClient, event: NotebookSSEEvent): boolean {
        try {
            const data = JSON.stringify(event);
            const message = `data: ${data}\n\n`;
            client.controller.enqueue(new TextEncoder().encode(message));
            return true;
        } catch (error) {
            console.error(`[YJS-SSE] Failed to send to client:`, error);
            return false;
        }
    }

    /**
     * Send keepalive pings to all connections
     */
    private sendKeepalives(): void {
        const pingEvent: NotebookSSEEvent = {
            type: 'ping',
            data: {},
            timestamp: new Date().toISOString(),
        };

        for (const [noteId, room] of this.rooms) {
            const failedClients: string[] = [];

            for (const [clientId, client] of room) {
                const success = this.sendToClient(client, pingEvent);
                if (success) {
                    client.lastPing = new Date();
                } else {
                    failedClients.push(clientId);
                }
            }

            // Clean up failed connections
            for (const clientId of failedClients) {
                this.unregisterClient(noteId, clientId);
            }
        }
    }

    /**
     * Get number of clients in a room
     */
    getClientCount(noteId: string): number {
        return this.rooms.get(noteId)?.size ?? 0;
    }

    /**
     * Get all client IDs in a room
     */
    getClientIds(noteId: string): string[] {
        const room = this.rooms.get(noteId);
        if (!room) return [];
        return Array.from(room.keys());
    }

    /**
     * Check if a client is connected to a room
     */
    isClientConnected(noteId: string, clientId: string): boolean {
        return this.rooms.get(noteId)?.has(clientId) ?? false;
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalRooms: number;
        totalConnections: number;
        roomStats: Array<{ noteId: string; clients: number }>;
    } {
        let totalConnections = 0;
        const roomStats: Array<{ noteId: string; clients: number }> = [];

        for (const [noteId, room] of this.rooms) {
            totalConnections += room.size;
            roomStats.push({ noteId, clients: room.size });
        }

        return {
            totalRooms: this.rooms.size,
            totalConnections,
            roomStats,
        };
    }

    /**
     * Shutdown service
     */
    shutdown(): void {
        clearInterval(this.keepaliveInterval);

        // Close all connections
        for (const [noteId, room] of this.rooms) {
            for (const [clientId, client] of room) {
                try {
                    client.controller.close();
                } catch {}
            }
        }

        this.rooms.clear();
        console.log('[YJS-SSE] Service shutdown');
    }
}

export const yjsSSEService = new YJSSSEService();
