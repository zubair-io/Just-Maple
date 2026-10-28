import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { UpdateReplyDraftSchema, type JWTPayload } from '@maple/shared';
import { ActionError } from '../services/bot-action.service';
import { discardReplyDraft, openReplyDraft, saveReplyDraft } from '../services/reply-draft.service';

/**
 * Drafted replies (reply-draft.service): the owner's card actions. Reading a draft is
 * `GET /api/bot-actions/:id`, which gives the text to its owner only. Nothing here sends.
 *
 * - `PATCH /api/reply-drafts/:id` { body } saves the owner's edits.
 * - `POST /api/reply-drafts/:id/open` { body? } records "Open in Messages / Mail" and
 *   returns the compose link.
 * - `POST /api/reply-drafts/:id/discard`.
 */
export const replyDraftRoutes = new Elysia({ prefix: '/api/reply-drafts' })
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

    .patch(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return {
                    action: await saveReplyDraft(
                        params.id,
                        auth.user._id,
                        body.body,
                        body.updatedAt,
                    ),
                };
            } catch (error) {
                return failure(error, set);
            }
        },
        { params: t.Object({ id: t.String() }), body: UpdateReplyDraftSchema },
    )

    .post(
        '/:id/open',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return await openReplyDraft(params.id, auth.user._id, body?.body);
            } catch (error) {
                return failure(error, set);
            }
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Optional(
                t.Object({ body: t.Optional(t.String({ minLength: 1, maxLength: 5000 })) }),
            ),
        },
    )

    .post(
        '/:id/discard',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return { action: await discardReplyDraft(params.id, auth.user._id) };
            } catch (error) {
                return failure(error, set);
            }
        },
        { params: t.Object({ id: t.String() }) },
    );

function failure(error: unknown, set: { status?: number | string }) {
    if (!(error instanceof ActionError)) throw error;
    set.status = error.status;
    return { error: error.message };
}
