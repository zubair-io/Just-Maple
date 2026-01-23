import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import {
    getWhiteboardState,
    whiteboardExists,
    updateWhiteboardState,
} from '../repositories/whiteboard.repo';
import { yjsWhiteboardService } from '../services/yjs-whiteboard.service';
import type { JWTPayload } from '@maple/shared';

/**
 * Whiteboard API routes
 * Handles Y.js whiteboard initialization and state retrieval
 * Uses separate 'whiteboards' collection from memos
 */
export const whiteboardRoutes = new Elysia({ prefix: '/api/whiteboards' })
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
     * Initialize whiteboard with Y.js state
     * Used for first sync of offline-created whiteboards
     */
    .post(
        '/:id/init',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id } = params;

            // Verify page exists and user has access
            const page = await findPageById(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Verify it's a whiteboard type
            if (page.type !== 'whiteboard') {
                set.status = 400;
                return { error: 'Page is not a whiteboard type' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const state = new Uint8Array(arrayBuffer);

                // Initialize whiteboard with the state
                const mergedState = await yjsWhiteboardService.initializeWhiteboard(id, state);

                // Return merged state as base64
                const base64State = Buffer.from(mergedState).toString('base64');

                console.log(`[Whiteboard] Initialized whiteboard ${id} with ${state.length} bytes`);

                return {
                    success: true,
                    state: base64State,
                };
            } catch (error) {
                console.error(`[Whiteboard] Failed to initialize ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to initialize whiteboard' };
            }
        },
        {
            type: 'arrayBuffer',
        },
    )
    /**
     * Get whiteboard Y.js state
     * Used for fetching initial state when WebSocket is slow or unavailable
     */
    .get('/:id/state', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { id } = params;

        // Verify page exists and user has access
        const page = await findPageById(id, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        // Verify it's a whiteboard type
        if (page.type !== 'whiteboard') {
            set.status = 400;
            return { error: 'Page is not a whiteboard type' };
        }

        try {
            // Get the current state
            const state = await yjsWhiteboardService.getStateAsUpdate(id);

            // Return as base64
            const base64State = Buffer.from(state).toString('base64');

            return {
                state: base64State,
            };
        } catch (error) {
            console.error(`[Whiteboard] Failed to get state for ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to get whiteboard state' };
        }
    });
