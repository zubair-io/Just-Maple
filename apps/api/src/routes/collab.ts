import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findNoteById } from '../repositories/note.repo';
import { otService } from '../services/ot.service';
import type { JWTPayload } from '@maple/shared';

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
        const clientID = `${auth.user._id}-${Date.now()}`;

        // Get document state
        const doc = await otService.getDocument(noteId);

        // Register connection (for SignalR, we don't have WS connection)
        otService.addConnection(noteId, clientID, { userId: auth.user._id });

        console.log(`[Collab Routes] User ${auth.user._id} joined note ${noteId}`);

        // Return init data (client will also receive via SignalR)
        return {
            type: 'init',
            version: doc.version,
            doc: doc.version === 0 ? note.content : doc.currentDoc,
            clientID,
        };
    })
    .post('/:noteId/steps', async ({ auth, params, body, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { noteId } = params;
        const { version, steps, doc } = body as any;

        const note = await findNoteById(noteId, auth.user._id);
        if (!note) {
            set.status = 404;
            return { error: 'Note not found' };
        }

        // Use temporary clientID based on userId
        const clientID = `http-${auth.user._id}-${Date.now()}`;

        console.log(
            `[Collab Routes] Received ${steps?.length || 0} steps from ${auth.user._id} for note ${noteId}`,
        );

        // Process steps
        const result = await otService.receiveSteps(noteId, steps, version, clientID, doc);

        if (!result) {
            return { success: true };
        }

        return result;
    });
