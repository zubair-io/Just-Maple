import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findNoteById } from '../repositories/note.repo';
import { otService } from '../services/ot.service';
import { automergeService } from '../services/automerge.service';
import { generateClientID } from '../utils/client-id';
import type { JWTPayload, CollabStepsRequest, CollabBatchRequest } from '@maple/shared';

export const collabRoutes = new Elysia({ prefix: '/api/collab' })
    .use(jwt({ name: 'jwt', secret: config.jwtSecret }))
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null };
        }

        const token = authHeader.split(' ')[1];
        const payload = (await jwt.verify(token)) as JWTPayload | false;

        if (!payload) {
            return { auth: null };
        }

        const user = await findUserById(payload.sub);
        return { auth: user ? { user } : null };
    })
    .post('/join/:noteId', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { noteId } = params;
        const note = await findNoteById(noteId, auth.user._id);

        if (!note) {
            set.status = 404;
            return { error: 'Note not found' };
        }

        // Generate client ID
        const clientID = generateClientID(auth.user._id, 'signalr');

        // Get document state
        const doc = await otService.getDocument(noteId);

        // Register connection (for SignalR, we don't have WS connection)
        otService.addConnection(noteId, clientID, { userId: auth.user._id });

        // Return init data (client will also receive via SignalR)
        return {
            type: 'init',
            version: doc.version,
            doc: doc.version === 0 ? note.content : doc.currentDoc,
            clientID,
        };
    })
    .post(
        '/:noteId/steps',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;
            const { version, steps, doc, clientID: providedClientID } = body;

            const note = await findNoteById(noteId, auth.user._id);
            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            // Use clientID from request (from join session) or generate fallback
            const clientID = providedClientID || generateClientID(auth.user._id, 'http');

            // Process steps
            const result = await otService.receiveSteps(noteId, steps, version, clientID, doc);

            if (!result) {
                return { success: true };
            }

            return result;
        },
        {
            body: t.Object({
                version: t.Number({ minimum: 0 }),
                steps: t.Array(t.Any(), { minItems: 1, maxItems: 50 }),
                doc: t.Any(),
                clientID: t.Optional(t.String()),
            }),
        },
    )
    .post(
        '/:noteId/steps/batch',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;
            const { stepsBatch, doc, clientID: providedClientID } = body;

            const note = await findNoteById(noteId, auth.user._id);
            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            // Use clientID from request (from join session) or generate fallback
            const clientID = providedClientID || generateClientID(auth.user._id, 'http');

            // Process each step group in order
            for (const stepGroup of stepsBatch) {
                const result = await otService.receiveSteps(
                    noteId,
                    stepGroup.steps,
                    stepGroup.version,
                    clientID,
                    doc,
                );

                // If server requests resync, stop processing and return
                if (result?.resync) {
                    return { resync: true };
                }
            }

            // All steps processed successfully
            return { success: true };
        },
        {
            body: t.Object({
                stepsBatch: t.Array(
                    t.Object({
                        version: t.Number({ minimum: 0 }),
                        steps: t.Array(t.Any(), { minItems: 1 }),
                    }),
                    { minItems: 1, maxItems: 100 }, // Limit batch size to prevent DoS
                ),
                doc: t.Any(),
                clientID: t.Optional(t.String()),
            }),
        },
    )
    .post(
        '/:noteId/automerge-sync',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;
            const { syncMessage, clientID: providedClientID } = body;

            // Verify access
            const note = await findNoteById(noteId, auth.user._id);
            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            // Use clientID from request or generate fallback
            const clientID = providedClientID || generateClientID(auth.user._id, 'automerge');

            // Convert base64 to binary
            const binaryMessage = Buffer.from(syncMessage, 'base64');

            // Process sync message
            const responseMessage = await automergeService.receiveSyncMessage(
                noteId,
                clientID,
                binaryMessage,
            );

            // Return response
            return {
                syncMessage: Buffer.from(responseMessage).toString('base64'),
            };
        },
        {
            body: t.Object({
                syncMessage: t.String(),
                clientID: t.Optional(t.String()),
            }),
        },
    );
