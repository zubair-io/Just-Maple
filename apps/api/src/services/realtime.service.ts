import type { ChatEvent } from '@maple/shared';
import { realtimeWSService } from './realtime-ws.service';

/**
 * Broadcast a chat event to all users subscribed to a tag
 * This is a convenience wrapper around realtimeWSService for chat messages
 */
export async function broadcastChatEvent(tagId: string, event: ChatEvent): Promise<void> {
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
