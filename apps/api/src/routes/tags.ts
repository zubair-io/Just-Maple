import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import { getAllTagsForUser, findPagesByTag, getTagCountsForUser } from '../repositories/page.repo';
import { getTagColors, setTagColor, removeTagColor } from '../repositories/user.repo';

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

    // Get all tags for the current user (with counts)
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        // Get tag counts and colors in parallel
        const [tagCounts, tagColors] = await Promise.all([
            getTagCountsForUser(auth.user._id),
            getTagColors(auth.user._id),
        ]);

        // Merge tags with their colors
        const tags = tagCounts.map((tc) => ({
            name: tc.tag,
            count: tc.count,
            color: tagColors[tc.tag] || null,
        }));

        return { tags };
    })

    // Get pages for a specific tag
    .get(
        '/:tag/pages',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = decodeURIComponent(params.tag);
            const pages = await findPagesByTag(auth.user._id, tag, {
                notebookId: query.notebookId,
                limit: query.limit ? parseInt(query.limit, 10) : 50,
                offset: query.offset ? parseInt(query.offset, 10) : 0,
            });

            return { pages };
        },
        {
            params: t.Object({
                tag: t.String(),
            }),
            query: t.Object({
                notebookId: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
            }),
        },
    )

    // Set color for a tag
    .put(
        '/:tag/color',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = decodeURIComponent(params.tag);
            const success = await setTagColor(auth.user._id, tag, body.color);

            if (!success) {
                set.status = 500;
                return { error: 'Failed to set tag color' };
            }

            return { success: true, tag, color: body.color };
        },
        {
            params: t.Object({
                tag: t.String(),
            }),
            body: t.Object({
                color: t.String({ pattern: '^#[0-9A-Fa-f]{6}$' }), // Hex color
            }),
        },
    )

    // Remove color for a tag
    .delete(
        '/:tag/color',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = decodeURIComponent(params.tag);
            await removeTagColor(auth.user._id, tag);

            return { success: true, tag };
        },
        {
            params: t.Object({
                tag: t.String(),
            }),
        },
    )

    // Get all tag colors for the user
    .get('/colors', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        const colors = await getTagColors(auth.user._id);
        return { colors };
    });
