import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findNoteByDocumentId } from '../repositories/note.repo';
import { yjsDocumentService } from '../services/yjs-document.service';
import type { JWTPayload } from '@maple/shared';

/**
 * Notebook API routes
 * Handles Y.js notebook initialization and state retrieval
 * Used by offline queue for syncing offline-created notebooks
 */
export const notebookRoutes = new Elysia({ prefix: '/api/notebook' })
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
    /**
     * Initialize notebook with Y.js state
     * Used for first sync of offline-created notebooks
     */
    .post(
        '/:noteId/init',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;

            // Verify note exists and user has access (noteId is the documentId)
            const note = await findNoteByDocumentId(noteId, auth.user._id);
            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            // Verify it's a notebook type
            if (note.type !== 'notebook') {
                set.status = 400;
                return { error: 'Note is not a notebook type' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const state = new Uint8Array(arrayBuffer);

                // Initialize notebook with the state
                const mergedState = await yjsDocumentService.initializeNotebook(noteId, state);

                // Return merged state as base64
                const base64State = Buffer.from(mergedState).toString('base64');

                console.log(`[Notebook] Initialized notebook ${noteId} with ${state.length} bytes`);

                return {
                    success: true,
                    state: base64State,
                };
            } catch (error) {
                console.error(`[Notebook] Failed to initialize ${noteId}:`, error);
                set.status = 500;
                return { error: 'Failed to initialize notebook' };
            }
        },
        {
            type: 'arrayBuffer',
        },
    )
    /**
     * Get notebook Y.js state
     * Used for fetching initial state when WebSocket is slow or unavailable
     */
    .get('/:noteId/state', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { noteId } = params;

        // Verify note exists and user has access (noteId is the documentId)
        const note = await findNoteByDocumentId(noteId, auth.user._id);
        if (!note) {
            set.status = 404;
            return { error: 'Note not found' };
        }

        // Verify it's a notebook type
        if (note.type !== 'notebook') {
            set.status = 400;
            return { error: 'Note is not a notebook type' };
        }

        try {
            // Get the current state
            const state = await yjsDocumentService.getStateAsUpdate(noteId);

            // Return as base64
            const base64State = Buffer.from(state).toString('base64');

            return {
                state: base64State,
            };
        } catch (error) {
            console.error(`[Notebook] Failed to get state for ${noteId}:`, error);
            set.status = 500;
            return { error: 'Failed to get notebook state' };
        }
    });
