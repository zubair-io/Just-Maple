import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import { findMemoById, createMemo } from '../repositories/memo.repo';
import { yjsDocumentService } from '../services/yjs-document.service';
import { deleteMemo } from '../repositories/memo.repo';
import { isDevMode, isDocPage, getDocContent, pageIdToSlug } from '../services/docs.service';
import {
    uploadMemoImage,
    deleteMemoImageAllSizes,
    type MemoImageUrls,
} from '../services/memo-image-storage.service';
import type { JWTPayload } from '@maple/shared';

/**
 * Look up the parent page for a memo and verify user access.
 * For regular memos, memo.id == memo.pageId == page.id.
 * For card memos, memo.pageId points to the kanban page.
 */
async function findPageForMemo(memoId: string, userId: string) {
    // First try: memoId is a page id directly (regular memos, or for init before memo exists)
    const directPage = await findPageById(memoId, userId);
    if (directPage) {
        return directPage;
    }

    // Second try: look up the memo document to get its parent page (card memos)
    const memo = await findMemoById(memoId);
    if (memo) {
        return findPageById(memo.pageId, userId);
    }

    return null;
}

/**
 * Memo API routes
 * Handles Y.js memo initialization and state retrieval
 * Used by offline queue for syncing offline-created memos
 */
export const memoRoutes = new Elysia({ prefix: '/api/memos' })
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
     * Create a memo entity (for kanban cards)
     * Does NOT create a Page record — the memo references an existing page via pageId
     */
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id, pageId } = body;

            // Verify user has access to the parent page
            const page = await findPageById(pageId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Parent page not found' };
            }

            try {
                // Create empty memo with Y.js state
                const Y = await import('yjs');
                const ydoc = new Y.Doc();
                ydoc.getXmlFragment('prosemirror');
                const state = Y.encodeStateAsUpdate(ydoc);
                ydoc.destroy();

                const memo = await createMemo({ id, pageId, state });

                console.log(`[Memo] Created memo entity ${id} for parent page ${pageId}`);

                return { success: true, memo: { id: memo.id, pageId: memo.pageId } };
            } catch (error) {
                console.error(`[Memo] Failed to create memo ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to create memo' };
            }
        },
        {
            body: t.Object({
                id: t.String(),
                pageId: t.String(),
            }),
        },
    )
    /**
     * Initialize memo with Y.js state
     * Used for first sync of offline-created memos
     */
    .post(
        '/:id/init',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id } = params;

            // Verify user has access via parent page
            const page = await findPageForMemo(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Allow memo and kanban page types (kanban pages have card memos)
            if (page.type !== 'memo' && page.type !== 'kanban') {
                set.status = 400;
                return { error: 'Page type does not support memo sync' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const state = new Uint8Array(arrayBuffer);

                // Initialize memo with the state
                const mergedState = await yjsDocumentService.initializeNotebook(id, state);

                // Return merged state as base64
                const base64State = Buffer.from(mergedState).toString('base64');

                console.log(`[Memo] Initialized memo ${id} with ${state.length} bytes`);

                return {
                    success: true,
                    state: base64State,
                };
            } catch (error) {
                console.error(`[Memo] Failed to initialize ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to initialize memo' };
            }
        },
        {
            type: 'arrayBuffer',
        },
    )
    /**
     * Get memo Y.js state
     * Used for fetching initial state when WebSocket is slow or unavailable
     */
    .get('/:id/state', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { id } = params;

        // Handle doc pages in dev mode - return markdown directly
        if (isDevMode() && isDocPage(id)) {
            const slug = pageIdToSlug(id);
            const markdown = await getDocContent(slug);
            if (!markdown) {
                set.status = 404;
                return { error: 'Documentation page not found' };
            }
            return { state: null, markdown };
        }

        // Verify user has access via parent page
        const page = await findPageForMemo(id, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        // Allow memo and kanban page types
        if (page.type !== 'memo' && page.type !== 'kanban') {
            set.status = 400;
            return { error: 'Page type does not support memo sync' };
        }

        try {
            // Get the current state
            const state = await yjsDocumentService.getStateAsUpdate(id);

            // Return as base64
            const base64State = Buffer.from(state).toString('base64');

            // Check if this is a new/empty memo - if so, include page content for initialization
            // This allows templates and other page creation flows to populate the editor
            const isEmptyMemo = state.length < 50; // Empty Y.js doc is very small
            const initialContent = isEmptyMemo && page.content ? page.content : undefined;

            return {
                state: base64State,
                initialContent, // ProseMirror JSON to initialize empty memos
            };
        } catch (error) {
            console.error(`[Memo] Failed to get state for ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to get memo state' };
        }
    })
    /**
     * Upload an image to a memo
     * Returns the URL of the uploaded image along with dimensions
     */
    .post(
        '/:id/images',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id } = params;

            // Verify user has access via parent page
            const page = await findPageForMemo(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Allow memo and kanban page types
            if (page.type !== 'memo' && page.type !== 'kanban') {
                set.status = 400;
                return { error: 'Page type does not support image upload' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Validate file size (150MB limit for images)
                const MAX_FILE_SIZE = 150 * 1024 * 1024;
                if (buffer.length > MAX_FILE_SIZE) {
                    set.status = 413;
                    return {
                        error: 'File too large',
                        message: 'Image file exceeds maximum size of 150MB',
                    };
                }

                // Get content type from header
                const contentType = request.headers.get('content-type') || 'image/jpeg';

                // Validate content type
                const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                if (!validTypes.includes(contentType)) {
                    set.status = 400;
                    return {
                        error: 'Invalid content type',
                        message: 'Only JPEG, PNG, GIF, and WebP images are supported',
                    };
                }

                // Generate image ID
                const imageId = crypto.randomUUID();

                // Upload the image (creates all size variants)
                const result = await uploadMemoImage(
                    imageId,
                    auth.user._id,
                    id,
                    buffer,
                    contentType,
                );

                console.log(
                    `[Memo] Uploaded image ${imageId} for memo ${id} (${buffer.length} bytes)`,
                );

                return {
                    id: imageId,
                    urls: result.urls,
                    width: result.width,
                    height: result.height,
                };
            } catch (error) {
                console.error(`[Memo] Failed to upload image for ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to upload image' };
            }
        },
        {
            type: 'arrayBuffer',
        },
    )
    /**
     * Delete an image from a memo (all size variants)
     */
    .delete(
        '/:id/images/:imageId',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id } = params;

            // Verify user has access via parent page
            const page = await findPageForMemo(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            try {
                // Delete all size variants
                if (body.urls) {
                    await deleteMemoImageAllSizes(body.urls as MemoImageUrls);
                }

                console.log(`[Memo] Deleted image ${params.imageId} from memo ${id}`);

                return { success: true };
            } catch (error) {
                console.error(`[Memo] Failed to delete image ${params.imageId}:`, error);
                set.status = 500;
                return { error: 'Failed to delete image' };
            }
        },
        {
            params: t.Object({
                id: t.String(),
                imageId: t.String(),
            }),
            body: t.Object({
                urls: t.Object({
                    original: t.String(),
                    small: t.String(),
                    medium: t.String(),
                    large: t.String(),
                    cover: t.String(),
                }),
            }),
        },
    )
    /**
     * Reset memo - delete the Y.js state to recover from corruption
     * A new empty document will be created on next load
     */
    .delete('/:id/reset', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { id } = params;

        // Verify user has access via parent page
        const page = await findPageForMemo(id, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        try {
            // Clear from YJS service cache first (don't save the corrupted state)
            yjsDocumentService.discardDocument(id);
            // Delete the memo document - a fresh one will be created on next load
            await deleteMemo(id);

            console.log(`[Memo] Reset memo ${id}`);

            return { success: true, message: 'Memo reset successfully' };
        } catch (error) {
            console.error(`[Memo] Failed to reset ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to reset memo' };
        }
    });
