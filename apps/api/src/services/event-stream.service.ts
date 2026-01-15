/**
 * Event Stream Service
 * Manages Server-Sent Events (SSE) connections for real-time app updates
 * Handles permission-aware event broadcasting to users
 */

import type { Note, Tag, Paper } from '@maple/shared';

// Event types that can be sent via SSE
export type AppEvent =
    | { type: 'note.created'; note: Note; tagId?: string }
    | { type: 'note.updated'; noteId: string; title?: string; updatedAt: string; tagId?: string }
    | { type: 'note.deleted'; noteId: string; tagId?: string }
    | { type: 'note.trashed'; noteId: string; tagId?: string }
    | { type: 'note.restored'; note: Note; tagId?: string }
    | { type: 'tag.created'; tag: Tag }
    | { type: 'tag.updated'; tagId: string; label?: string }
    | { type: 'tag.deleted'; tagId: string }
    | { type: 'paper.created'; paper: Paper; tagId: string }
    | { type: 'paper.updated'; paper: Paper; tagId: string }
    | { type: 'paper.deleted'; paperId: string; tagId: string };

// Connection tracking
interface ConnectionInfo {
    controller: ReadableStreamDefaultController;
    connectionId: string;
}

/**
 * Event Stream Service
 * Manages SSE connections and broadcasts events to users
 * Supports multiple connections per user (multi-tab/device)
 */
export class EventStreamService {
    // User ID -> Set of connections (supports multiple tabs/devices)
    private connections = new Map<string, Set<ConnectionInfo>>();

    // Cleanup interval (remove stale connections every 60 seconds)
    private readonly STALE_CONNECTION_TIMEOUT = 60000;
    private cleanupInterval: Timer;

    constructor() {
        // Start automatic cleanup of stale connections
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleConnections();
        }, this.STALE_CONNECTION_TIMEOUT);
    }

    /**
     * Register an SSE connection for a user
     * Supports multiple connections per user (multi-tab/device)
     */
    registerConnection(
        userId: string,
        controller: ReadableStreamDefaultController,
        connectionId: string,
    ): void {
        // Get or create connection set for this user
        if (!this.connections.has(userId)) {
            this.connections.set(userId, new Set());
        }

        const userConnections = this.connections.get(userId)!;
        userConnections.add({ controller, connectionId });

        console.log(
            `[Event Stream] Registered SSE connection for user: ${userId} (connection: ${connectionId}, total: ${userConnections.size})`,
        );
    }

    /**
     * Unregister SSE connection for a user
     * Removes only the specific connection, not all of them
     */
    unregisterConnection(userId: string, connectionId: string): void {
        const userConnections = this.connections.get(userId);
        if (!userConnections) return;

        // Find and remove the specific connection
        for (const conn of userConnections) {
            if (conn.connectionId === connectionId) {
                try {
                    conn.controller.close();
                } catch {}
                userConnections.delete(conn);
                console.log(
                    `[Event Stream] Unregistered SSE connection for user: ${userId} (connection: ${connectionId}, remaining: ${userConnections.size})`,
                );
                break;
            }
        }

        // Clean up empty set
        if (userConnections.size === 0) {
            this.connections.delete(userId);
        }
    }

    /**
     * Send event to a specific user (all their connections)
     */
    sendToUser(userId: string, event: AppEvent): void {
        const userConnections = this.connections.get(userId);
        if (!userConnections || userConnections.size === 0) {
            // User not connected - event will be missed (consider adding queue if needed)
            return;
        }

        const data = JSON.stringify(event);
        const message = `data: ${data}\n\n`;
        const failedConnections: ConnectionInfo[] = [];

        // Send to all connections for this user
        for (const conn of userConnections) {
            try {
                conn.controller.enqueue(new TextEncoder().encode(message));
            } catch (error) {
                console.error(
                    `[Event Stream] Failed to send event to user ${userId} (connection: ${conn.connectionId}):`,
                    error,
                );
                // Mark for removal
                failedConnections.push(conn);
            }
        }

        // Remove failed connections
        for (const conn of failedConnections) {
            userConnections.delete(conn);
        }

        // Clean up empty set
        if (userConnections.size === 0) {
            this.connections.delete(userId);
        } else {
            console.log(
                `[Event Stream] Sent event to user ${userId}: ${event.type} (${userConnections.size} connections)`,
            );
        }
    }

    /**
     * Send event to multiple users (permission-aware broadcasting)
     */
    sendToUsers(userIds: string[], event: AppEvent): void {
        for (const userId of userIds) {
            this.sendToUser(userId, event);
        }
        console.log(`[Event Stream] Broadcast event to ${userIds.length} users: ${event.type}`);
    }

    /**
     * Broadcast event to all connected users
     * (Use sparingly - prefer sendToUsers for permission-aware events)
     */
    broadcast(event: AppEvent): void {
        const userIds = Array.from(this.connections.keys());
        this.sendToUsers(userIds, event);
    }

    /**
     * Get count of active connections
     */
    getActiveConnectionCount(): number {
        let total = 0;
        for (const userConnections of this.connections.values()) {
            total += userConnections.size;
        }
        return total;
    }

    /**
     * Clean up stale connections (connection check can be added if needed)
     */
    private cleanupStaleConnections(): void {
        // For now, rely on browser disconnect events
        // Could add ping/pong if needed
    }

    /**
     * Stop the cleanup interval (for graceful shutdown)
     */
    shutdown(): void {
        clearInterval(this.cleanupInterval);

        // Close all connections
        for (const [userId, controller] of this.connections.entries()) {
            try {
                controller.close();
            } catch {}
        }

        this.connections.clear();
        console.log('[Event Stream] Service shutdown');
    }

    /**
     * Get statistics about active connections
     */
    getStats(): {
        activeConnections: number;
        activeUsers: number;
    } {
        return {
            activeConnections: this.getActiveConnectionCount(),
            activeUsers: this.connections.size,
        };
    }
}

// Singleton instance
export const eventStreamService = new EventStreamService();
