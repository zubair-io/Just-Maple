import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findTagsByUserId } from '../repositories/tag.repo';
import type { RealtimeService } from '../services/realtime.service';
import type { ChatEvent, TypingEvent } from '@maple/shared';
import { authenticateWebSocket } from './ws-auth';

// Store connected clients by userId
const userConnections = new Map<string, Set<WebSocket>>();
// Store client subscriptions by tagId
const tagSubscriptions = new Map<string, Set<string>>(); // tagId -> Set of userIds

// WebSocket implementation of RealtimeService
export class WebSocketRealtimeService implements RealtimeService {
    async broadcast(tagId: string, event: ChatEvent): Promise<void> {
        const subscribedUsers = tagSubscriptions.get(tagId);
        if (!subscribedUsers) return;

        const message = JSON.stringify(event);

        for (const userId of subscribedUsers) {
            const connections = userConnections.get(userId);
            if (connections) {
                for (const ws of connections) {
                    try {
                        ws.send(message);
                    } catch {
                        // Connection might be closed
                    }
                }
            }
        }
    }

    async sendToUser(userId: string, event: ChatEvent): Promise<void> {
        const connections = userConnections.get(userId);
        if (!connections) return;

        const message = JSON.stringify(event);

        for (const ws of connections) {
            try {
                ws.send(message);
            } catch {
                // Connection might be closed
            }
        }
    }
}

interface WSContext {
    userId: string;
    subscribedTags: Set<string>;
}

// Create WebSocket Elysia plugin
export const chatWebSocket = new Elysia({ prefix: '/ws' })
    .use(
        jwt({
            name: 'jwt',
            secret: config.jwtSecret,
        }),
    )
    .ws('/chat', {
        async open(ws) {
            // Authenticate user
            const auth = await authenticateWebSocket(ws);
            if (!auth) {
                return; // Connection already closed by authenticateWebSocket
            }

            try {
                const userId = auth.userId;

                // Store connection context
                (ws.data as unknown as { context: WSContext }).context = {
                    userId,
                    subscribedTags: new Set(),
                };

                // Add to user connections
                if (!userConnections.has(userId)) {
                    userConnections.set(userId, new Set());
                }
                userConnections.get(userId)!.add(ws.raw as unknown as WebSocket);

                // Get user's tags and subscribe to all of them
                const tags = await findTagsByUserId(userId);
                for (const tag of tags) {
                    if (!tagSubscriptions.has(tag._id)) {
                        tagSubscriptions.set(tag._id, new Set());
                    }
                    tagSubscriptions.get(tag._id)!.add(userId);
                    (
                        (ws.data as unknown as { context: WSContext }).context as WSContext
                    ).subscribedTags.add(tag._id);
                }

                // Send connection confirmation
                ws.send(
                    JSON.stringify({
                        type: 'connected',
                        userId,
                        subscribedTags: tags.map((t) => t._id),
                    }),
                );

                console.log(`[WS] User ${userId} connected, subscribed to ${tags.length} tags`);
            } catch (error) {
                console.error('[WS] Connection error:', error);
                ws.close(4001, 'Authentication failed');
            }
        },

        async message(ws, message) {
            const context = (ws.data as unknown as { context: WSContext }).context;
            if (!context) return;

            try {
                const data = typeof message === 'string' ? JSON.parse(message) : message;

                switch (data.type) {
                    case 'typing': {
                        // Broadcast typing indicator to other users in the tag
                        const typingEvent: TypingEvent = {
                            tagId: data.tagId,
                            userId: context.userId,
                            isTyping: data.isTyping ?? true,
                        };

                        const subscribedUsers = tagSubscriptions.get(data.tagId);
                        if (subscribedUsers) {
                            const msg = JSON.stringify({
                                action: 'typing',
                                data: typingEvent,
                                tagId: data.tagId,
                                userId: context.userId,
                                timestamp: new Date().toISOString(),
                            } as ChatEvent);

                            for (const userId of subscribedUsers) {
                                if (userId === context.userId) continue; // Don't send to self

                                const connections = userConnections.get(userId);
                                if (connections) {
                                    for (const conn of connections) {
                                        try {
                                            conn.send(msg);
                                        } catch {
                                            // Ignore send errors
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }

                    case 'subscribe': {
                        // Subscribe to additional tags
                        const tagId = data.tagId;
                        if (tagId && !context.subscribedTags.has(tagId)) {
                            if (!tagSubscriptions.has(tagId)) {
                                tagSubscriptions.set(tagId, new Set());
                            }
                            tagSubscriptions.get(tagId)!.add(context.userId);
                            context.subscribedTags.add(tagId);
                        }
                        break;
                    }

                    case 'unsubscribe': {
                        // Unsubscribe from a tag
                        const tagId = data.tagId;
                        if (tagId && context.subscribedTags.has(tagId)) {
                            tagSubscriptions.get(tagId)?.delete(context.userId);
                            context.subscribedTags.delete(tagId);
                        }
                        break;
                    }

                    case 'ping': {
                        ws.send(JSON.stringify({ type: 'pong' }));
                        break;
                    }
                }
            } catch {
                // Ignore parse errors
            }
        },

        close(ws) {
            const context = (ws.data as unknown as { context: WSContext }).context;
            if (!context) return;

            const { userId, subscribedTags } = context;

            // Remove from user connections
            const connections = userConnections.get(userId);
            if (connections) {
                connections.delete(ws.raw as unknown as WebSocket);
                if (connections.size === 0) {
                    userConnections.delete(userId);
                }
            }

            // Remove from tag subscriptions
            for (const tagId of subscribedTags) {
                tagSubscriptions.get(tagId)?.delete(userId);
            }

            console.log(`[WS] User ${userId} disconnected`);
        },
    });
