import type { SignalRCollabService } from './signalr-collab.service';

// Abstract interface for realtime collaboration communication
export interface ICollabRealtimeService {
    // Broadcast message to all connections for a noteId (except sender)
    broadcast(noteId: string, message: any, senderClientId?: string): void;

    // Send message to specific client
    sendToClient(clientId: string, message: any): void;

    // Register connection
    addConnection(noteId: string, clientId: string, connection: any): void;

    // Unregister connection
    removeConnection(noteId: string, clientId: string): void;

    // Get all client IDs for a note
    getConnectedClients(noteId: string): string[];
}

// Paperbark WebSocket implementation (for dev/self-hosted)
export class WebSocketCollabRealtimeService implements ICollabRealtimeService {
    private connections = new Map<string, Map<string, WebSocket>>();

    broadcast(noteId: string, message: any, senderClientId?: string): void {
        const noteConnections = this.connections.get(noteId);
        if (!noteConnections) {
            console.log(`[Realtime] No connections for note ${noteId}`);
            return;
        }

        const msgStr = typeof message === 'string' ? message : JSON.stringify(message);
        const connectedClients = Array.from(noteConnections.keys());

        console.log(
            `[Realtime] Broadcasting to note ${noteId}, excluding sender: "${senderClientId}"`,
        );
        console.log(`[Realtime] Connected clients:`, connectedClients);

        let sentCount = 0;
        for (const [clientId, ws] of noteConnections.entries()) {
            const isSender = clientId === senderClientId;
            const isOpen = ws.readyState === WebSocket.OPEN;

            console.log(
                `[Realtime]   - Client "${clientId}": isSender=${isSender}, isOpen=${isOpen}, willSend=${!isSender && isOpen}`,
            );

            if (!isSender && isOpen) {
                ws.send(msgStr);
                sentCount++;
            }
        }

        console.log(`[Realtime] Sent to ${sentCount} clients`);
    }

    sendToClient(clientId: string, message: any): void {
        // Find client across all notes
        for (const noteConnections of this.connections.values()) {
            const ws = noteConnections.get(clientId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                const msgStr = typeof message === 'string' ? message : JSON.stringify(message);
                ws.send(msgStr);
                return;
            }
        }
    }

    addConnection(noteId: string, clientId: string, connection: any): void {
        if (!this.connections.has(noteId)) {
            this.connections.set(noteId, new Map());
        }
        // Extract WebSocket from connection object (supports both { ws, userId } and direct WebSocket)
        const ws = connection.ws || connection;
        this.connections.get(noteId)!.set(clientId, ws);
    }

    removeConnection(noteId: string, clientId: string): void {
        const noteConnections = this.connections.get(noteId);
        if (noteConnections) {
            noteConnections.delete(clientId);
            if (noteConnections.size === 0) {
                this.connections.delete(noteId);
            }
        }
    }

    getConnectedClients(noteId: string): string[] {
        return Array.from(this.connections.get(noteId)?.keys() || []);
    }
}

// Azure SignalR implementation (for production)
export class SignalRCollabRealtimeService implements ICollabRealtimeService {
    private groupMap = new Map<string, Set<string>>(); // noteId -> clientIds
    private clientToUserMap = new Map<string, string>(); // clientId -> userId
    private signalrClient: SignalRCollabService;

    constructor(signalrClient: SignalRCollabService) {
        this.signalrClient = signalrClient;
    }

    broadcast(noteId: string, message: any, senderClientId?: string): void {
        console.log(`[SignalR Collab] Broadcasting to note ${noteId}, excluding ${senderClientId}`);

        // Determine sender userId to exclude them from broadcast
        const senderUserId = senderClientId ? this.clientToUserMap.get(senderClientId) : undefined;

        // Create collaboration event
        const event: any = {
            type: message.type,
            noteId,
            version: message.version,
            steps: message.steps,
            clientIDs: message.clientIDs,
            clientID: message.clientID,
            doc: message.doc,
        };

        // Broadcast via AutumnBlaze
        this.signalrClient.broadcastToNote(noteId, event, senderUserId).catch(console.error);
    }

    sendToClient(clientId: string, message: any): void {
        // SignalR doesn't support direct client-to-client messaging
        // We can only send to users, so we'll use the userId mapping
        const userId = this.clientToUserMap.get(clientId);
        if (!userId) {
            console.error(`[SignalR Collab] Cannot send to client ${clientId} - no userId mapping`);
            return;
        }

        console.log(`[SignalR Collab] Sending to client ${clientId} (user ${userId})`);

        // For now, we'll broadcast to the note and let the client filter
        // This is a limitation of SignalR's user-based targeting
        this.broadcast(message.noteId, message, clientId);
    }

    addConnection(noteId: string, clientId: string, connection?: any): void {
        if (!this.groupMap.has(noteId)) {
            this.groupMap.set(noteId, new Set());
        }
        this.groupMap.get(noteId)!.add(clientId);

        // Extract userId from connection context if available
        // In SignalR mode, we don't have WebSocket connection, but we track the mapping
        if (connection?.userId) {
            this.clientToUserMap.set(clientId, connection.userId);
        }

        console.log(`[SignalR Collab] Client ${clientId} joined note ${noteId}`);
    }

    removeConnection(noteId: string, clientId: string): void {
        this.groupMap.get(noteId)?.delete(clientId);
        this.clientToUserMap.delete(clientId);

        if (this.groupMap.get(noteId)?.size === 0) {
            this.groupMap.delete(noteId);
        }

        console.log(`[SignalR Collab] Client ${clientId} left note ${noteId}`);
    }

    getConnectedClients(noteId: string): string[] {
        return Array.from(this.groupMap.get(noteId) || []);
    }
}

// Factory to create appropriate service based on environment
export function createCollabRealtimeService(): ICollabRealtimeService {
    if (process.env.USE_SIGNALR === 'true') {
        // Production: Azure SignalR via AutumnBlaze
        const { SignalRCollabService } = require('./signalr-collab.service');
        const signalrClient = new SignalRCollabService();
        return new SignalRCollabRealtimeService(signalrClient);
    } else {
        // Dev/self-hosted: WebSocket
        return new WebSocketCollabRealtimeService();
    }
}

export const collabRealtimeService = createCollabRealtimeService();
