import type { ChatEvent } from '@maple/shared';
import { realtimeWSService } from './realtime-ws.service';
import { redisPubSub } from './redis.service';

// Track which notebooks we're subscribed to in Redis
const subscribedNotebooks = new Set<string>();

/**
 * Handle incoming chat event from Redis (from another replica)
 */
function handleRedisChat(notebookId: string, event: ChatEvent): void {
    // Broadcast to local connections only
    broadcastToLocalConnections(notebookId, event);
}

/**
 * Broadcast to local WebSocket connections (this replica only)
 */
function broadcastToLocalConnections(notebookId: string, event: ChatEvent): void {
    const connections = realtimeWSService.getAllConnections();

    for (const [, userConns] of connections) {
        for (const conn of userConns) {
            if (conn.subscribedTags.has(notebookId) && conn.ws.readyState === 1) {
                try {
                    conn.ws.send(JSON.stringify({ channel: 'chat', event }));
                } catch {
                    // Connection might be closed
                }
            }
        }
    }
}

/**
 * Subscribe to a notebook's chat channel in Redis
 * Called when a user subscribes to a notebook
 */
export async function subscribeToNotebookChat(notebookId: string): Promise<void> {
    if (subscribedNotebooks.has(notebookId)) return;

    if (redisPubSub.connected) {
        await redisPubSub.subscribeChat(notebookId, (event: ChatEvent) => {
            handleRedisChat(notebookId, event);
        });
        subscribedNotebooks.add(notebookId);
    }
}

/**
 * Unsubscribe from a notebook's chat channel in Redis
 * Called when no more users are subscribed to a notebook on this replica
 */
export async function unsubscribeFromNotebookChat(notebookId: string): Promise<void> {
    // Check if any local connections still need this notebook
    const connections = realtimeWSService.getAllConnections();
    let hasSubscribers = false;

    for (const [, userConns] of connections) {
        for (const conn of userConns) {
            if (conn.subscribedTags.has(notebookId)) {
                hasSubscribers = true;
                break;
            }
        }
        if (hasSubscribers) break;
    }

    // Only unsubscribe from Redis if no local subscribers
    if (!hasSubscribers && subscribedNotebooks.has(notebookId)) {
        if (redisPubSub.connected) {
            await redisPubSub.unsubscribeChat(notebookId, (event: ChatEvent) => {
                handleRedisChat(notebookId, event);
            });
        }
        subscribedNotebooks.delete(notebookId);
    }
}

/**
 * Broadcast a chat event to all users subscribed to a notebook
 * Publishes to Redis for cross-replica delivery and broadcasts locally
 */
export async function broadcastChatEvent(notebookId: string, event: ChatEvent): Promise<void> {
    // Publish to Redis for other replicas
    if (redisPubSub.connected) {
        redisPubSub.publishChat(notebookId, event);
    }

    // Also broadcast to local connections (for this replica)
    // Note: Redis will also deliver to us, but we broadcast locally for lower latency
    // The client handles deduplication via message IDs
    broadcastToLocalConnections(notebookId, event);
}
