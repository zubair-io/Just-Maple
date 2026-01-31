import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    getBacklinks,
    getForwardLinks,
    findUnlinkedMentions,
    searchPagesForLinking,
    getGraphData,
    getLocalGraph,
    reindexAllLinks,
    getConnectionGraph,
} from '../services/link.service';

export const linkRoutes = new Elysia({ prefix: '/api/links' })
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

    // Search pages for linking autocomplete
    .get(
        '/search',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const results = await searchPagesForLinking(query.q, auth.user._id, {
                notebookId: query.notebookId,
                excludePageId: query.excludePageId,
                limit: query.limit ? parseInt(query.limit, 10) : 10,
            });

            return { pages: results };
        },
        {
            query: t.Object({
                q: t.String(),
                notebookId: t.Optional(t.String()),
                excludePageId: t.Optional(t.String()),
                limit: t.Optional(t.String()),
            }),
        },
    )

    // Get backlinks for a page
    .get(
        '/:pageId/backlinks',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const backlinks = await getBacklinks(params.pageId);
            return { backlinks };
        },
        {
            params: t.Object({
                pageId: t.String(),
            }),
        },
    )

    // Get forward links for a page
    .get(
        '/:pageId/forward',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const forwardLinks = await getForwardLinks(params.pageId);
            return { forwardLinks };
        },
        {
            params: t.Object({
                pageId: t.String(),
            }),
        },
    )

    // Find unlinked mentions
    .get(
        '/:pageId/unlinked',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const mentions = await findUnlinkedMentions(
                params.pageId,
                auth.user._id,
                query.notebookId,
            );
            return { mentions };
        },
        {
            params: t.Object({
                pageId: t.String(),
            }),
            query: t.Object({
                notebookId: t.Optional(t.String()),
            }),
        },
    )

    // Get knowledge graph data for a notebook
    .get(
        '/graph/notebook/:notebookId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const graph = await getGraphData(auth.user._id, params.notebookId);
            return { graph };
        },
        {
            params: t.Object({
                notebookId: t.String(),
            }),
        },
    )

    // Get full knowledge graph for user
    .get('/graph', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        const graph = await getGraphData(auth.user._id);
        return { graph };
    })

    // Get local graph centered on a page
    .get(
        '/graph/page/:pageId',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const depth = query.depth ? parseInt(query.depth, 10) : 1;
            const graph = await getLocalGraph(params.pageId, auth.user._id, depth);
            return { graph };
        },
        {
            params: t.Object({
                pageId: t.String(),
            }),
            query: t.Object({
                depth: t.Optional(t.String()),
            }),
        },
    )

    // Get connection graph for a notebook (includes page links, hashtag connections, mentions)
    .get(
        '/connections/notebook/:notebookId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const graph = await getConnectionGraph(auth.user._id, params.notebookId);
            return { graph };
        },
        {
            params: t.Object({
                notebookId: t.String(),
            }),
        },
    )

    // Get full connection graph for user
    .get('/connections', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        const graph = await getConnectionGraph(auth.user._id);
        return { graph };
    })

    // Reindex links for a notebook (admin/migration)
    .post(
        '/reindex/:notebookId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const count = await reindexAllLinks(auth.user._id, params.notebookId);
            return { status: 'completed', pagesIndexed: count };
        },
        {
            params: t.Object({
                notebookId: t.String(),
            }),
        },
    )

    // Reindex all links for user
    .post('/reindex', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        const count = await reindexAllLinks(auth.user._id);
        return { status: 'completed', pagesIndexed: count };
    });
