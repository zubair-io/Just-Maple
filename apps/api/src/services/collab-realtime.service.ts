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

// Create the realtime service (WebSocket-only)
export const collabRealtimeService = new WebSocketCollabRealtimeService();
