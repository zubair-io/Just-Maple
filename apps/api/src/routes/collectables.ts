import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { getUsersWithNotebookAccess } from '../repositories/notebook.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findCollectablesByUserId,
    findCollectableById,
    findCollectableByRegistryData,
    createCollectable,
    updateCollectable,
    deleteCollectable,
} from '../repositories/collectable.repo';
import { realtimeWSService } from '../services/realtime-ws.service';

export const collectableRoutes = new Elysia({ prefix: '/api/collectables' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // Get all collectables for the current user (with optional filters)
    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const collectables = await findCollectablesByUserId(auth.user._id, {
                notebookId: query.notebookId,
                status: query.status as 'have' | 'want' | 'sold' | undefined,
                updatedAfter: query.updatedAfter,
            });
            return { collectables };
        },
        {
            query: t.Object({
                notebookId: t.Optional(t.String()),
                status: t.Optional(t.String()),
                updatedAfter: t.Optional(t.String()),
            }),
        },
    )

    // Get collectable by registry data (for collectible registry view)
    .get(
        '/by-registry/:registryId',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            if (!query.notebookId) {
                set.status = 400;
                return { error: 'Bad Request', message: 'notebookId query parameter required' };
            }

            const collectable = await findCollectableByRegistryData(
                params.registryId,
                query.notebookId,
                auth.user._id,
            );

            // Return null collectable if not found (not a 404 - the registry exists, user just doesn't have it)
            return { collectable };
        },
        {
            params: t.Object({
                registryId: t.String(),
            }),
            query: t.Object({
                notebookId: t.String(),
            }),
        },
    )

    // Get a single collectable by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const collectable = await findCollectableById(params.id, auth.user._id);

            if (!collectable) {
                set.status = 404;
                return { error: 'Collectable not found' };
            }

            return { collectable };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new collectable
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const collectable = await createCollectable(auth.user._id, body);

            // Send SSE event to all users with access to each notebook
            for (const notebookId of collectable.tags) {
                const recipientUserIds = await getUsersWithNotebookAccess(notebookId);
                console.log(
                    `[Collectables] Sending collectable.created SSE to ${recipientUserIds.length} users for notebook ${notebookId}`,
                );
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'collectable.created',
                    collectable,
                    notebookId,
                });
            }

            return { collectable };
        },
        {
            body: t.Object({
                tags: t.Optional(t.Array(t.String())),
                data: t.Object({
                    itemId: t.String(),
                    provider: t.String(),
                    registryData: t.Optional(t.String()),
                    status: t.Optional(
                        t.Union([
                            t.Literal('have'),
                            t.Literal('want'),
                            t.Literal('sold'),
                            t.Literal('none'),
                        ]),
                    ),
                    quantity: t.Optional(t.Number({ minimum: 0 })),
                }),
            }),
        },
    )

    // Update a collectable
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const collectable = await updateCollectable(params.id, auth.user._id, body);

            if (!collectable) {
                set.status = 404;
                return { error: 'Collectable not found' };
            }

            // Send SSE event to all users with access to each notebook
            for (const notebookId of collectable.tags) {
                const recipientUserIds = await getUsersWithNotebookAccess(notebookId);
                console.log(
                    `[Collectables] Sending collectable.updated SSE to ${recipientUserIds.length} users for notebook ${notebookId}`,
                );
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'collectable.updated',
                    collectable,
                    notebookId,
                });
            }

            return { collectable };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                tags: t.Optional(t.Array(t.String())),
                data: t.Optional(
                    t.Object({
                        itemId: t.Optional(t.String()),
                        provider: t.Optional(t.String()),
                        registryData: t.Optional(t.String()),
                        status: t.Optional(
                            t.Union([
                                t.Literal('have'),
                                t.Literal('want'),
                                t.Literal('sold'),
                                t.Literal('none'),
                            ]),
                        ),
                        quantity: t.Optional(t.Number({ minimum: 0 })),
                    }),
                ),
            }),
        },
    )

    // Delete a collectable
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Get collectable first to know which notebooks to broadcast to
            const collectable = await findCollectableById(params.id, auth.user._id);
            if (!collectable) {
                set.status = 404;
                return { error: 'Collectable not found' };
            }

            const deleted = await deleteCollectable(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Collectable not found' };
            }

            // Send SSE event to all users with access to each notebook
            for (const notebookId of collectable.tags) {
                const recipientUserIds = await getUsersWithNotebookAccess(notebookId);
                console.log(
                    `[Collectables] Sending collectable.deleted SSE to ${recipientUserIds.length} users for notebook ${notebookId}`,
                );
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'collectable.deleted',
                    collectableId: params.id,
                    notebookId,
                });
            }

            return { message: 'Collectable deleted' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
