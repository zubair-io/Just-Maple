import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById, findUserByEmail } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findNotebooksByUserId,
    findNotebookById,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    shareNotebook,
    unshareNotebook,
    updateNotebookPublicStatus,
    getNotebookMembers,
    getNotebookMembersWithUserData,
    getAccessLevel,
    shareBotToNotebook,
    unshareBotFromNotebook,
} from '../repositories/notebook.repo';
import { findUserBotsForTag } from '../repositories/user-bot.repo';
import { sendNotification } from '../services/notification.service';

export const notebookRoutes = new Elysia({ prefix: '/api/notebooks' })
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

    // Get all notebooks for the current user
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }
        const notebooks = await findNotebooksByUserId(auth.user._id);
        return { notebooks };
    })

    // Get a single notebook by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const notebook = await findNotebookById(params.id, auth.user._id);

            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new notebook
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const notebook = await createNotebook(auth.user._id, body);
            return { notebook };
        },
        {
            body: t.Object({
                label: t.String({ minLength: 1, maxLength: 100 }),
                value: t.Optional(
                    t.Union([t.Literal('mixed'), t.Literal('recordings'), t.Literal('notes')]),
                ),
            }),
        },
    )

    // Update a notebook
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const notebook = await updateNotebook(params.id, auth.user._id, body);

            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                label: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
                value: t.Optional(
                    t.Union([t.Literal('mixed'), t.Literal('recordings'), t.Literal('notes')]),
                ),
            }),
        },
    )

    // Delete a notebook
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const deleted = await deleteNotebook(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { message: 'Notebook deleted successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get notebook members (users with access) including full user data
    .get(
        '/:id/members',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const members = await getNotebookMembersWithUserData(params.id, auth.user._id);
            if (!members) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { members };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Share notebook with user (by email)
    .post(
        '/:id/share',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Find user by email
            const targetUser = await findUserByEmail(body.email);
            if (!targetUser) {
                set.status = 404;
                return { error: 'User not found', message: 'No user with that email exists' };
            }

            const notebook = await shareNotebook(params.id, auth.user._id, {
                userId: targetUser._id,
                accessLevel: body.accessLevel,
            });

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to share this notebook',
                };
            }

            // Send notification to the user who received the share
            try {
                await sendNotification(targetUser._id, 'share_received', {
                    notebookId: params.id,
                    sharedBy: auth.user._id,
                    notebookLabel: notebook.label,
                });
            } catch (error) {
                console.error('[Notebooks] Failed to send share notification:', error);
                // Don't fail the request if notification fails
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                email: t.String({ format: 'email' }),
                accessLevel: t.Union([t.Literal('read'), t.Literal('write')]),
            }),
        },
    )

    // Remove user's access to notebook
    .delete(
        '/:id/share/:userId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await unshareNotebook(params.id, auth.user._id, params.userId);

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to unshare this notebook',
                };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
                userId: t.String(),
            }),
        },
    )

    // Update notebook's public status
    .put(
        '/:id/public',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await updateNotebookPublicStatus(
                params.id,
                auth.user._id,
                body.isPublic,
            );

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to change public status',
                };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                isPublic: t.Boolean(),
            }),
        },
    )

    // Get current user's access level for a notebook
    .get(
        '/:id/access',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            const accessLevel = getAccessLevel(notebook, auth.user._id);

            return { accessLevel };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get bots shared with this notebook
    .get(
        '/:id/shared-bots',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            const enrichedBots = await findUserBotsForTag(params.id);
            return { bots: enrichedBots };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Share bot with notebook
    .post(
        '/:id/bots',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updatedNotebook = await shareBotToNotebook(
                params.id,
                auth.user._id,
                body.userBotId,
            );

            if (!updatedNotebook) {
                set.status = 400;
                return { error: 'Failed to share bot' };
            }

            return { notebook: updatedNotebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                userBotId: t.String(),
            }),
        },
    )

    // Remove bot from notebook
    .delete(
        '/:id/bots/:userBotId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updatedNotebook = await unshareBotFromNotebook(
                params.id,
                auth.user._id,
                params.userBotId,
            );

            if (!updatedNotebook) {
                set.status = 400;
                return { error: 'Failed to remove bot' };
            }

            return { notebook: updatedNotebook };
        },
        {
            params: t.Object({
                id: t.String(),
                userBotId: t.String(),
            }),
        },
    );
