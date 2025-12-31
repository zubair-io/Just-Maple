import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findNoteById } from '../repositories/note.repo';
import { otService } from '../services/ot.service';
import type { JWTPayload } from '@maple/shared';

interface CollabWSContext {
    clientID: string;
    noteId: string;
    userId: string;
}

export const collabOTWebSocket = new Elysia({ prefix: '/ws' })
    .use(jwt({ name: 'jwt', secret: config.jwtSecret }))
    .ws('/collab/:noteId', {
        async open(ws) {
            const url = new URL(ws.data.request.url);
            const token = url.searchParams.get('token');
            const noteId = ws.data.params.noteId;

            if (!token || !noteId) {
                ws.close(4001, 'Missing auth or noteId');
                return;
            }

            try {
                const payload = (await ws.data.jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    ws.close(4001, 'Invalid token');
                    return;
                }

                const user = await findUserById(payload.sub);
                if (!user) {
                    ws.close(4001, 'User not found');
                    return;
                }

                const note = await findNoteById(noteId, user._id);
                if (!note) {
                    ws.close(4003, 'Note not found');
                    return;
                }

                const clientID = `${user._id}-${Date.now()}`;

                // Store connection context
                (ws.data as unknown as { context: CollabWSContext }).context = {
                    clientID,
                    noteId,
                    userId: user._id,
                };

                const doc = await otService.getDocument(noteId);
                otService.addConnection(noteId, clientID, ws);

                // Send initial version, document state, and clientID
                ws.send(
                    JSON.stringify({
                        type: 'init',
                        version: doc.version,
                        doc: doc.version === 0 ? note.content : doc.currentDoc,
                        clientID, // Send assigned clientID to the client
                    }),
                );

                console.log(`[Collab OT] User ${user.email} connected to note ${noteId}`);
            } catch (error) {
                console.error('[Collab OT] Connection error:', error);
                ws.close(4001, 'Auth failed');
            }
        },

        async message(ws, message) {
            try {
                // Handle message as string or object
                const data = typeof message === 'string' ? JSON.parse(message) : message;
                const context = (ws.data as unknown as { context: CollabWSContext }).context;

                if (!context) {
                    console.error('[Collab OT] No context found');
                    return;
                }

                const { noteId, clientID } = context;

                if (data.type === 'steps') {
                    // Steps are already JSON objects, no need to deserialize
                    // We'll handle this as plain data since we don't have a schema on the backend
                    const result = await otService.receiveSteps(
                        noteId,
                        data.steps, // Pass as-is (JSON objects)
                        data.version,
                        clientID,
                        data.doc, // Client's current document state (optional)
                    );

                    // Send result back (ACK or catch-up or resync)
                    if (result) {
                        if (result.resync) {
                            ws.send(JSON.stringify({ type: 'resync' }));
                        } else {
                            ws.send(
                                JSON.stringify({
                                    type: 'steps',
                                    version: result.version,
                                    steps: result.steps, // Already JSON
                                    clientIDs: result.clientIDs,
                                    clientID: result.clientIDs[0], // Fallback for singular
                                }),
                            );
                        }
                    }
                }
            } catch (error) {
                console.error('[Collab OT] Message error:', error);
            }
        },

        close(ws) {
            const context = (ws.data as unknown as { context: CollabWSContext }).context;
            if (context) {
                const { noteId, clientID } = context;
                otService.removeConnection(noteId, clientID);
                console.log(`[Collab OT] Client ${clientID} disconnected from note ${noteId}`);
            }
        },
    });
