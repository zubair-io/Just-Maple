import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findUserBotById } from '../repositories/user-bot.repo';
import {
    BotActionKindSchema,
    BotActionStatusSchema,
    UpdateBotAutonomySchema,
    type JWTPayload,
} from '@maple/shared';
import { ActionError, getAutonomySettings, setAutonomy } from '../services/bot-action.service';
import {
    getActivityItem,
    listBotActivity,
    listNotebookActivity,
    undoActivityItem,
} from '../services/bot-activity.service';

/**
 * The bot action log and autonomy settings (bot-action.service, bot-activity.service).
 * People only: bots never read or change these.
 *
 * - `GET /api/bot-actions?botId=…|notebookId=…&kind=&status=&limit=` newest first.
 * - `GET /api/bot-actions/:id` one row (a "Done · Undo" card).
 * - `POST /api/bot-actions/:id/undo` the owner's Undo.
 * - `GET /api/bot-autonomy/:botId`, `PUT /api/bot-autonomy/:botId` { kind, autonomy }:
 *   the owner's settings for one of their bots.
 */
export const botActionRoutes = new Elysia({ prefix: '/api' })
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
        '/bot-actions',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const filters = {
                ...(query.kind ? { kind: query.kind } : {}),
                ...(query.status ? { status: query.status } : {}),
                ...(query.limit ? { limit: query.limit } : {}),
            };
            try {
                if (query.botId)
                    return { actions: await listBotActivity(auth.user._id, query.botId, filters) };
                if (query.notebookId)
                    return {
                        actions: await listNotebookActivity(
                            auth.user._id,
                            query.notebookId,
                            filters,
                        ),
                    };
                set.status = 400;
                return { error: 'Bad request', message: 'botId or notebookId is required' };
            } catch (error) {
                return failure(error, set);
            }
        },
        {
            query: t.Object({
                botId: t.Optional(t.String()),
                notebookId: t.Optional(t.String()),
                kind: t.Optional(BotActionKindSchema),
                status: t.Optional(BotActionStatusSchema),
                limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
            }),
        },
    )

    .get(
        '/bot-actions/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const action = await getActivityItem(params.id, auth.user._id);
            if (!action) {
                set.status = 404;
                return { error: 'Not found', message: 'Action not found' };
            }
            return { action };
        },
        { params: t.Object({ id: t.String() }) },
    )

    .post(
        '/bot-actions/:id/undo',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return { action: await undoActivityItem(params.id, auth.user._id) };
            } catch (error) {
                return failure(error, set);
            }
        },
        { params: t.Object({ id: t.String() }) },
    )

    .get(
        '/bot-autonomy/:botId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await ownsBot(auth.user._id, params.botId))) {
                set.status = 404;
                return { error: 'Not found', message: 'Bot not found' };
            }
            return { settings: await getAutonomySettings(auth.user._id, params.botId) };
        },
        { params: t.Object({ botId: t.String() }) },
    )

    .put(
        '/bot-autonomy/:botId',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await ownsBot(auth.user._id, params.botId))) {
                set.status = 404;
                return { error: 'Not found', message: 'Bot not found' };
            }
            try {
                return {
                    settings: await setAutonomy(
                        auth.user._id,
                        params.botId,
                        body.kind,
                        body.autonomy,
                    ),
                };
            } catch (error) {
                return failure(error, set);
            }
        },
        { params: t.Object({ botId: t.String() }), body: UpdateBotAutonomySchema },
    );

async function ownsBot(userId: string, botId: string): Promise<boolean> {
    const bot = await findUserBotById(botId);
    return !!bot && bot.userId === userId;
}

function failure(error: unknown, set: { status?: number | string }) {
    if (!(error instanceof ActionError)) throw error;
    set.status = error.status;
    return { error: error.message };
}
