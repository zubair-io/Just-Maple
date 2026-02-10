import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { isDevMode, getDocPages } from '../services/docs.service';
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
    publishPage,
} from '../repositories/page.repo';
import { otService } from '../services/ot.service';
import { realtimeWSService } from '../services/realtime-ws.service';
import { getUsersWithNotebookAccess } from '../repositories/notebook.repo';
import { updateLinksForPage, handlePageRename, handlePageDeletion } from '../services/link.service';
import { indexPage, removeFromIndex } from '../repositories/search.repo';
import type { Page } from '@maple/shared';

/**
 * Broadcast page.moved event to users in both old and new notebooks
 */
async function emitPageMovedIfNeeded(
    previousPage: Page | null,
    updatedPage: Page,
    requestedNotebookId: string | undefined,
): Promise<void> {
    const previousNotebookId = previousPage?.notebookId;
    if (
        requestedNotebookId !== undefined &&
        previousNotebookId &&
        updatedPage.notebookId &&
        previousNotebookId !== updatedPage.notebookId
    ) {
        const oldRecipients = await getUsersWithNotebookAccess(previousNotebookId);
        const event = {
            type: 'page.moved' as const,
            pageId: updatedPage.id,
            previousNotebookId,
            newNotebookId: updatedPage.notebookId,
            updatedAt: updatedPage.updatedAt,
        };
        realtimeWSService.sendToUsers(oldRecipients, event);

        const newRecipients = await getUsersWithNotebookAccess(updatedPage.notebookId);
        const newOnly = newRecipients.filter((id) => !oldRecipients.includes(id));
        if (newOnly.length > 0) {
            realtimeWSService.sendToUsers(newOnly, event);
        }
    }
}

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

            const pages = await findPagesByUserId(auth.user._id, {
                notebookId: query.notebookId,
                isFavorite: query.favorites === 'true' ? true : undefined,
                isTrashed: query.trash === 'true' ? true : undefined,
                isArchived: query.archived === 'true' ? true : undefined,
            });

            // In dev mode, inject virtual doc pages into the response
            if (isDevMode() && !query.notebookId) {
                const docPages = await getDocPages();
                pages.push(...docPages);
            }

            return { pages };
        },
        {
            query: t.Object({
                notebookId: t.Optional(t.String()),
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
            if (page.notebookId) {
                await otService.broadcastNoteCreated(page.notebookId, page);

                // Send SSE event to all users with access to this notebook
                const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.created',
                    page,
                    notebookId: page.notebookId,
                });
            }

            // Index page for search (background, don't block response)
            indexPage(page.id).catch((err) =>
                console.error(`[Search] Failed to index page ${page.id}:`, err),
            );

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
                        t.Literal('gmail'),
                    ]),
                ),
                title: t.Optional(t.String({ maxLength: 255 })),
                content: t.Optional(t.Any()),
                notebookId: t.Optional(t.String()),
                id: t.Optional(t.String()),
            }),
        },
    )

    // Update a page (PUT - full update)
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Get the page before update to detect notebook changes
            const previousPage = await findPageById(params.id, auth.user._id);

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
            if (page.notebookId && sanitizedBody.title !== undefined) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.updated',
                    pageId: page.id,
                    title: sanitizedBody.title,
                    updatedAt: page.updatedAt,
                    notebookId: page.notebookId,
                });

                // Update backlinks when title changes
                await handlePageRename(page.id, sanitizedBody.title);
            }

            await emitPageMovedIfNeeded(previousPage, page, sanitizedBody.notebookId);

            // Extract and update links when content changes
            if (sanitizedBody.content) {
                await updateLinksForPage(page.id, sanitizedBody.content, page.title);
            }

            // Reindex page for search if title or content changed (background)
            if (sanitizedBody.title !== undefined || sanitizedBody.content !== undefined) {
                indexPage(page.id).catch((err) =>
                    console.error(`[Search] Failed to index page ${page.id}:`, err),
                );
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
                notebookId: t.Optional(t.String()),
                isFavorite: t.Optional(t.Boolean()),
                isArchived: t.Optional(t.Boolean()),
                isTrashed: t.Optional(t.Boolean()),
                todoMeta: t.Optional(t.Any()),
                linksMeta: t.Optional(t.Any()),
            }),
        },
    )

    // Update a page (PATCH - partial update)
    .patch(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Get the page before update to detect notebook changes
            const previousPage = await findPageById(params.id, auth.user._id);

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
            if (page.notebookId && sanitizedBody.title !== undefined) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.updated',
                    pageId: page.id,
                    title: sanitizedBody.title,
                    updatedAt: page.updatedAt,
                    notebookId: page.notebookId,
                });

                // Update backlinks when title changes
                await handlePageRename(page.id, sanitizedBody.title);
            }

            await emitPageMovedIfNeeded(previousPage, page, sanitizedBody.notebookId);

            // Extract and update links when content changes
            if (sanitizedBody.content) {
                await updateLinksForPage(page.id, sanitizedBody.content, page.title);
            }

            // Reindex page for search if title or content changed (background)
            if (sanitizedBody.title !== undefined || sanitizedBody.content !== undefined) {
                indexPage(page.id).catch((err) =>
                    console.error(`[Search] Failed to index page ${page.id}:`, err),
                );
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
                notebookId: t.Optional(t.String()),
                isFavorite: t.Optional(t.Boolean()),
                isArchived: t.Optional(t.Boolean()),
                isTrashed: t.Optional(t.Boolean()),
                todoMeta: t.Optional(t.Any()),
                linksMeta: t.Optional(t.Any()),
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
            if (page.notebookId) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.trashed',
                    pageId: page.id,
                    notebookId: page.notebookId,
                });
            }

            // Remove from search index (background)
            removeFromIndex(page.id).catch((err) =>
                console.error(`[Search] Failed to remove page ${page.id} from index:`, err),
            );

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
            if (page.notebookId) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.restored',
                    page,
                    notebookId: page.notebookId,
                });
            }

            // Re-add to search index (background)
            indexPage(page.id).catch((err) =>
                console.error(`[Search] Failed to index restored page ${page.id}:`, err),
            );

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

            // Get page first to retrieve notebookId before deletion
            const page = await findPageById(params.id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Clean up link references before deletion
            await handlePageDeletion(params.id);

            const deleted = await deletePage(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Send SSE event for page deleted
            if (page.notebookId) {
                const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                realtimeWSService.sendToUsers(recipientUserIds, {
                    type: 'page.deleted',
                    pageId: page.id,
                    notebookId: page.notebookId,
                });
            }

            // Remove from search index (background)
            removeFromIndex(page.id).catch((err) =>
                console.error(`[Search] Failed to remove deleted page ${page.id} from index:`, err),
            );

            return { message: 'Page deleted permanently' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Update page publish state
    .patch(
        '/:id/publish',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Sanitize slug if provided
            const sanitizedBody = { ...body };
            if (sanitizedBody.publishedSlug) {
                sanitizedBody.publishedSlug = sanitizedBody.publishedSlug
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
            }

            const page = await publishPage(params.id, auth.user._id, sanitizedBody);

            if (!page) {
                set.status = 404;
                return { error: 'Page not found or access denied' };
            }

            return { page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                isPublished: t.Optional(t.Boolean()),
                publishedSlug: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
                publishedOrder: t.Optional(t.Number()),
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
