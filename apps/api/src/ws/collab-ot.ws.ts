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

                // Send initial version to client
                ws.send(
                    JSON.stringify({
                        type: 'init',
                        version: doc.version,
                        doc: note.content, // Send full ProseMirror JSON
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
                const data = JSON.parse(message as string);
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
                    );

                    // If client is behind, send missing steps
                    if (result) {
                        ws.send(
                            JSON.stringify({
                                type: 'steps',
                                version: result.version,
                                steps: result.steps.map((s: any) => s.toJSON()),
                            }),
                        );
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
