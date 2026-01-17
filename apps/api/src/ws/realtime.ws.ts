import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findTagsByUserId, findTagByIdWithAccess } from '../repositories/tag.repo';
import { findUserById } from '../repositories/user.repo';
import { findNoteByDocumentId } from '../repositories/note.repo';
import { createMessage } from '../repositories/message.repo';
import { authenticateWebSocket } from './ws-auth';
import { realtimeWSService, type AppEvent } from '../services/realtime-ws.service';
import { yjsDocumentService } from '../services/yjs-document.service';
import { broadcastChatEvent } from '../services/realtime.service';
import { customAlphabet } from 'nanoid';
import type { ChatEvent, TypingEvent, NoteContent } from '@maple/shared';

// Generate client IDs
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 16);

// User colors for cursors
const USER_COLORS = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#96CEB4',
    '#FFEAA7',
    '#DDA0DD',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E9',
];

function getUserColor(userId: string): string {
    const hash = userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return USER_COLORS[hash % USER_COLORS.length];
}

// WebSocket context stored per connection
interface WSContext {
    userId: string;
    email: string;
    userName: string;
    userColor: string;
    connection: ReturnType<typeof realtimeWSService.registerConnection>;
    subscribedTags: Set<string>;
    notebookClients: Map<string, string>; // noteId -> clientId
}

/**
 * Unified Realtime WebSocket
 * Single endpoint for all real-time communication:
 * - App events (notes/tags/papers CRUD)
 * - Chat/typing indicators
 * - Notebook Y.Doc sync
 */
export const realtimeWebSocket = new Elysia({ prefix: '/ws' })
    .use(
        jwt({
            name: 'jwt',
            secret: config.jwtSecret,
        }),
    )
    .ws('/realtime', {
        async open(ws) {
            // Authenticate user
            const auth = await authenticateWebSocket(ws);
            if (!auth) {
                return; // Connection already closed by authenticateWebSocket
            }

            try {
                const { userId, email } = auth;

                // Get user info
                const user = await findUserById(userId);
                const userName = user?.name || email || 'Anonymous';
                const userColor = getUserColor(userId);

                // Auto-subscribe to user's tags for chat
                const tags = await findTagsByUserId(userId);
                const tagIds = tags.map((t) => t._id);

                // Register connection with service (including subscribed tags)
                const connection = realtimeWSService.registerConnection(
                    userId,
                    ws.raw as unknown as WebSocket,
                    tagIds,
                );

                // Store connection context
                (ws.data as unknown as { context: WSContext }).context = {
                    userId,
                    email,
                    userName,
                    userColor,
                    connection,
                    subscribedTags: new Set(tagIds),
                    notebookClients: new Map(),
                };

                // Send connection confirmation
                ws.send(
                    JSON.stringify({
                        channel: 'system',
                        event: {
                            type: 'connected',
                            userId,
                            subscribedTags: tags.map((t) => t._id),
                        },
                    }),
                );
            } catch (error) {
                console.error('WebSocket connection error:', error);
                ws.close(4001, 'Connection setup failed');
            }
        },

        async message(ws, message) {
            const context = (ws.data as unknown as { context: WSContext }).context;
            if (!context) return;

            try {
                const data = typeof message === 'string' ? JSON.parse(message) : message;
                const { channel, action, ...payload } = data;

                switch (channel) {
                    case 'notebook':
                        await handleNotebookMessage(ws, context, action, payload);
                        break;

                    case 'chat':
                        await handleChatMessage(ws, context, action, payload);
                        break;

                    case 'system':
                        handleSystemMessage(ws, context, action, payload);
                        break;

                    default:
                        break;
                }
            } catch {
                // Message parse error
            }
        },

        close(ws) {
            const context = (ws.data as unknown as { context: WSContext }).context;
            if (!context) return;

            // Leave all notebook rooms
            for (const [noteId, clientId] of context.notebookClients) {
                realtimeWSService.leaveNotebook(noteId, ws.raw as unknown as WebSocket);
            }

            // Unregister connection
            realtimeWSService.unregisterConnection(context.userId, context.connection);
        },
    });

/**
 * Handle notebook channel messages
 */
async function handleNotebookMessage(
    ws: any,
    context: WSContext,
    action: string,
    payload: any,
): Promise<void> {
    switch (action) {
        case 'join': {
            const { noteId } = payload;
            if (!noteId) return;

            // Verify user has access to this notebook
            const note = await findNoteByDocumentId(noteId, context.userId);
            if (!note || note.type !== 'notebook') {
                ws.send(
                    JSON.stringify({
                        channel: 'notebook',
                        event: { type: 'error', message: 'Note not found or access denied' },
                    }),
                );
                return;
            }

            // Generate client ID for this notebook session
            const clientId = payload.clientId || nanoid();

            // Join room
            realtimeWSService.joinNotebook(noteId, clientId, ws.raw as unknown as WebSocket, {
                userId: context.userId,
                userName: context.userName,
                userColor: context.userColor,
            });

            // Track in context
            context.notebookClients.set(noteId, clientId);
            context.connection.subscribedNotebooks.add(noteId);

            // Get initial state
            const state = await yjsDocumentService.getStateAsUpdate(noteId);

            // Send initial state
            realtimeWSService.sendInitialState(noteId, clientId, state, 1);

            // Send join confirmation with clientId
            ws.send(
                JSON.stringify({
                    channel: 'notebook',
                    event: {
                        type: 'joined',
                        noteId,
                        clientId,
                    },
                }),
            );
            break;
        }

        case 'leave': {
            const { noteId } = payload;
            if (!noteId) return;

            realtimeWSService.leaveNotebook(noteId, ws.raw as unknown as WebSocket);
            context.notebookClients.delete(noteId);
            context.connection.subscribedNotebooks.delete(noteId);
            break;
        }

        case 'update': {
            const { noteId, update: updateBase64 } = payload;
            if (!noteId || !updateBase64) return;

            const clientId = context.notebookClients.get(noteId);
            if (!clientId) {
                // Not subscribed to this notebook
                return;
            }

            // Decode update
            const update = base64ToUint8Array(updateBase64);

            // Apply update to Y.Doc and broadcast to other clients
            await yjsDocumentService.applyUpdate(noteId, update, clientId);

            // Broadcast to other clients in the room
            realtimeWSService.broadcastUpdate(noteId, update, clientId);
            break;
        }

        case 'awareness': {
            const { noteId, update: awarenessBase64 } = payload;
            if (!noteId || !awarenessBase64) return;

            const clientId = context.notebookClients.get(noteId);
            if (!clientId) {
                // Not subscribed to this notebook
                return;
            }

            // Decode awareness update
            const awarenessUpdate = base64ToUint8Array(awarenessBase64);

            // Broadcast awareness to other clients in the room (don't persist)
            realtimeWSService.broadcastAwareness(noteId, awarenessUpdate, clientId);
            break;
        }

        default:
            break;
    }
}

/**
 * Handle chat channel messages
 */
async function handleChatMessage(
    ws: any,
    context: WSContext,
    action: string,
    payload: any,
): Promise<void> {
    switch (action) {
        case 'message': {
            const { tagId, content } = payload as { tagId: string; content: NoteContent };
            if (!tagId || !content) {
                ws.send(
                    JSON.stringify({
                        channel: 'chat',
                        event: { type: 'error', message: 'Missing tagId or content' },
                    }),
                );
                return;
            }

            // Verify user has write access to this tag
            const tag = await findTagByIdWithAccess(tagId, context.userId, 'write');
            if (!tag) {
                ws.send(
                    JSON.stringify({
                        channel: 'chat',
                        event: { type: 'error', message: 'Access denied' },
                    }),
                );
                return;
            }

            // Get user info for the message
            const user = await findUserById(context.userId);

            // Create the message in the database
            const message = await createMessage(
                tagId,
                context.userId,
                { content },
                user?.email,
                user?.displayName,
                user?.profilePictureUrl,
            );

            // Broadcast to all users subscribed to this tag (including sender)
            const chatEvent: ChatEvent = {
                action: 'message',
                data: message,
                tagId,
                userId: context.userId,
                timestamp: new Date().toISOString(),
            };

            broadcastChatEvent(tagId, chatEvent).catch(console.error);
            break;
        }

        case 'typing': {
            const { tagId, isTyping } = payload;
            if (!tagId || !context.subscribedTags.has(tagId)) return;

            const typingEvent: TypingEvent = {
                tagId,
                userId: context.userId,
                isTyping: isTyping ?? true,
            };

            const chatEvent: ChatEvent = {
                action: 'typing',
                data: typingEvent,
                tagId,
                userId: context.userId,
                timestamp: new Date().toISOString(),
            };

            // Broadcast to all users subscribed to this tag
            broadcastChatEventToTag(tagId, chatEvent, context.userId);
            break;
        }

        case 'subscribe': {
            const { tagId } = payload;
            if (tagId && !context.subscribedTags.has(tagId)) {
                context.subscribedTags.add(tagId);
                context.connection.subscribedTags.add(tagId);
            }
            break;
        }

        case 'unsubscribe': {
            const { tagId } = payload;
            if (tagId) {
                context.subscribedTags.delete(tagId);
                context.connection.subscribedTags.delete(tagId);
            }
            break;
        }
    }
}

/**
 * Handle system channel messages
 */
function handleSystemMessage(ws: any, context: WSContext, action: string, payload: any): void {
    switch (action) {
        case 'ping': {
            ws.send(JSON.stringify({ channel: 'system', event: { type: 'pong' } }));
            break;
        }
    }
}

/**
 * Broadcast chat event to all users subscribed to a tag
 */
function broadcastChatEventToTag(tagId: string, event: ChatEvent, excludeUserId: string): void {
    // Get all connections and check if they're subscribed to this tag
    const connections = realtimeWSService.getAllConnections();

    for (const [userId, userConns] of connections) {
        if (userId === excludeUserId) continue;

        for (const conn of userConns) {
            // Check if this connection is subscribed to the tag
            if (conn.subscribedTags.has(tagId)) {
                try {
                    conn.ws.send(
                        JSON.stringify({
                            channel: 'chat',
                            event,
                        }),
                    );
                } catch {
                    // Connection might be closed
                }
            }
        }
    }
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}
