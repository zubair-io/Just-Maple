import { Elysia, t } from 'elysia';
import { jwtPlugin } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNoteByDocumentId } from '../repositories/note.repo';
import { notebookExists, createNotebook } from '../repositories/notebook.repo';
import type { JWTPayload } from '@maple/shared';
import { yjsDocumentService } from '../services/yjs-document.service';
import { yjsSSEService } from '../services/yjs-sse.service';
import { customAlphabet } from 'nanoid';

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

/**
 * Notebook Events Routes
 * SSE streaming for Y.Doc collaboration
 */
export const notebookEventsRoutes = new Elysia({ prefix: '/sse/notebook' })
    .use(jwtPlugin)

    /**
     * SSE stream for notebook collaboration
     * GET /sse/notebook/:noteId/events?token=xxx&clientId=xxx
     */
    .get(
        '/:noteId/events',
        async ({ jwt, params, query, set, request }) => {
            const { noteId } = params;
            const { token, clientId: providedClientId } = query;

            // Validate token
            if (!token) {
                set.status = 401;
                return { error: 'Missing token' };
            }

            try {
                const payload = (await jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Verify note exists and user has access
                const note = await findNoteByDocumentId(noteId, user._id);
                if (!note) {
                    set.status = 404;
                    return { error: 'Note not found or access denied' };
                }

                // Verify this is a notebook-type note
                if (note.type !== 'notebook') {
                    set.status = 400;
                    return { error: 'Note is not a notebook type' };
                }

                const clientId = providedClientId || nanoid();
                const userId = user._id;
                const userName = user.name || user.email || 'Anonymous';
                const userColor = getUserColor(userId);

                console.log(
                    `[Notebook SSE] Creating stream for note ${noteId}, client ${clientId}, user ${userId}`,
                );

                // Create SSE stream
                const stream = new ReadableStream({
                    async start(controller) {
                        // Register client with SSE service
                        yjsSSEService.registerClient(noteId, clientId, controller, {
                            userId,
                            userName,
                            userColor,
                        });

                        // Get initial document state
                        const state = await yjsDocumentService.getStateAsUpdate(noteId);
                        const notebook = await notebookExists(noteId);
                        const version = notebook ? 1 : 0;

                        // Send initial state
                        yjsSSEService.sendInitialState(noteId, clientId, state, version);

                        // Keep-alive ping every 15 seconds
                        const keepAlive = setInterval(() => {
                            try {
                                controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
                            } catch {
                                clearInterval(keepAlive);
                            }
                        }, 15000);

                        // Clean up on disconnect
                        request.signal.addEventListener('abort', () => {
                            clearInterval(keepAlive);
                            yjsSSEService.unregisterClient(noteId, clientId);
                            try {
                                controller.close();
                            } catch {}
                        });
                    },

                    cancel() {
                        yjsSSEService.unregisterClient(noteId, clientId);
                    },
                });

                return new Response(stream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        'X-Client-Id': clientId,
                    },
                });
            } catch (error) {
                console.error('[Notebook SSE] Error:', error);
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
            query: t.Object({
                token: t.String(),
                clientId: t.Optional(t.String()),
            }),
        },
    )

    /**
     * Receive Y.Doc update from client
     * POST /sse/notebook/:noteId/update?clientId=xxx
     */
    .post(
        '/:noteId/update',
        async ({ jwt, params, query, body, request, set }) => {
            const { noteId } = params;
            const { clientId } = query;

            // Auth from header
            const authHeader = request.headers.get('authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const token = authHeader.slice(7);
            try {
                const payload = (await jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Verify note exists and user has write access
                const note = await findNoteByDocumentId(noteId, user._id);
                if (!note) {
                    set.status = 404;
                    return { error: 'Note not found or access denied' };
                }

                // Convert body to Uint8Array
                let update: Uint8Array;
                if (body instanceof ArrayBuffer) {
                    update = new Uint8Array(body);
                } else if (body instanceof Uint8Array) {
                    update = body;
                } else {
                    set.status = 400;
                    return { error: 'Invalid update format' };
                }

                // Apply update to Y.Doc
                await yjsDocumentService.applyUpdate(noteId, update, clientId);

                return { success: true };
            } catch (error) {
                console.error('[Notebook Update] Error:', error);
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
            query: t.Object({
                clientId: t.String(),
            }),
            type: 'arrayBuffer',
        },
    )

    /**
     * Initialize notebook (for first sync of offline-created notebook)
     * POST /sse/notebook/:noteId/init
     */
    .post(
        '/:noteId/init',
        async ({ jwt, params, body, request, set }) => {
            const { noteId } = params;

            // Auth from header
            const authHeader = request.headers.get('authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const token = authHeader.slice(7);
            try {
                const payload = (await jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Verify note exists and user has write access
                const note = await findNoteByDocumentId(noteId, user._id);
                if (!note) {
                    set.status = 404;
                    return { error: 'Note not found or access denied' };
                }

                // Convert body to Uint8Array
                let initialState: Uint8Array;
                if (body instanceof ArrayBuffer) {
                    initialState = new Uint8Array(body);
                } else if (body instanceof Uint8Array) {
                    initialState = body;
                } else {
                    set.status = 400;
                    return { error: 'Invalid state format' };
                }

                // Initialize or merge notebook
                const mergedState = await yjsDocumentService.initializeNotebook(
                    noteId,
                    initialState,
                );

                // Return merged state as base64
                return {
                    success: true,
                    state: Buffer.from(mergedState).toString('base64'),
                    version: 1,
                };
            } catch (error) {
                console.error('[Notebook Init] Error:', error);
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
            type: 'arrayBuffer',
        },
    )

    /**
     * Get notebook state (for manual sync/recovery)
     * GET /sse/notebook/:noteId/state
     */
    .get(
        '/:noteId/state',
        async ({ jwt, params, request, set }) => {
            const { noteId } = params;

            // Auth from header
            const authHeader = request.headers.get('authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const token = authHeader.slice(7);
            try {
                const payload = (await jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Verify note exists and user has access
                const note = await findNoteByDocumentId(noteId, user._id);
                if (!note) {
                    set.status = 404;
                    return { error: 'Note not found or access denied' };
                }

                // Get document state
                const state = await yjsDocumentService.getStateAsUpdate(noteId);

                return {
                    state: Buffer.from(state).toString('base64'),
                    noteId,
                };
            } catch (error) {
                console.error('[Notebook State] Error:', error);
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
        },
    )

    /**
     * Get room statistics (connected peers)
     * GET /sse/notebook/:noteId/peers
     */
    .get(
        '/:noteId/peers',
        async ({ jwt, params, request, set }) => {
            const { noteId } = params;

            // Auth from header
            const authHeader = request.headers.get('authorization');
            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const token = authHeader.slice(7);
            try {
                const payload = (await jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }

                const clientCount = yjsSSEService.getClientCount(noteId);
                const clientIds = yjsSSEService.getClientIds(noteId);

                return {
                    noteId,
                    peerCount: clientCount,
                    peers: clientIds,
                };
            } catch (error) {
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
        },
    );
