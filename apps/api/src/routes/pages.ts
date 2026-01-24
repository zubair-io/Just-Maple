import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { isDevMode, isDocNotebook, getDocPages, DOC_NOTEBOOK_ID } from '../services/docs.service';
import type { JWTPayload } from '@maple/shared';

/**
 * Sanitize a name/title string by trimming whitespace and removing newlines
 */
function sanitizeName(name: string): string {
    return name.replace(/[\r\n]/g, ' ').trim();
}
import {
    findPagesByUserId,
    findPageById,
    createPage,
    updatePage,
    deletePage,
    movePageToTrash,
    restorePageFromTrash,
    emptyTrash,
} from '../repositories/page.repo';
import { otService } from '../services/ot.service';
import { realtimeWSService } from '../services/realtime-ws.service';
import { getUsersWithNotebookAccess } from '../repositories/notebook.repo';

export const pageRoutes = new Elysia({ prefix: '/api/pages' })
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

    // Get all pages for the current user (with optional filters)
    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Handle virtual Documentation notebook in dev mode
            if (isDevMode() && query.tagId && isDocNotebook(query.tagId)) {
                const pages = await getDocPages();
                return { pages };
            }

            const pages = await findPagesByUserId(auth.user._id, {
                tagId: query.tagId,
                isFavorite: query.favorites === 'true' ? true : undefined,
                isTrashed: query.trash === 'true' ? true : undefined,
                isArchived: query.archived === 'true' ? true : undefined,
            });
            return { pages };
        },
        {
            query: t.Object({
                tagId: t.Optional(t.String()),
                favorites: t.Optional(t.String()),
                trash: t.Optional(t.String()),
                archived: t.Optional(t.String()),
            }),
        },
    )

    // Get a single page by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const page = await findPageById(params.id, auth.user._id);

            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            return { page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new page
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const sanitizedBody = {
                ...body,
                title: body.title ? sanitizeName(body.title) : undefined,
            };
            const page = await createPage(auth.user._id, sanitizedBody);

            // Broadcast new page creation to all clients viewing this notebook
            if (page.tagId) {
                await otService.broadcastNoteCreated(page.tagId, page);

                // Send SSE event to all users with access to this notebook
                const recipientUserIds = await getUsersWithNotebookAccess(page.tagId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.created',
                    page,
                    tagId: page.tagId,
                });
            }

            return { page };
        },
        {
            body: t.Object({
                type: t.Optional(
                    t.Union([
                        t.Literal('memo'),
                        t.Literal('collectable'),
                        t.Literal('whiteboard'),
                        t.Literal('kanban'),
                        t.Literal('message'),
                        t.Literal('recording'),
                    ]),
                ),
                title: t.Optional(t.String({ maxLength: 255 })),
                content: t.Optional(t.Any()),
                tagId: t.Optional(t.String()),
                id: t.Optional(t.String()),
            }),
        },
    )

    // Update a page
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const sanitizedBody = {
                ...body,
                title: body.title ? sanitizeName(body.title) : undefined,
            };
            const page = await updatePage(params.id, auth.user._id, sanitizedBody);

            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Send SSE event for title updates (real-time sidebar updates)
            if (page.tagId && sanitizedBody.title !== undefined) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.tagId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.updated',
                    pageId: page.id,
                    title: sanitizedBody.title,
                    updatedAt: page.updatedAt,
                    tagId: page.tagId,
                });
            }

            return { page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                title: t.Optional(t.String({ maxLength: 255 })),
                content: t.Optional(t.Any()),
                tagId: t.Optional(t.String()),
                isFavorite: t.Optional(t.Boolean()),
                isArchived: t.Optional(t.Boolean()),
                isTrashed: t.Optional(t.Boolean()),
                automergeDoc: t.Optional(t.Any()),
            }),
        },
    )

    // Move page to trash
    .post(
        '/:id/trash',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const page = await movePageToTrash(params.id, auth.user._id);

            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Send SSE event for page trashed
            if (page.tagId) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.tagId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.trashed',
                    pageId: page.id,
                    tagId: page.tagId,
                });
            }

            return { page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Restore page from trash
    .post(
        '/:id/restore',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const page = await restorePageFromTrash(params.id, auth.user._id);

            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Send SSE event for page restored
            if (page.tagId) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.tagId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.restored',
                    page,
                    tagId: page.tagId,
                });
            }

            return { page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Permanently delete a page
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Get page first to retrieve tagId before deletion
            const page = await findPageById(params.id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            const deleted = await deletePage(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Send SSE event for page deleted
            if (page.tagId) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.tagId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.deleted',
                    pageId: page.id,
                    tagId: page.tagId,
                });
            }

            return { message: 'Page deleted permanently' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Empty trash
    .delete('/trash/empty', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }
        const count = await emptyTrash(auth.user._id);
        return { message: `Deleted ${count} pages from trash`, count };
    });
