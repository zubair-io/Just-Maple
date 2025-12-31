import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findNoteById } from '../repositories/note.repo';
import { yjsService } from '../services/yjs.service';
import type { JWTPayload } from '@maple/shared';
import type { ServerWebSocket } from 'bun';

interface CollabWSData {
    noteId: string;
    userId: string;
}

interface CollabWSContext {
    noteId: string;
    userId: string;
    userName: string;
    initialized: boolean;
    messageBuffer: ArrayBuffer[];
}

// Create WebSocket Elysia plugin for collaboration
export const collaborationWebSocket = new Elysia({ prefix: '/ws' })
    .use(
        jwt({
            name: 'jwt',
            secret: config.jwtSecret,
        }),
    )
    .ws('/collab/:noteId', {
        async open(ws) {
            // Get token from query string
            const url = new URL(ws.data.request.url);
            const token = url.searchParams.get('token');
            const noteId = ws.data.params.noteId;

            console.log(`[Collab WS] Opening connection for noteId: ${noteId}`);
            console.log(`[Collab WS] Full URL: ${ws.data.request.url}`);

            // Initialize context immediately to buffer messages during async initialization
            (ws.data as unknown as { context: CollabWSContext }).context = {
                noteId: noteId || '',
                userId: '',
                userName: '',
                initialized: false,
                messageBuffer: [],
            };

            if (!token) {
                console.log('[Collab WS] Missing authentication token');
                ws.close(4001, 'Missing authentication token');
                return;
            }

            if (!noteId) {
                console.log('[Collab WS] Missing note ID');
                ws.close(4002, 'Missing note ID');
                return;
            }

            try {
                // Verify JWT token
                console.log('[Collab WS] Verifying JWT token...');
                const payload = (await ws.data.jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    console.log('[Collab WS] Invalid token');
                    ws.close(4001, 'Invalid token');
                    return;
                }
                console.log(`[Collab WS] JWT verified for user: ${payload.sub}`);

                // Verify user exists
                console.log(`[Collab WS] Finding user by ID: ${payload.sub}`);
                const user = await findUserById(payload.sub);
                if (!user) {
                    console.log('[Collab WS] User not found');
                    ws.close(4001, 'User not found');
                    return;
                }
                console.log(`[Collab WS] User found: ${user.email}`);

                // Verify note exists and user has access
                console.log(`[Collab WS] Finding note by ID: ${noteId} for user: ${user._id}`);
                const note = await findNoteById(noteId, user._id);
                if (!note) {
                    console.log(`[Collab WS] Note not found or no access for ID: ${noteId}`);
                    ws.close(4003, 'Note not found or access denied');
                    return;
                }
                console.log(`[Collab WS] Note found: ${note._id}`);

                // Check if user has access to this note
                // TODO: Add proper permission check based on tagId sharing
                if (note.userId !== user._id && note.tagId) {
                    // For now, allow access if user is part of the tag
                    // You may want to add a proper checkNoteAccess function
                }

                const userId = user._id;
                const userName = user.displayName || user.email.split('@')[0];

                // Store WebSocket data for later use
                (ws.data as unknown as { collabData: CollabWSData }).collabData = {
                    noteId,
                    userId,
                };

                // Update connection context with auth info
                const context = (ws.data as unknown as { context: CollabWSContext }).context;
                context.userId = userId;
                context.userName = userName;

                // Get or create Y.Doc for this note
                const ydoc = await yjsService.getOrCreateDoc(noteId);

                // Add this connection to the document
                yjsService.addConnection(noteId, ws as ServerWebSocket<CollabWSData>);

                // Send sync step 1 (full document state) using y-protocols
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, 0); // messageSync
                syncProtocol.writeSyncStep1(encoder, ydoc);
                // CRITICAL: Convert to Buffer for binary WebSocket transmission
                ws.send(Buffer.from(encoding.toUint8Array(encoder)));

                console.log(`[Collab WS] User ${userName} (${userId}) connected to note ${noteId}`);

                // Mark as initialized
                context.initialized = true;

                // Log buffered messages (client will retry if needed)
                if (context.messageBuffer.length > 0) {
                    console.log(
                        `[Collab WS] Discarded ${context.messageBuffer.length} messages that arrived during initialization - client will retry`,
                    );
                    context.messageBuffer = [];
                }
            } catch (error) {
                console.error('[Collab WS] Connection error:', error);
                ws.close(4001, 'Authentication failed');
            }
        },

        async message(ws, message) {
            const context = (ws.data as unknown as { context: CollabWSContext }).context;
            if (!context) {
                console.warn('[Collab WS] No context for message - connection not initialized yet');
                ws.close(4000, 'Connection not properly initialized');
                return;
            }

            // If not initialized yet, buffer the message
            if (!context.initialized) {
                console.log('[Collab WS] Buffering message until initialization complete');
                context.messageBuffer.push(message as ArrayBuffer);
                return;
            }

            try {
                // Convert message to Uint8Array
                const data =
                    message instanceof Uint8Array
                        ? message
                        : new Uint8Array(message as ArrayBuffer);

                console.log(
                    `[Collab WS] Received message from ${context.userName}, length: ${data.length}`,
                );

                // Decode using lib0
                const decoder = decoding.createDecoder(data);
                const messageType = decoding.readVarUint(decoder);

                console.log(`[Collab WS] Message type: ${messageType}`);

                const noteId = context.noteId;
                const ydoc = await yjsService.getOrCreateDoc(noteId);

                const encoder = encoding.createEncoder();

                switch (messageType) {
                    case 0: {
                        // messageSync - Read the sync message type
                        const peekDecoder = decoding.clone(decoder);
                        const syncMsgType = decoding.readVarUint(peekDecoder);
                        console.log(
                            `[Collab WS] Processing sync message, type: ${syncMsgType} (0=step1, 1=step2, 2=update)`,
                        );

                        encoding.writeVarUint(encoder, 0); // messageSync
                        // CRITICAL: Pass WebSocket as transaction origin so Y.Doc update event can skip broadcasting to sender
                        syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);

                        // If encoder has content, send response
                        if (encoding.length(encoder) > 1) {
                            const response = encoding.toUint8Array(encoder);
                            console.log(
                                `[Collab WS] Sending sync response, length: ${response.length}`,
                            );
                            // CRITICAL: Convert Uint8Array to Buffer for binary WebSocket transmission
                            ws.send(Buffer.from(response));
                        } else {
                            console.log('[Collab WS] No sync response needed');
                        }
                        break;
                    }

                    case 1: {
                        // messageAwareness
                        console.log('[Collab WS] Processing awareness message');

                        // Broadcast entire awareness message to other clients (already encoded)
                        yjsService.broadcastRaw(noteId, data, ws as ServerWebSocket<CollabWSData>);
                        break;
                    }

                    default:
                        console.warn(`[Collab WS] Unknown message type: ${messageType}`);
                }
            } catch (error) {
                console.error('[Collab WS] Message handling error:', error);
                console.error('[Collab WS] Stack:', (error as Error).stack);
            }
        },

        close(ws) {
            const context = (ws.data as unknown as { context: CollabWSContext }).context;
            if (!context) return;

            const { noteId, userId, userName } = context;

            // Remove connection from document
            yjsService.removeConnection(noteId, ws as ServerWebSocket<CollabWSData>);

            console.log(
                `[Collab WS] User ${userName} (${userId}) disconnected from note ${noteId}`,
            );
        },
    });
