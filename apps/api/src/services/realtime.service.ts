import type { ChatEvent } from '@maple/shared';
import { realtimeWSService } from './realtime-ws.service';
import { redisPubSub } from './redis.service';

// Track which tags we're subscribed to in Redis
const subscribedTags = new Set<string>();

/**
 * Handle incoming chat event from Redis (from another replica)
 */
function handleRedisChat(tagId: string, event: ChatEvent): void {
    // Broadcast to local connections only
    broadcastToLocalConnections(tagId, event);
}

/**
 * Broadcast to local WebSocket connections (this replica only)
 */
function broadcastToLocalConnections(tagId: string, event: ChatEvent): void {
    const connections = realtimeWSService.getAllConnections();

    for (const [, userConns] of connections) {
        for (const conn of userConns) {
            if (conn.subscribedTags.has(tagId) && conn.ws.readyState === 1) {
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
 * Subscribe to a tag's chat channel in Redis
 * Called when a user subscribes to a tag
 */
export async function subscribeToTagChat(tagId: string): Promise<void> {
    if (subscribedTags.has(tagId)) return;

    if (redisPubSub.connected) {
        await redisPubSub.subscribeChat(tagId, (event: ChatEvent) => {
            handleRedisChat(tagId, event);
        });
        subscribedTags.add(tagId);
    }
}

/**
 * Unsubscribe from a tag's chat channel in Redis
 * Called when no more users are subscribed to a tag on this replica
 */
export async function unsubscribeFromTagChat(tagId: string): Promise<void> {
    // Check if any local connections still need this tag
    const connections = realtimeWSService.getAllConnections();
    let hasSubscribers = false;

    for (const [, userConns] of connections) {
        for (const conn of userConns) {
            if (conn.subscribedTags.has(tagId)) {
                hasSubscribers = true;
                break;
            }
        }
        if (hasSubscribers) break;
    }

    // Only unsubscribe from Redis if no local subscribers
    if (!hasSubscribers && subscribedTags.has(tagId)) {
        if (redisPubSub.connected) {
            await redisPubSub.unsubscribeChat(tagId, (event: ChatEvent) => {
                handleRedisChat(tagId, event);
            });
        }
        subscribedTags.delete(tagId);
    }
}

/**
 * Broadcast a chat event to all users subscribed to a tag
 * Publishes to Redis for cross-replica delivery and broadcasts locally
 */
export async function broadcastChatEvent(tagId: string, event: ChatEvent): Promise<void> {
    // Publish to Redis for other replicas
    if (redisPubSub.connected) {
        redisPubSub.publishChat(tagId, event);
    }

    // Also broadcast to local connections (for this replica)
    // Note: Redis will also deliver to us, but we broadcast locally for lower latency
    // The client handles deduplication via message IDs
    broadcastToLocalConnections(tagId, event);
}
