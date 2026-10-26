import type {
    Page,
    Notebook,
    Collectable,
    DeviceDataFilter,
    MemoSSEEvent,
    Recording,
} from '@maple/shared';
import { redisPubSub } from './redis.service';

/**
 * App Events - CRUD operations on pages, notebooks, collectables
 */
export type AppEvent =
    | { type: 'page.created'; page: Page; notebookId?: string }
    | {
          type: 'page.updated';
          pageId: string;
          title?: string;
          updatedAt: string;
          notebookId?: string;
          /** Data pages: what the page shares (null: no filter) and what it's for. */
          deviceFilter?: DeviceDataFilter | null;
          description?: string;
      }
    | {
          type: 'page.moved';
          pageId: string;
          previousNotebookId: string;
          newNotebookId: string;
          updatedAt: string;
      }
    | { type: 'page.deleted'; pageId: string; notebookId?: string }
    | { type: 'page.trashed'; pageId: string; notebookId?: string }
    | { type: 'page.restored'; page: Page; notebookId?: string }
    | { type: 'notebook.created'; notebook: Notebook }
    | { type: 'notebook.updated'; notebookId: string; label?: string }
    | { type: 'notebook.deleted'; notebookId: string }
    | { type: 'collectable.created'; collectable: Collectable; notebookId: string }
    | { type: 'collectable.updated'; collectable: Collectable; notebookId: string }
    | { type: 'collectable.deleted'; collectableId: string; notebookId: string }
    | { type: 'recording.started'; id: string; notebookId?: string }
    | { type: 'recording.completed'; recording: Recording; notebookId?: string }
    | { type: 'recording.failed'; id: string; error?: string; notebookId?: string }
    | { type: 'json.updated'; pageId: string; version: number; data: unknown; notebookId?: string };

/**
 * Notebook client info (for Y.Doc collaboration)
 */
interface NotebookClient {
    ws: WebSocket;
    userId: string;
    userName: string;
    userColor: string;
    connectedAt: Date;
}

/**
 * Connection info for a user
 */
interface UserConnection {
    ws: WebSocket;
    subscribedNotebooks: Set<string>;
    subscribedTags: Set<string>;
}

/**
 * Realtime WebSocket Service
 * Unified connection management for:
 * - App events (pages/notebooks/collectables CRUD) - broadcast to user connections
 * - Memo Y.Doc sync - room-based for collaborative editing
 */
class RealtimeWSService {
    // User connections: userId -> Set of connections
    private userConnections = new Map<string, Set<UserConnection>>();

    // Notebook rooms: noteId -> clientId -> client info
    private notebookRooms = new Map<string, Map<string, NotebookClient>>();

    // Track Redis subscriptions for notebooks
    private notebookRedisSubscriptions = new Set<string>();

    // Track Redis subscriptions for app events (per user)
    private appEventRedisSubscriptions = new Set<string>();

    // Keepalive interval
    private readonly KEEPALIVE_INTERVAL = 30000;
    private keepaliveTimer: Timer;

    constructor() {
        // Start keepalive pings
        this.keepaliveTimer = setInterval(() => {
            this.sendKeepalives();
        }, this.KEEPALIVE_INTERVAL);
    }

    // ==================== User Connection Management ====================

    /**
     * Register a new WebSocket connection for a user
     */
    registerConnection(userId: string, ws: WebSocket, subscribedTags?: string[]): UserConnection {
        const isFirstConnection = !this.userConnections.has(userId);

        if (isFirstConnection) {
            this.userConnections.set(userId, new Set());
            // Subscribe to Redis channel for app events (cross-replica sync)
            this.subscribeAppEventsRedis(userId);
        }

        const connection: UserConnection = {
            ws,
            subscribedNotebooks: new Set(),
            subscribedTags: new Set(subscribedTags || []),
        };

        this.userConnections.get(userId)!.add(connection);

        return connection;
    }

    /**
     * Unregister a user connection
     */
    unregisterConnection(userId: string, connection: UserConnection): void {
        const connections = this.userConnections.get(userId);
        if (!connections) return;

        // Leave all subscribed notebooks
        for (const noteId of connection.subscribedNotebooks) {
            this.leaveNotebook(noteId, connection.ws);
        }

        connections.delete(connection);

        if (connections.size === 0) {
            this.userConnections.delete(userId);
            // Unsubscribe from Redis channel for app events
            this.unsubscribeAppEventsRedis(userId);
        }
    }

    // ==================== App Event Broadcasting ====================

    /**
     * Send app event to a specific user (all their connections)
     * Also publishes to Redis for cross-replica sync
     */
    sendToUser(userId: string, event: AppEvent): void {
        // Publish to Redis for other replicas
        if (redisPubSub.connected) {
            redisPubSub.publishAppEvent(userId, event);
        }

        // Send to local connections
        this.sendToUserLocal(userId, event);
    }

    /**
     * Send app event to local connections only (called from Redis handler)
     */
    private sendToUserLocal(userId: string, event: AppEvent): void {
        const connections = this.userConnections.get(userId);
        if (!connections || connections.size === 0) {
            return;
        }

        const message = JSON.stringify({ channel: 'app', event });
        console.log(
            `[WS] sendToUserLocal: sending ${event.type} to ${userId} (${connections.size} connections)`,
        );

        for (const conn of connections) {
            this.safeSend(conn.ws, message);
        }
    }

    /**
     * Send app event to multiple users
     */
    sendToUsers(userIds: string[], event: AppEvent): void {
        for (const userId of userIds) {
            this.sendToUser(userId, event);
        }
    }

    /**
     * Broadcast app event to all connected users
     */
    broadcastAppEvent(event: AppEvent): void {
        const userIds = Array.from(this.userConnections.keys());
        this.sendToUsers(userIds, event);
    }

    /**
     * Broadcast app event to all clients in a notebook room
     * Used for events that affect all collaborators (e.g., recording status)
     */
    broadcastToNotebookRoom(noteId: string, event: AppEvent): void {
        const room = this.notebookRooms.get(noteId);
        if (!room) {
            console.log(`[WS] broadcastToNotebookRoom: No room found for noteId ${noteId}`);
            console.log(`[WS] Available rooms:`, Array.from(this.notebookRooms.keys()));
            return;
        }

        console.log(
            `[WS] broadcastToNotebookRoom: Sending ${event.type} to ${room.size} clients in room ${noteId}`,
        );
        const message = JSON.stringify({ channel: 'app', event });
        for (const [clientId, client] of room) {
            console.log(`[WS] Sending to client ${clientId}`);
            this.safeSend(client.ws, message);
        }
    }

    // ==================== Notebook Room Management ====================

    /**
     * Join a notebook room for Y.Doc collaboration
     */
    joinNotebook(
        noteId: string,
        clientId: string,
        ws: WebSocket,
        userInfo: { userId: string; userName: string; userColor: string },
    ): void {
        // Get or create room
        const isNewRoom = !this.notebookRooms.has(noteId);
        if (isNewRoom) {
            this.notebookRooms.set(noteId, new Map());
            // Subscribe to Redis channel for this notebook (for cross-replica sync)
            this.subscribeNotebookRedis(noteId);
        }

        const room = this.notebookRooms.get(noteId)!;

        // Add client to room
        room.set(clientId, {
            ws,
            userId: userInfo.userId,
            userName: userInfo.userName,
            userColor: userInfo.userColor,
            connectedAt: new Date(),
        });

        // Notify other clients about new peer
        this.broadcastToNotebookPeers(
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

        // Track subscription in user connection
        const userId = userInfo.userId;
        const connections = this.userConnections.get(userId);
        if (connections) {
            for (const conn of connections) {
                if (conn.ws === ws) {
                    conn.subscribedNotebooks.add(noteId);
                    break;
                }
            }
        }
    }

    /**
     * Leave a notebook room
     */
    leaveNotebook(noteId: string, ws: WebSocket): void {
        const room = this.notebookRooms.get(noteId);
        if (!room) return;

        // Find client by WebSocket
        let clientId: string | null = null;
        for (const [cid, client] of room) {
            if (client.ws === ws) {
                clientId = cid;
                break;
            }
        }

        if (!clientId) return;

        room.delete(clientId);

        // Notify other clients about peer leaving
        this.broadcastToNotebookPeers(
            noteId,
            {
                type: 'peer-leave',
                data: { clientId },
                timestamp: new Date().toISOString(),
            },
            clientId,
        );

        // Clean up empty room
        if (room.size === 0) {
            this.notebookRooms.delete(noteId);
            // Unsubscribe from Redis channel
            this.unsubscribeNotebookRedis(noteId);
        }
    }

    /**
     * Send initial document state to a newly connected client
     */
    sendInitialState(noteId: string, clientId: string, state: Uint8Array, version: number): void {
        const room = this.notebookRooms.get(noteId);
        if (!room) {
            console.log(`[WS] sendInitialState: room not found for ${noteId}`);
            return;
        }

        const client = room.get(clientId);
        if (!client) {
            console.log(`[WS] sendInitialState: client ${clientId} not found in room ${noteId}`);
            return;
        }

        const event: MemoSSEEvent = {
            type: 'ydoc-init',
            data: {
                state: Buffer.from(state).toString('base64'),
                version,
                peers: this.getRoomPeers(noteId, clientId),
            },
            timestamp: new Date().toISOString(),
        };

        const sent = this.sendNotebookEvent(client.ws, noteId, event);
        console.log(`[WS] sendInitialState for ${noteId}: ${sent ? 'success' : 'failed'}`);
    }

    /**
     * Broadcast Y.Doc update to all clients in a notebook room except sender
     * Also publishes to Redis for cross-replica sync
     */
    broadcastUpdate(noteId: string, update: Uint8Array, excludeClientId: string): void {
        const event: MemoSSEEvent = {
            type: 'ydoc-update',
            data: {
                update: Buffer.from(update).toString('base64'),
                from: excludeClientId,
            },
            timestamp: new Date().toISOString(),
        };

        // Publish to Redis for other replicas
        if (redisPubSub.connected) {
            redisPubSub.publishNotebook(noteId, event);
        }

        // Broadcast to local clients
        this.broadcastToNotebookPeers(noteId, event, excludeClientId);
    }

    /**
     * Broadcast awareness update to all clients in a notebook room except sender
     * Awareness updates contain cursor positions, selections, user presence, etc.
     * Also publishes to Redis for cross-replica sync
     */
    broadcastAwareness(noteId: string, update: Uint8Array, excludeClientId: string): void {
        const event: MemoSSEEvent = {
            type: 'awareness-update',
            data: {
                update: Buffer.from(update).toString('base64'),
                from: excludeClientId,
            },
            timestamp: new Date().toISOString(),
        };

        // Publish to Redis for other replicas
        if (redisPubSub.connected) {
            redisPubSub.publishNotebook(noteId, event);
        }

        // Broadcast to local clients
        this.broadcastToNotebookPeers(noteId, event, excludeClientId);
    }

    /**
     * Get list of peers in a notebook room
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
        const room = this.notebookRooms.get(noteId);
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
                    userId: client.userId,
                    userName: client.userName,
                    userColor: client.userColor,
                });
            }
        }

        return peers;
    }

    /**
     * Broadcast notebook event to all peers except one
     */
    private broadcastToNotebookPeers(
        noteId: string,
        event: MemoSSEEvent,
        excludeClientId: string,
    ): void {
        const room = this.notebookRooms.get(noteId);
        if (!room) return;

        for (const [clientId, client] of room) {
            if (clientId !== excludeClientId) {
                this.sendNotebookEvent(client.ws, noteId, event);
            }
        }
    }

    /**
     * Send notebook event to a specific WebSocket
     */
    private sendNotebookEvent(ws: WebSocket, noteId: string, event: MemoSSEEvent): boolean {
        // Use 'memo' channel and 'pageId' property to match frontend expectations
        const message = JSON.stringify({ channel: 'memo', pageId: noteId, event });
        return this.safeSend(ws, message);
    }

    // ==================== Redis Integration ====================

    /**
     * Subscribe to Redis channel for a notebook
     */
    private subscribeNotebookRedis(noteId: string): void {
        if (this.notebookRedisSubscriptions.has(noteId)) return;

        if (redisPubSub.connected) {
            redisPubSub
                .subscribeNotebook(noteId, (event: MemoSSEEvent) => {
                    this.handleRedisNotebookEvent(noteId, event);
                })
                .catch(() => {});
            this.notebookRedisSubscriptions.add(noteId);
        }
    }

    /**
     * Unsubscribe from Redis channel for a notebook
     */
    private unsubscribeNotebookRedis(noteId: string): void {
        if (!this.notebookRedisSubscriptions.has(noteId)) return;

        if (redisPubSub.connected) {
            redisPubSub
                .unsubscribeNotebook(noteId, (event: MemoSSEEvent) => {
                    this.handleRedisNotebookEvent(noteId, event);
                })
                .catch(() => {});
        }
        this.notebookRedisSubscriptions.delete(noteId);
    }

    /**
     * Handle notebook event from Redis (from another replica)
     */
    private handleRedisNotebookEvent(noteId: string, event: MemoSSEEvent): void {
        const room = this.notebookRooms.get(noteId);
        if (!room) return;

        // For updates from other replicas, broadcast to all local clients
        // The 'from' field contains the original sender's clientId
        const excludeClientId = (event.data as any)?.from || '';

        // Broadcast to all local clients except the original sender (if they're on this replica)
        for (const [clientId, client] of room) {
            if (clientId !== excludeClientId) {
                this.sendNotebookEvent(client.ws, noteId, event);
            }
        }
    }

    // ==================== App Events Redis Integration ====================

    /**
     * Subscribe to Redis channel for app events (per user)
     */
    private subscribeAppEventsRedis(userId: string): void {
        if (this.appEventRedisSubscriptions.has(userId)) return;

        if (redisPubSub.connected) {
            redisPubSub
                .subscribeAppEvents(userId, (event: AppEvent) => {
                    this.handleRedisAppEvent(userId, event);
                })
                .catch(() => {});
            this.appEventRedisSubscriptions.add(userId);
        }
    }

    /**
     * Unsubscribe from Redis channel for app events
     */
    private unsubscribeAppEventsRedis(userId: string): void {
        if (!this.appEventRedisSubscriptions.has(userId)) return;

        if (redisPubSub.connected) {
            redisPubSub
                .unsubscribeAppEvents(userId, (event: AppEvent) => {
                    this.handleRedisAppEvent(userId, event);
                })
                .catch(() => {});
        }
        this.appEventRedisSubscriptions.delete(userId);
    }

    /**
     * Handle app event from Redis (from another replica)
     * Only sends to local connections - does NOT re-publish to Redis
     */
    private handleRedisAppEvent(userId: string, event: AppEvent): void {
        this.sendToUserLocal(userId, event);
    }

    // ==================== Utility Methods ====================

    /**
     * Safe send to WebSocket
     */
    private safeSend(ws: WebSocket, message: string): boolean {
        try {
            // Bun's ServerWebSocket uses readyState 1 for OPEN
            // Cast to number to avoid TypeScript issues with different WebSocket types
            const readyState = ws.readyState as number;
            if (readyState === 1) {
                ws.send(message);
                return true;
            } else {
                console.log(`[WS] Cannot send - readyState: ${readyState}`);
            }
        } catch (error) {
            console.error('[WS] Send error:', error);
        }
        return false;
    }

    /**
     * Send keepalive pings to all connections
     */
    private sendKeepalives(): void {
        const pingMessage = JSON.stringify({ channel: 'system', event: { type: 'ping' } });

        for (const connections of this.userConnections.values()) {
            for (const conn of connections) {
                this.safeSend(conn.ws, pingMessage);
            }
        }
    }

    /**
     * Get client count in a notebook room
     */
    getNotebookClientCount(noteId: string): number {
        return this.notebookRooms.get(noteId)?.size ?? 0;
    }

    /**
     * Get client count for a whiteboard document
     * (Alias for getNotebookClientCount - same room infrastructure)
     */
    getWhiteboardClientCount(documentId: string): number {
        return this.getNotebookClientCount(documentId);
    }

    /**
     * Get client count for a kanban board document
     * (Alias for getNotebookClientCount - same room infrastructure)
     */
    getKanbanClientCount(documentId: string): number {
        return this.getNotebookClientCount(documentId);
    }

    /**
     * Get client IDs in a notebook room
     */
    getNotebookClientIds(noteId: string): string[] {
        const room = this.notebookRooms.get(noteId);
        if (!room) return [];
        return Array.from(room.keys());
    }

    /**
     * Check if client is in a notebook room
     */
    isClientInNotebook(noteId: string, clientId: string): boolean {
        return this.notebookRooms.get(noteId)?.has(clientId) ?? false;
    }

    /**
     * Get all connections for chat broadcasting
     * Returns a map of userId -> connections with their tag subscriptions
     */
    getAllConnections(): Map<string, Set<UserConnection>> {
        return this.userConnections;
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalUsers: number;
        totalConnections: number;
        totalNotebookRooms: number;
        notebookRoomStats: Array<{ noteId: string; clients: number }>;
    } {
        let totalConnections = 0;
        for (const connections of this.userConnections.values()) {
            totalConnections += connections.size;
        }

        const notebookRoomStats: Array<{ noteId: string; clients: number }> = [];
        for (const [noteId, room] of this.notebookRooms) {
            notebookRoomStats.push({ noteId, clients: room.size });
        }

        return {
            totalUsers: this.userConnections.size,
            totalConnections,
            totalNotebookRooms: this.notebookRooms.size,
            notebookRoomStats,
        };
    }

    /**
     * Shutdown service
     */
    shutdown(): void {
        clearInterval(this.keepaliveTimer);

        // Close all connections
        for (const connections of this.userConnections.values()) {
            for (const conn of connections) {
                try {
                    conn.ws.close(1001, 'Server shutting down');
                } catch {}
            }
        }

        this.userConnections.clear();
        this.notebookRooms.clear();
    }
}

// Singleton instance
export const realtimeWSService = new RealtimeWSService();
