import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById, findUserByEmail } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findTagsByUserId,
    findTagById,
    createTag,
    updateTag,
    deleteTag,
    shareTag,
    unshareTag,
    updateTagPublicStatus,
    getTagMembers,
    getTagMembersWithUserData,
    getAccessLevel,
    shareBotToTag,
    unshareBotFromTag,
} from '../repositories/tag.repo';
import { findUserBotsForTag } from '../repositories/user-bot.repo';
import { sendNotification } from '../services/notification.service';

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

    // Get all tags for the current user
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }
        const tags = await findTagsByUserId(auth.user._id);
        return { tags };
    })

    // Get a single tag by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const tag = await findTagById(params.id, auth.user._id);

            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { tag };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new tag
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const tag = await createTag(auth.user._id, body);
            return { tag };
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

    // Update a tag
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const tag = await updateTag(params.id, auth.user._id, body);

            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { tag };
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

    // Delete a tag
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const deleted = await deleteTag(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { message: 'Tag deleted successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get tag members (users with access) including full user data
    .get(
        '/:id/members',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const members = await getTagMembersWithUserData(params.id, auth.user._id);
            if (!members) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            return { members };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Share tag with user (by email)
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

            const tag = await shareTag(params.id, auth.user._id, {
                userId: targetUser._id,
                accessLevel: body.accessLevel,
            });

            if (!tag) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to share this tag',
                };
            }

            // Send notification to the user who received the share
            try {
                await sendNotification(targetUser._id, 'share_received', {
                    tagId: params.id,
                    sharedBy: auth.user._id,
                    tagLabel: tag.label,
                });
            } catch (error) {
                console.error('[Tags] Failed to send share notification:', error);
                // Don't fail the request if notification fails
            }

            return { tag };
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

    // Remove user's access to tag
    .delete(
        '/:id/share/:userId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = await unshareTag(params.id, auth.user._id, params.userId);

            if (!tag) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to unshare this tag',
                };
            }

            return { tag };
        },
        {
            params: t.Object({
                id: t.String(),
                userId: t.String(),
            }),
        },
    )

    // Update tag's public status
    .put(
        '/:id/public',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = await updateTagPublicStatus(params.id, auth.user._id, body.isPublic);

            if (!tag) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to change public status',
                };
            }

            return { tag };
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

    // Get current user's access level for a tag
    .get(
        '/:id/access',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = await findTagById(params.id, auth.user._id);
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            const accessLevel = getAccessLevel(tag, auth.user._id);

            return { accessLevel };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get bots shared with this tag
    .get(
        '/:id/shared-bots',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const tag = await findTagById(params.id, auth.user._id);
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
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

    // Share bot with tag
    .post(
        '/:id/bots',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updatedTag = await shareBotToTag(params.id, auth.user._id, body.userBotId);

            if (!updatedTag) {
                set.status = 400;
                return { error: 'Failed to share bot' };
            }

            return { tag: updatedTag };
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

    // Remove bot from tag
    .delete(
        '/:id/bots/:userBotId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updatedTag = await unshareBotFromTag(params.id, auth.user._id, params.userBotId);

            if (!updatedTag) {
                set.status = 400;
                return { error: 'Failed to remove bot' };
            }

            return { tag: updatedTag };
        },
        {
            params: t.Object({
                id: t.String(),
                userBotId: t.String(),
            }),
        },
    );
