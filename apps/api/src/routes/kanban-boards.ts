import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import { findKanbanBoard, updateKanbanBoardSettings } from '../repositories/kanban-board.repo';
import { yjsKanbanService } from '../services/yjs-kanban.service';
import type { JWTPayload, KanbanSettings } from '@maple/shared';

/**
 * Kanban Board API routes
 * Handles Y.js kanban board initialization and state retrieval
 * Uses 'kanban_boards' collection
 */
export const kanbanBoardRoutes = new Elysia({ prefix: '/api/kanban-boards' })
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
     * Initialize kanban board with Y.js state
     * Used for first sync of offline-created boards
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

            // Verify it's a kanban type
            if (page.type !== 'kanban') {
                set.status = 400;
                return { error: 'Page is not a kanban type' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const state = new Uint8Array(arrayBuffer);

                // Initialize kanban board with the state
                const mergedState = await yjsKanbanService.initializeKanban(id, state);

                // Return merged state as base64
                const base64State = Buffer.from(mergedState).toString('base64');

                console.log(`[Kanban] Initialized kanban board ${id} with ${state.length} bytes`);

                return {
                    success: true,
                    state: base64State,
                };
            } catch (error) {
                console.error(`[Kanban] Failed to initialize ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to initialize kanban board' };
            }
        },
        {
            type: 'arrayBuffer',
        },
    )
    /**
     * Get kanban board Y.js state
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

        // Verify it's a kanban type
        if (page.type !== 'kanban') {
            set.status = 400;
            return { error: 'Page is not a kanban type' };
        }

        try {
            // Get the current state
            const state = await yjsKanbanService.getStateAsUpdate(id);

            // Return as base64
            const base64State = Buffer.from(state).toString('base64');

            return {
                state: base64State,
            };
        } catch (error) {
            console.error(`[Kanban] Failed to get state for ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to get kanban board state' };
        }
    })
    /**
     * Get kanban board settings (separate from Y.js state)
     */
    .get('/:id/settings', async ({ auth, params, set }) => {
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

        // Verify it's a kanban type
        if (page.type !== 'kanban') {
            set.status = 400;
            return { error: 'Page is not a kanban type' };
        }

        try {
            const board = await findKanbanBoard(id);
            if (!board) {
                // Return default settings if board doesn't exist yet
                return {
                    settings: {
                        defaultLaneId: undefined,
                        cardDisplay: {
                            showDueDate: true,
                            showPriority: true,
                            showCoverColor: false,
                        },
                        doneReset: {
                            period: 'weekly',
                            dayOfWeek: 1,
                        },
                    },
                };
            }

            return {
                settings: board.settings,
            };
        } catch (error) {
            console.error(`[Kanban] Failed to get settings for ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to get kanban board settings' };
        }
    })
    /**
     * Update kanban board settings
     */
    .patch(
        '/:id/settings',
        async ({ auth, params, body, set }) => {
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

            // Verify it's a kanban type
            if (page.type !== 'kanban') {
                set.status = 400;
                return { error: 'Page is not a kanban type' };
            }

            try {
                const updatedBoard = await updateKanbanBoardSettings(
                    id,
                    body as Partial<KanbanSettings>,
                );

                if (!updatedBoard) {
                    set.status = 404;
                    return { error: 'Kanban board not found' };
                }

                return {
                    success: true,
                    settings: updatedBoard.settings,
                };
            } catch (error) {
                console.error(`[Kanban] Failed to update settings for ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to update kanban board settings' };
            }
        },
        {
            body: t.Object({
                defaultLaneId: t.Optional(t.String()),
                cardDisplay: t.Optional(
                    t.Object({
                        showDueDate: t.Optional(t.Boolean()),
                        showPriority: t.Optional(t.Boolean()),
                        showCoverColor: t.Optional(t.Boolean()),
                    }),
                ),
                doneReset: t.Optional(
                    t.Object({
                        period: t.Optional(
                            t.Union([
                                t.Literal('daily'),
                                t.Literal('weekly'),
                                t.Literal('biweekly'),
                                t.Literal('monthly'),
                                t.Literal('never'),
                            ]),
                        ),
                        dayOfWeek: t.Optional(t.Number()),
                        dayOfMonth: t.Optional(t.Number()),
                    }),
                ),
            }),
        },
    );
