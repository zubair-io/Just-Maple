import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { searchNotes } from '../services/search.service';
import { reindexAllForUser } from '../repositories/search.repo';
import type { JWTPayload } from '@maple/shared';

export const searchRoutes = new Elysia({ prefix: '/api/search' })
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

    // Search notes
    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            if (!query.q || query.q.trim().length === 0) {
                set.status = 400;
                return { error: 'Bad Request', message: 'Query parameter q is required' };
            }

            const results = await searchNotes(query.q, {
                userId: auth.user._id,
                notebookIds: query.notebookIds?.split(',').filter((id) => id.length > 0),
                types: query.types?.split(',').filter((t) => t.length > 0),
                dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
                dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
                limit: query.limit ? parseInt(query.limit, 10) : 20,
                offset: query.offset ? parseInt(query.offset, 10) : 0,
            });

            return { results };
        },
        {
            query: t.Object({
                q: t.String(),
                notebookIds: t.Optional(t.String()),
                types: t.Optional(t.String()),
                dateFrom: t.Optional(t.String()),
                dateTo: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
            }),
        },
    )

    // Reindex all pages for current user
    .post('/reindex', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        // Start reindexing in background
        reindexAllForUser(auth.user._id).catch((err) => {
            console.error(`[Search] Reindex failed for user ${auth.user._id}:`, err);
        });

        return { message: 'Reindex started' };
    });
