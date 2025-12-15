import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findPapersByUserId,
    findPaperById,
    createPaper,
    updatePaper,
    deletePaper,
} from '../repositories/paper.repo';

export const paperRoutes = new Elysia({ prefix: '/api/papers' })
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

    // Get all papers for the current user (with optional filters)
    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const papers = await findPapersByUserId(auth.user._id, {
                tagId: query.tagId,
                status: query.status as 'have' | 'want' | 'sold' | undefined,
            });
            return { papers };
        },
        {
            query: t.Object({
                tagId: t.Optional(t.String()),
                status: t.Optional(t.String()),
            }),
        },
    )

    // Get a single paper by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const paper = await findPaperById(params.id, auth.user._id);

            if (!paper) {
                set.status = 404;
                return { error: 'Paper not found' };
            }

            return { paper };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new paper
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const paper = await createPaper(auth.user._id, body);
            return { paper };
        },
        {
            body: t.Object({
                tags: t.Optional(t.Array(t.String())),
                data: t.Object({
                    itemId: t.String(),
                    provider: t.String(),
                    registryData: t.Optional(t.String()),
                    status: t.Optional(t.Union([t.Literal('have'), t.Literal('want'), t.Literal('sold')])),
                    quantity: t.Optional(t.Number({ minimum: 0 })),
                }),
            }),
        },
    )

    // Update a paper
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const paper = await updatePaper(params.id, auth.user._id, body);

            if (!paper) {
                set.status = 404;
                return { error: 'Paper not found' };
            }

            return { paper };
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
                            t.Union([t.Literal('have'), t.Literal('want'), t.Literal('sold')]),
                        ),
                        quantity: t.Optional(t.Number({ minimum: 0 })),
                    }),
                ),
            }),
        },
    )

    // Delete a paper
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const deleted = await deletePaper(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Paper not found' };
            }

            return { message: 'Paper deleted' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
