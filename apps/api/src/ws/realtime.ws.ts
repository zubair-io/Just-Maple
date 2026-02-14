import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import {
    findNotebooksByUserId,
    findNotebookByIdWithAccess,
    getUsersWithNotebookAccess,
    getNotebookMembers,
} from '../repositories/notebook.repo';
import { sendMessageReceivedNotification } from '../services/notification.service';
import { findUserById } from '../repositories/user.repo';
import { findPageById, findOrCreateMessagesPage } from '../repositories/page.repo';
import { createMessage } from '../repositories/message.repo';
import {
    findCollectableById,
    createCollectable,
    updateCollectable,
    deleteCollectable,
} from '../repositories/collectable.repo';
import { authenticateWebSocket } from './ws-auth';
import { realtimeWSService, type AppEvent } from '../services/realtime-ws.service';
import { yjsDocumentService } from '../services/yjs-document.service';
import { yjsWhiteboardService } from '../services/yjs-whiteboard.service';
import { yjsKanbanService } from '../services/yjs-kanban.service';
import { findMemoById } from '../repositories/memo.repo';
import {
    broadcastChatEvent,
    subscribeToNotebookChat,
    unsubscribeFromNotebookChat,
} from '../services/realtime.service';
import { customAlphabet } from 'nanoid';
import type { ChatEvent, TypingEvent, PageContent } from '@maple/shared';

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
    '#BB8FCE',
    '#85C1E9',
];

function getUserColor(userId: string): string {
    const hash = userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return USER_COLORS[hash % USER_COLORS.length];
}

// Per-memo client info (tracks access level)
interface MemoClientInfo {
    clientId: string;
    canWrite: boolean;
}

// WebSocket context stored per connection
interface WSContext {
    userId: string;
    email: string;
    userName: string;
    userColor: string;
    connection: ReturnType<typeof realtimeWSService.registerConnection>;
    subscribedNotebooks: Set<string>;
    memoClients: Map<string, MemoClientInfo>; // noteId -> client info (for Y.Doc memo sync)
}

/**
 * Unified Realtime WebSocket
 * Single endpoint for all real-time communication:
 * - App events (pages/notebooks/collectables CRUD)
 * - Chat/typing indicators
 * - Memo Y.Doc sync
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

                // Auto-subscribe to user's notebooks for chat
                const notebooks = await findNotebooksByUserId(userId);
                const notebookIds = notebooks.map((n) => n._id);

                // Register connection with service (including subscribed notebooks)
                const connection = realtimeWSService.registerConnection(
                    userId,
                    ws.raw as unknown as WebSocket,
                    notebookIds,
                );

                // Store connection context
                (ws.data as unknown as { context: WSContext }).context = {
                    userId,
                    email,
                    userName,
                    userColor,
                    connection,
                    subscribedNotebooks: new Set(notebookIds),
                    memoClients: new Map(),
                };

                // Subscribe to Redis channels for user's notebooks (for cross-replica sync)
                for (const notebookId of notebookIds) {
                    subscribeToNotebookChat(notebookId).catch(() => {});
                }

                // Send connection confirmation
                ws.send(
                    JSON.stringify({
                        channel: 'system',
                        event: {
                            type: 'connected',
                            userId,
                            subscribedNotebooks: notebooks.map((n) => n._id),
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
                    case 'memo':
                        await handleMemoMessage(ws, context, action, payload);
                        break;

                    case 'chat':
                        await handleChatMessage(ws, context, action, payload);
                        break;

                    case 'app':
                        await handleAppMessage(ws, context, action, payload);
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

            // Leave all memo rooms
            for (const [noteId] of context.memoClients) {
                realtimeWSService.leaveNotebook(noteId, ws.raw as unknown as WebSocket);
            }

            // Unregister connection
            realtimeWSService.unregisterConnection(context.userId, context.connection);

            // Check if we should unsubscribe from Redis channels
            for (const notebookId of context.subscribedNotebooks) {
                unsubscribeFromNotebookChat(notebookId).catch(() => {});
            }
        },
    });

/**
 * Handle memo channel messages (Y.Doc sync for notebook and whiteboard pages)
 */
async function handleMemoMessage(
    ws: any,
    context: WSContext,
    action: string,
    payload: any,
): Promise<void> {
    switch (action) {
        case 'join': {
            // Accept both noteId and pageId for backwards compatibility
            const noteId = payload.noteId || payload.pageId;
            const parentPageId = payload.parentPageId; // For embedded whiteboards
            if (!noteId) return;

            console.log(`[Memo] Join request for noteId: ${noteId}, parentPageId: ${parentPageId}`);

            // Verify user has access to this page (must be memo, whiteboard, or kanban type)
            let page = await findPageById(noteId, context.userId);

            // If no page found, check if this is a card memo (memo.pageId references parent kanban page)
            if (!page) {
                const memo = await findMemoById(noteId);
                if (memo) {
                    const parentPage = await findPageById(memo.pageId, context.userId);
                    if (parentPage && parentPage.type === 'kanban') {
                        console.log(
                            `[Memo] Card memo - authorized via parent kanban page: ${memo.pageId}`,
                        );
                        // Use 'memo' type so the YJS document service handles it
                        // Preserve notebookId from parent for access level check
                        page = { type: 'memo', notebookId: parentPage.notebookId } as any;
                    }
                }
            }

            // If no page found but parentPageId provided, check access to parent (embedded whiteboard)
            if (!page && parentPageId) {
                const parentPage = await findPageById(parentPageId, context.userId);
                if (parentPage && parentPage.type === 'memo') {
                    console.log(
                        `[Memo] Embedded whiteboard - authorized via parent memo: ${parentPageId}`,
                    );
                    // Create a virtual page object for embedded whiteboard
                    // Preserve notebookId from parent for access level check
                    page = { type: 'whiteboard', notebookId: parentPage.notebookId } as any;
                }
            }

            if (
                !page ||
                (page.type !== 'memo' && page.type !== 'whiteboard' && page.type !== 'kanban')
            ) {
                console.log(`[Memo] Access denied or not a memo/whiteboard/kanban page: ${noteId}`);
                ws.send(
                    JSON.stringify({
                        channel: 'memo',
                        event: { type: 'error', message: 'Page not found or access denied' },
                    }),
                );
                return;
            }

            // Determine if user has write access
            let canWrite = false;
            if (page.notebookId) {
                const writeNotebook = await findNotebookByIdWithAccess(
                    page.notebookId,
                    context.userId,
                    'write',
                );
                canWrite = !!writeNotebook;
            } else {
                // No notebook = user is the owner (findPageById already verified)
                canWrite = true;
            }

            // Generate client ID for this memo session
            const clientId = payload.clientId || nanoid();

            // Join room
            realtimeWSService.joinNotebook(noteId, clientId, ws.raw as unknown as WebSocket, {
                userId: context.userId,
                userName: context.userName,
                userColor: context.userColor,
            });

            // Track in context (including write access)
            context.memoClients.set(noteId, { clientId, canWrite });
            context.connection.subscribedNotebooks.add(noteId);

            // Get initial state from appropriate service based on page type
            let state: Uint8Array;
            if (page.type === 'whiteboard') {
                state = await yjsWhiteboardService.getStateAsUpdate(noteId);
            } else if (page.type === 'kanban') {
                state = await yjsKanbanService.getStateAsUpdate(noteId);
            } else {
                state = await yjsDocumentService.getStateAsUpdate(noteId);
            }
            console.log(
                `[Memo] Sending initial state for ${noteId} (${page.type}), size: ${state.length} bytes`,
            );

            // Send initial state
            realtimeWSService.sendInitialState(noteId, clientId, state, 1);

            // Send join confirmation with clientId and access level
            ws.send(
                JSON.stringify({
                    channel: 'memo',
                    pageId: noteId,
                    event: {
                        type: 'joined',
                        pageId: noteId,
                        clientId,
                        canWrite,
                    },
                }),
            );
            console.log(`[Memo] Join complete for ${noteId}, clientId: ${clientId}`);
            break;
        }

        case 'leave': {
            // Accept both noteId and pageId for backwards compatibility
            const noteId = payload.noteId || payload.pageId;
            if (!noteId) return;

            realtimeWSService.leaveNotebook(noteId, ws.raw as unknown as WebSocket);
            context.memoClients.delete(noteId);
            break;
        }

        case 'update': {
            // Accept both noteId and pageId for backwards compatibility
            const noteId = payload.noteId || payload.pageId;
            const { update: updateBase64, pageType } = payload;
            console.log(
                `[Memo] Update received for ${noteId}, pageType: ${pageType}, size: ${updateBase64?.length || 0}`,
            );

            if (!noteId || !updateBase64) {
                console.log(`[Memo] Update rejected - missing noteId or update`);
                return;
            }

            const memoClient = context.memoClients.get(noteId);
            if (!memoClient) {
                console.log(`[Memo] Update rejected - client not in memoClients for ${noteId}`);
                return;
            }

            // Enforce write access
            if (!memoClient.canWrite) {
                console.log(
                    `[Memo] Update rejected - user ${context.userId} has read-only access to ${noteId}`,
                );
                ws.send(
                    JSON.stringify({
                        channel: 'memo',
                        event: { type: 'error', message: 'Write access denied' },
                    }),
                );
                return;
            }

            const clientId = memoClient.clientId;

            // Decode update
            const update = base64ToUint8Array(updateBase64);
            console.log(`[Memo] Decoded update: ${update.length} bytes`);

            // Apply update to Y.Doc using appropriate service
            try {
                if (pageType === 'whiteboard') {
                    await yjsWhiteboardService.applyUpdate(noteId, update, clientId);
                } else if (pageType === 'kanban') {
                    await yjsKanbanService.applyUpdate(noteId, update, clientId);
                } else {
                    await yjsDocumentService.applyUpdate(noteId, update, clientId);
                }
                console.log(`[Memo] Applied update to ${pageType || 'memo'} service`);
            } catch (err) {
                console.error(`[Memo] Error applying update:`, err);
            }

            // Broadcast to other clients in the room
            const clientCount = realtimeWSService.getNotebookClientCount(noteId);
            console.log(`[Memo] Broadcasting update to ${clientCount} clients (excluding sender)`);
            realtimeWSService.broadcastUpdate(noteId, update, clientId);
            break;
        }

        case 'awareness': {
            // Accept both noteId and pageId for backwards compatibility
            const noteId = payload.noteId || payload.pageId;
            const { update: awarenessBase64 } = payload;
            if (!noteId || !awarenessBase64) return;

            const memoClient = context.memoClients.get(noteId);
            if (!memoClient) {
                // Not subscribed to this memo
                return;
            }

            // Decode awareness update
            const awarenessUpdate = base64ToUint8Array(awarenessBase64);

            // Broadcast awareness to other clients in the room (don't persist)
            realtimeWSService.broadcastAwareness(noteId, awarenessUpdate, memoClient.clientId);
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
            const { notebookId, content } = payload as { notebookId: string; content: PageContent };
            if (!notebookId || !content) {
                ws.send(
                    JSON.stringify({
                        channel: 'chat',
                        event: { type: 'error', message: 'Missing notebookId or content' },
                    }),
                );
                return;
            }

            // Verify user has write access to this notebook
            const notebook = await findNotebookByIdWithAccess(notebookId, context.userId, 'write');
            if (!notebook) {
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

            // Find or create the messages page for this notebook
            const messagesPage = await findOrCreateMessagesPage(notebookId, context.userId);

            // Create the message in the database
            const message = await createMessage(
                messagesPage.id, // pageId
                context.userId,
                { content },
                user?.email,
                user?.displayName,
                user?.profilePictureUrl,
                undefined, // threadId
                notebookId, // notebookId for backward compatibility
            );

            // Broadcast to all users subscribed to this notebook (including sender)
            const chatEvent: ChatEvent = {
                action: 'message',
                data: message,
                pageId: messagesPage.id,
                notebookId: notebookId,
                userId: context.userId,
                timestamp: new Date().toISOString(),
            };

            broadcastChatEvent(notebookId, chatEvent).catch(console.error);

            // Send push notifications to all notebook members except the author
            getNotebookMembers(notebookId, context.userId)
                .then((notebookMembers) => {
                    if (notebookMembers) {
                        const notificationPromises = notebookMembers
                            .filter((member) => member.userId !== context.userId)
                            .map((member) =>
                                sendMessageReceivedNotification(
                                    member.userId,
                                    notebookId,
                                    message._id,
                                    user?.email || context.email,
                                    user?.displayName,
                                    user?.profilePictureUrl,
                                    message.content,
                                ),
                            );
                        Promise.allSettled(notificationPromises).catch(console.error);
                    }
                })
                .catch(console.error);

            break;
        }

        case 'typing': {
            const { notebookId, isTyping } = payload;
            if (!notebookId || !context.subscribedNotebooks.has(notebookId)) return;

            const typingEvent: TypingEvent = {
                notebookId: notebookId,
                userId: context.userId,
                isTyping: isTyping ?? true,
            };

            const chatEvent: ChatEvent = {
                action: 'typing',
                data: typingEvent,
                notebookId: notebookId,
                userId: context.userId,
                timestamp: new Date().toISOString(),
            };

            // Broadcast to all users subscribed to this notebook
            broadcastChatEventToNotebook(notebookId, chatEvent, context.userId);
            break;
        }

        case 'subscribe': {
            const { notebookId } = payload;
            if (notebookId && !context.subscribedNotebooks.has(notebookId)) {
                context.subscribedNotebooks.add(notebookId);
                context.connection.subscribedTags.add(notebookId);
                // Subscribe to Redis channel for this notebook
                subscribeToNotebookChat(notebookId).catch(() => {});
            }
            break;
        }

        case 'unsubscribe': {
            const { notebookId } = payload;
            if (notebookId) {
                context.subscribedNotebooks.delete(notebookId);
                context.connection.subscribedTags.delete(notebookId);
                // Check if we should unsubscribe from Redis
                unsubscribeFromNotebookChat(notebookId).catch(() => {});
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
 * Broadcast chat event to all users subscribed to a notebook
 */
function broadcastChatEventToNotebook(
    notebookId: string,
    event: ChatEvent,
    excludeUserId: string,
): void {
    // Get all connections and check if they're subscribed to this notebook
    const connections = realtimeWSService.getAllConnections();

    for (const [userId, userConns] of connections) {
        if (userId === excludeUserId) continue;

        for (const conn of userConns) {
            // Check if this connection is subscribed to the notebook
            if (conn.subscribedTags.has(notebookId)) {
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
 * Handle app channel messages (collectables CRUD)
 */
async function handleAppMessage(
    ws: any,
    context: WSContext,
    action: string,
    payload: any,
): Promise<void> {
    switch (action) {
        case 'collectable.create': {
            const { tags, data } = payload;
            if (!data?.itemId || !data?.provider) {
                ws.send(
                    JSON.stringify({
                        channel: 'app',
                        event: { type: 'error', message: 'Missing required collectable data' },
                    }),
                );
                return;
            }

            // Verify user has write access to all notebooks
            for (const notebookId of tags || []) {
                const notebook = await findNotebookByIdWithAccess(
                    notebookId,
                    context.userId,
                    'write',
                );
                if (!notebook) {
                    ws.send(
                        JSON.stringify({
                            channel: 'app',
                            event: { type: 'error', message: 'Access denied to notebook' },
                        }),
                    );
                    return;
                }
            }

            const collectable = await createCollectable(context.userId, { tags, data });

            // Broadcast to all users with access to each notebook
            for (const notebookId of collectable.tags) {
                const recipientUserIds = await getUsersWithNotebookAccess(notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'collectable.created',
                    collectable,
                    notebookId,
                });
            }
            break;
        }

        case 'collectable.update': {
            const { collectableId, data, tags } = payload;
            if (!collectableId) {
                ws.send(
                    JSON.stringify({
                        channel: 'app',
                        event: { type: 'error', message: 'Missing collectableId' },
                    }),
                );
                return;
            }

            const collectable = await updateCollectable(collectableId, context.userId, {
                data,
                tags,
            });

            if (!collectable) {
                ws.send(
                    JSON.stringify({
                        channel: 'app',
                        event: { type: 'error', message: 'Collectable not found or access denied' },
                    }),
                );
                return;
            }

            // Broadcast to all users with access to each notebook
            for (const notebookId of collectable.tags) {
                const recipientUserIds = await getUsersWithNotebookAccess(notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'collectable.updated',
                    collectable,
                    notebookId,
                });
            }
            break;
        }

        case 'collectable.delete': {
            const { collectableId } = payload;
            if (!collectableId) {
                ws.send(
                    JSON.stringify({
                        channel: 'app',
                        event: { type: 'error', message: 'Missing collectableId' },
                    }),
                );
                return;
            }

            // Get collectable first to know which notebooks to broadcast to
            const collectable = await findCollectableById(collectableId, context.userId);
            if (!collectable) {
                ws.send(
                    JSON.stringify({
                        channel: 'app',
                        event: { type: 'error', message: 'Collectable not found or access denied' },
                    }),
                );
                return;
            }

            const deleted = await deleteCollectable(collectableId, context.userId);
            if (!deleted) {
                ws.send(
                    JSON.stringify({
                        channel: 'app',
                        event: { type: 'error', message: 'Failed to delete collectable' },
                    }),
                );
                return;
            }

            // Broadcast to all users with access to each notebook
            for (const notebookId of collectable.tags) {
                const recipientUserIds = await getUsersWithNotebookAccess(notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'collectable.deleted',
                    collectableId,
                    notebookId,
                });
            }
            break;
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
