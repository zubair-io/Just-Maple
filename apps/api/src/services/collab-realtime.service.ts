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
        if (!noteConnections) return;

        const msgStr = typeof message === 'string' ? message : JSON.stringify(message);

        for (const [clientId, ws] of noteConnections.entries()) {
            if (clientId !== senderClientId && ws.readyState === WebSocket.OPEN) {
                ws.send(msgStr);
            }
        }
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

    addConnection(noteId: string, clientId: string, connection: WebSocket): void {
        if (!this.connections.has(noteId)) {
            this.connections.set(noteId, new Map());
        }
        this.connections.get(noteId)!.set(clientId, connection);
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

    constructor(private signalrClient: any) {} // Azure SignalR client

    broadcast(noteId: string, message: any, senderClientId?: string): void {
        // SignalR: send to group (noteId), exclude sender
        // This would call Azure SignalR Service API
        // For now, this is a placeholder for production implementation
        console.log(`[SignalR Collab] Broadcast to ${noteId}, excluding ${senderClientId}`);
        // TODO: Implement Azure SignalR broadcast
        // this.signalrClient.group(noteId).excludeConnection(senderClientId).send(message);
    }

    sendToClient(clientId: string, message: any): void {
        // TODO: Implement Azure SignalR send to client
        console.log(`[SignalR Collab] Send to client ${clientId}`);
        // this.signalrClient.client(clientId).send(message);
    }

    addConnection(noteId: string, clientId: string): void {
        if (!this.groupMap.has(noteId)) {
            this.groupMap.set(noteId, new Set());
        }
        this.groupMap.get(noteId)!.add(clientId);

        // TODO: Add client to SignalR group
        // this.signalrClient.addClientToGroup(clientId, noteId);
    }

    removeConnection(noteId: string, clientId: string): void {
        this.groupMap.get(noteId)?.delete(clientId);
        // TODO: Remove client from SignalR group
        // this.signalrClient.removeClientFromGroup(clientId, noteId);
    }

    getConnectedClients(noteId: string): string[] {
        return Array.from(this.groupMap.get(noteId) || []);
    }
}

// Factory to create appropriate service based on environment
export function createCollabRealtimeService(): ICollabRealtimeService {
    if (process.env.USE_SIGNALR === 'true') {
        // Production: Azure SignalR
        const signalrClient = null; // TODO: Initialize Azure SignalR client
        return new SignalRCollabRealtimeService(signalrClient);
    } else {
        // Dev/self-hosted: WebSocket
        return new WebSocketCollabRealtimeService();
    }
}

export const collabRealtimeService = createCollabRealtimeService();
