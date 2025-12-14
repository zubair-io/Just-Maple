import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findTagsByUserId,
    findTagById,
    createTag,
    updateTag,
    deleteTag,
} from '../repositories/tag.repo';

export const tagRoutes = new Elysia({ prefix: '/api/tags' })
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

    // Get all tags for the current user
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }
        const tags = await findTagsByUserId(auth.user._id);
        return { tags };
    })

    // Get a single tag by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const tag = await findTagById(params.id, auth.user._id);

            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { tag };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new tag
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const tag = await createTag(auth.user._id, body);
            return { tag };
        },
        {
            body: t.Object({
                label: t.String({ minLength: 1, maxLength: 100 }),
                color: t.Optional(t.String()),
                parentId: t.Optional(t.String()),
            }),
        },
    )

    // Update a tag
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const tag = await updateTag(params.id, auth.user._id, body);

            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { tag };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                label: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
                color: t.Optional(t.String()),
                parentId: t.Optional(t.String()),
                order: t.Optional(t.Number()),
            }),
        },
    )

    // Delete a tag
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const deleted = await deleteTag(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { message: 'Tag deleted successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
