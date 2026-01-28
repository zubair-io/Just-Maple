import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import { yjsDocumentService } from '../services/yjs-document.service';
import { isDevMode, isDocPage, getDocContent, pageIdToSlug } from '../services/docs.service';
import {
    uploadMemoImage,
    deleteMemoImageAllSizes,
    type MemoImageUrls,
} from '../services/memo-image-storage.service';
import type { JWTPayload } from '@maple/shared';

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
     * Initialize memo with Y.js state
     * Used for first sync of offline-created memos
     */
    .post(
        '/:noteId/init',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;

            // Verify page exists and user has access (noteId is the documentId)
            const page = await findPageById(noteId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Verify it's a notebook type (whiteboards use /api/whiteboards routes)
            if (page.type !== 'memo') {
                set.status = 400;
                return { error: 'Page type does not support memo sync' };
            }

            try {
                // Read binary body
                const arrayBuffer = await request.arrayBuffer();
                const state = new Uint8Array(arrayBuffer);

                // Initialize memo with the state
                const mergedState = await yjsDocumentService.initializeNotebook(noteId, state);

                // Return merged state as base64
                const base64State = Buffer.from(mergedState).toString('base64');

                console.log(`[Memo] Initialized memo ${noteId} with ${state.length} bytes`);

                return {
                    success: true,
                    state: base64State,
                };
            } catch (error) {
                console.error(`[Memo] Failed to initialize ${noteId}:`, error);
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
    .get('/:noteId/state', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { noteId } = params;

        // Handle doc pages in dev mode - return markdown directly
        if (isDevMode() && isDocPage(noteId)) {
            const slug = pageIdToSlug(noteId);
            const markdown = await getDocContent(slug);
            if (!markdown) {
                set.status = 404;
                return { error: 'Documentation page not found' };
            }
            return { state: null, markdown };
        }

        // Verify page exists and user has access (noteId is the documentId)
        const page = await findPageById(noteId, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        // Verify it's a notebook type (whiteboards use /api/whiteboards routes)
        if (page.type !== 'memo') {
            set.status = 400;
            return { error: 'Page type does not support memo sync' };
        }

        try {
            // Get the current state
            const state = await yjsDocumentService.getStateAsUpdate(noteId);

            // Return as base64
            const base64State = Buffer.from(state).toString('base64');

            return {
                state: base64State,
            };
        } catch (error) {
            console.error(`[Memo] Failed to get state for ${noteId}:`, error);
            set.status = 500;
            return { error: 'Failed to get memo state' };
        }
    })
    /**
     * Upload an image to a memo
     * Returns the URL of the uploaded image along with dimensions
     */
    .post(
        '/:noteId/images',
        async ({ auth, params, request, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;

            // Verify page exists and user has access
            const page = await findPageById(noteId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Verify it's a memo type
            if (page.type !== 'memo') {
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
                    noteId,
                    buffer,
                    contentType,
                );

                console.log(
                    `[Memo] Uploaded image ${imageId} for memo ${noteId} (${buffer.length} bytes)`,
                );

                return {
                    id: imageId,
                    urls: result.urls,
                    width: result.width,
                    height: result.height,
                };
            } catch (error) {
                console.error(`[Memo] Failed to upload image for ${noteId}:`, error);
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
        '/:noteId/images/:imageId',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { noteId } = params;

            // Verify page exists and user has access
            const page = await findPageById(noteId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            try {
                // Delete all size variants
                if (body.urls) {
                    await deleteMemoImageAllSizes(body.urls as MemoImageUrls);
                }

                console.log(`[Memo] Deleted image ${params.imageId} from memo ${noteId}`);

                return { success: true };
            } catch (error) {
                console.error(`[Memo] Failed to delete image ${params.imageId}:`, error);
                set.status = 500;
                return { error: 'Failed to delete image' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
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
    );
