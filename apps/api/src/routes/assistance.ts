import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import { AssistanceError } from '../services/assistance-access.service';
import {
    assistanceBots,
    saveAssistanceDraft,
    openAssistance,
    assistanceHistory,
    sendAssistance,
    stopAssistance,
    saveAssistanceResult,
    prepareFollowUpReply,
} from '../services/assistance.service';
import { todayFeed } from '../services/today.service';
const id = t.String({ minLength: 1, maxLength: 400 });
const requestId = t.String({ pattern: '^[A-Za-z0-9_-]{8,128}$' });
async function handle<T>(set: { status?: number | string }, work: () => Promise<T>) {
    try {
        return await work();
    } catch (error) {
        set.status = error instanceof AssistanceError ? error.status : 500;
        return {
            error: 'Assistance unavailable',
            message:
                error instanceof AssistanceError
                    ? error.message
                    : 'Could not finish the request. Your saved work is retained.',
        };
    }
}
export const assistanceRoutes = new Elysia({ prefix: '/api/assistance' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const header = request.headers.get('authorization');
        if (!header?.startsWith('Bearer ')) return { auth: null as AuthContext | null };
        try {
            const payload = (await jwt.verify(header.slice(7))) as JWTPayload | false;
            const user = payload ? await findUserById(payload.sub) : null;
            return { auth: user && payload ? ({ user, payload } as AuthContext) : null };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })
    .get(
        '/bots/:notebookId',
        ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, async () => ({
                bots: await assistanceBots(params.notebookId, auth.user._id),
            }));
        },
        { params: t.Object({ notebookId: id }) },
    )
    .post(
        '/conversations',
        ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, async () => ({
                conversation: await openAssistance(auth.user._id, body.pageId, body.botId),
            }));
        },
        { body: t.Object({ pageId: id, botId: id }) },
    )
    .get(
        '/conversations/:id',
        ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, () => assistanceHistory(params.id, auth.user._id, query.before));
        },
        { params: t.Object({ id }), query: t.Object({ before: t.Optional(id) }) },
    )
    .patch(
        '/conversations/:id/draft',
        ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, async () => ({
                conversation: await saveAssistanceDraft(
                    params.id,
                    auth.user._id,
                    body.text,
                    body.version,
                ),
            }));
        },
        {
            params: t.Object({ id }),
            body: t.Object({
                text: t.String({ maxLength: 10000 }),
                version: t.Integer({ minimum: 0 }),
            }),
        },
    )
    .post(
        '/conversations/:id/messages',
        ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, async () => ({
                task: await sendAssistance(params.id, auth.user._id, body),
            }));
        },
        {
            params: t.Object({ id }),
            body: t.Object({
                requestId,
                text: t.String({ minLength: 1, maxLength: 10000 }),
                selection: t.Optional(t.String({ maxLength: 10000 })),
            }),
        },
    )
    .post(
        '/tasks/:id/stop',
        ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, async () => ({
                task: await stopAssistance(params.id, auth.user._id),
            }));
        },
        { params: t.Object({ id }) },
    )
    .post(
        '/tasks/:id/save',
        ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, async () => ({
                page: await saveAssistanceResult(
                    params.id,
                    auth.user._id,
                    body.title,
                    body.notebookId,
                ),
            }));
        },
        {
            params: t.Object({ id }),
            body: t.Object({ title: t.String({ minLength: 1, maxLength: 200 }), notebookId: id }),
        },
    )
    .get(
        '/today/:notebookId',
        ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, () =>
                todayFeed(
                    auth.user._id,
                    params.notebookId,
                    query.section || 'needs-you',
                    query,
                    query.limit || 20,
                ),
            );
        },
        {
            params: t.Object({ notebookId: id }),
            query: t.Object({
                section: t.Optional(
                    t.Union([
                        t.Literal('needs-you'),
                        t.Literal('working'),
                        t.Literal('review'),
                        t.Literal('recent'),
                    ]),
                ),
                followBefore: t.Optional(id),
                actionBefore: t.Optional(id),
                taskBefore: t.Optional(id),
                limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
            }),
        },
    )
    .post(
        '/today/:notebookId/draft',
        ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return handle(set, () =>
                prepareFollowUpReply(
                    params.notebookId,
                    auth.user._id,
                    body.followUpId,
                    body.botId,
                    body.requestId,
                ),
            );
        },
        {
            params: t.Object({ notebookId: id }),
            body: t.Object({ followUpId: id, botId: id, requestId }),
        },
    );
