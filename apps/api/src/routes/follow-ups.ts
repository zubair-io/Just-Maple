import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { isNotebookMember, type JWTPayload } from '@maple/shared';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { findFollowUpsPage } from '../repositories/page.repo';
import { changeFollowUp, FollowUpError, getFollowUpList } from '../services/follow-up.service';

/**
 * A notebook's Follow-ups page. Each member reads their own follow-ups, only those the
 * notebook's data pages share the evidence for, and marks them done, snoozes, dismisses
 * or reopens them. Public readers get nothing: data pages are for members.
 */

const NOT_FOUND = {
    error: 'Not found',
    message: 'Follow-ups are for members of this notebook, once it has a Follow-ups page.',
};

async function memberNotebook(auth: AuthContext, notebookId: string) {
    const notebook = await findNotebookByIdWithAccess(notebookId, auth.user._id, 'read').catch(
        () => null,
    );
    if (!notebook || !isNotebookMember(notebook, auth.user._id)) return null;
    if (!(await findFollowUpsPage(notebookId))) return null;
    return notebook;
}

export const followUpRoutes = new Elysia({ prefix: '/api/follow-ups' })
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
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await memberNotebook(auth, params.notebookId))) {
                set.status = 404;
                return NOT_FOUND;
            }
            return getFollowUpList(params.notebookId, auth.user._id);
        },
        { params: t.Object({ notebookId: t.String() }) },
    )

    // Your own follow-ups only (they're found in your data); every change can be undone.
    .patch(
        '/:notebookId/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await memberNotebook(auth, params.notebookId))) {
                set.status = 404;
                return NOT_FOUND;
            }
            let until: number | undefined;
            if (body.until !== undefined) {
                const parsed = Date.parse(body.until);
                if (!Number.isFinite(parsed)) {
                    set.status = 400;
                    return { error: 'Invalid request', message: 'Snooze until a valid date' };
                }
                until = Math.floor(parsed / 1000);
            }
            try {
                return {
                    followUp: await changeFollowUp(
                        params.notebookId,
                        auth.user._id,
                        params.id,
                        body.action,
                        { ...(until !== undefined ? { until } : {}), by: { type: 'user' } },
                    ),
                };
            } catch (error) {
                if (!(error instanceof FollowUpError)) throw error;
                set.status = error.status;
                return {
                    error: error.status === 404 ? 'Not found' : 'Invalid request',
                    message: error.message,
                };
            }
        },
        {
            params: t.Object({ notebookId: t.String(), id: t.String() }),
            body: t.Object({
                action: t.Union([
                    t.Literal('done'),
                    t.Literal('snooze'),
                    t.Literal('dismiss'),
                    t.Literal('reopen'),
                ]),
                until: t.Optional(t.String({ maxLength: 64 })),
            }),
        },
    );
