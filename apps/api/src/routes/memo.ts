import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageByDocumentId } from '../repositories/page.repo';
import { yjsDocumentService } from '../services/yjs-document.service';
import type { JWTPayload } from '@maple/shared';

/**
 * Memo API routes
 * Handles Y.js memo initialization and state retrieval
 * Used by offline queue for syncing offline-created memos
 */
export const memoRoutes = new Elysia({ prefix: '/api/memos' })
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
     * Initialize memo with Y.js state
     * Used for first sync of offline-created memos
     */
    .post(
        '/:noteId/init',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;

            // Verify page exists and user has access (noteId is the documentId)
            const page = await findPageByDocumentId(noteId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Verify it's a notebook type (whiteboards use /api/whiteboards routes)
            if (page.type !== 'memo') {
                set.status = 400;
                return { error: 'Page type does not support memo sync' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const state = new Uint8Array(arrayBuffer);

                // Initialize memo with the state
                const mergedState = await yjsDocumentService.initializeNotebook(noteId, state);

                // Return merged state as base64
                const base64State = Buffer.from(mergedState).toString('base64');

                console.log(`[Memo] Initialized memo ${noteId} with ${state.length} bytes`);

                return {
                    success: true,
                    state: base64State,
                };
            } catch (error) {
                console.error(`[Memo] Failed to initialize ${noteId}:`, error);
                set.status = 500;
                return { error: 'Failed to initialize memo' };
            }
        },
        {
            type: 'arrayBuffer',
        },
    )
    /**
     * Get memo Y.js state
     * Used for fetching initial state when WebSocket is slow or unavailable
     */
    .get('/:noteId/state', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { noteId } = params;

        // Verify page exists and user has access (noteId is the documentId)
        const page = await findPageByDocumentId(noteId, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        // Verify it's a notebook type (whiteboards use /api/whiteboards routes)
        if (page.type !== 'memo') {
            set.status = 400;
            return { error: 'Page type does not support memo sync' };
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
            console.error(`[Memo] Failed to get state for ${noteId}:`, error);
            set.status = 500;
            return { error: 'Failed to get memo state' };
        }
    });
