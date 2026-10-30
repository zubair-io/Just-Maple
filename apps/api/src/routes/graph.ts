import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { isNotebookMember, type JWTPayload } from '@maple/shared';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { findGraphPage } from '../repositories/page.repo';
import { removeGraphPair, removeGraphRelation } from '../repositories/graph.repo';
import { getDataGraph } from '../services/graph.service';

/**
 * A notebook's connected-data graph, on its Graph page. Members read it (only what the
 * notebook's data pages show them); members who can edit remove one reason two nodes are
 * connected, or the whole line. Public readers get nothing: data pages are for members.
 */

const NOT_FOUND = {
    error: 'Not found',
    message: 'The graph is for members of this notebook, once it has a Graph page.',
};

async function memberNotebook(auth: AuthContext, notebookId: string, access: 'read' | 'write') {
    const notebook = await findNotebookByIdWithAccess(notebookId, auth.user._id, access).catch(
        () => null,
    );
    if (!notebook || !isNotebookMember(notebook, auth.user._id)) return null;
    if (!(await findGraphPage(notebookId))) return null;
    return notebook;
}

export const graphRoutes = new Elysia({ prefix: '/api/graph' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) return { auth: null as AuthContext | null };
        try {
            const payload = (await jwt.verify(authHeader.slice(7))) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    .get(
        '/:notebookId',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await memberNotebook(auth, params.notebookId, 'read'))) {
                set.status = 404;
                return NOT_FOUND;
            }
            if (query.from !== undefined && query.to !== undefined && query.to < query.from) {
                set.status = 400;
                return {
                    error: 'Invalid date range',
                    message: 'Choose an end date after the start date.',
                };
            }
            return {
                graph: await getDataGraph(params.notebookId, auth.user._id, {
                    from: query.from ?? Math.floor(Date.now() / 1000) - 7 * 86400,
                    to: query.to,
                }),
            };
        },
        {
            params: t.Object({ notebookId: t.String() }),
            query: t.Object({
                from: t.Optional(t.Numeric()),
                to: t.Optional(t.Numeric()),
            }),
        },
    )

    // Removes a reason (a relation id) or a whole line (a link id) for everyone in the
    // notebook; it's never made again for that pair.
    .delete(
        '/:notebookId/links/:linkId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await memberNotebook(auth, params.notebookId, 'write'))) {
                set.status = 404;
                return NOT_FOUND;
            }
            // Elysia has already decoded the path; decoding again breaks ids with a '%'.
            const linkId = params.linkId;
            // Link ids start with their notebook's id: another notebook's can't match.
            if (
                !linkId.startsWith(`${params.notebookId}|`) ||
                !(
                    (await removeGraphRelation(params.notebookId, linkId, auth.user._id)) ||
                    (await removeGraphPair(params.notebookId, linkId, auth.user._id))
                )
            ) {
                set.status = 404;
                return { error: 'Not found', message: 'That link is already gone' };
            }
            return { success: true };
        },
        { params: t.Object({ notebookId: t.String(), linkId: t.String() }) },
    );
