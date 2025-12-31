import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findNotesByUserId,
    findNoteById,
    createNote,
    updateNote,
    deleteNote,
    moveNoteToTrash,
    restoreNoteFromTrash,
    emptyTrash,
} from '../repositories/note.repo';
import { uploadNoteImage } from '../services/storage.service';

export const noteRoutes = new Elysia({ prefix: '/api/notes' })
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

    // Get all notes for the current user (with optional filters)
    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const notes = await findNotesByUserId(auth.user._id, {
                tagId: query.tagId,
                isFavorite: query.favorites === 'true' ? true : undefined,
                isTrashed: query.trash === 'true' ? true : undefined,
                isArchived: query.archived === 'true' ? true : undefined,
            });
            return { notes };
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

    // Get a single note by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const note = await findNoteById(params.id, auth.user._id);

            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            return { note };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Upload an image for a note
    .post('/:id/images', async ({ auth, params, request, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        // Check if note exists and user has access
        const note = await findNoteById(params.id, auth.user._id);
        if (!note) {
            set.status = 404;
            return { error: 'Note not found' };
        }

        // Validate content type
        const contentType = request.headers.get('content-type');
        if (!contentType?.startsWith('image/')) {
            set.status = 400;
            return { error: 'Only images are allowed' };
        }

        // Read file buffer
        const fileBuffer = Buffer.from(await request.arrayBuffer());

        // Validate file size (max 10MB)
        if (fileBuffer.length > 10 * 1024 * 1024) {
            set.status = 413;
            return { error: 'File too large (max 10MB)' };
        }

        // Upload to Azure Blob Storage
        const imageUrl = await uploadNoteImage(params.id, auth.user._id, fileBuffer, contentType);

        return { url: imageUrl };
    })

    // Create a new note
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const note = await createNote(auth.user._id, body);
            return { note };
        },
        {
            body: t.Object({
                type: t.Optional(
                    t.Union([
                        t.Literal('write'),
                        t.Literal('lego'),
                        t.Literal('draw'),
                        t.Literal('kanban'),
                    ]),
                ),
                title: t.Optional(t.String({ maxLength: 500 })),
                content: t.Optional(t.Any()),
                tagId: t.Optional(t.String()),
            }),
        },
    )

    // Update a note
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const note = await updateNote(params.id, auth.user._id, body);

            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            return { note };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                title: t.Optional(t.String({ maxLength: 500 })),
                content: t.Optional(t.Any()),
                tagId: t.Optional(t.String()),
                isFavorite: t.Optional(t.Boolean()),
                isArchived: t.Optional(t.Boolean()),
                isTrashed: t.Optional(t.Boolean()),
            }),
        },
    )

    // Move note to trash
    .post(
        '/:id/trash',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const note = await moveNoteToTrash(params.id, auth.user._id);

            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            return { note };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Restore note from trash
    .post(
        '/:id/restore',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const note = await restoreNoteFromTrash(params.id, auth.user._id);

            if (!note) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            return { note };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Permanently delete a note
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const deleted = await deleteNote(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Note not found' };
            }

            return { message: 'Note deleted permanently' };
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
        return { message: `Deleted ${count} notes from trash`, count };
    });
