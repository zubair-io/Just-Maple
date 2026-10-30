import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import type { JWTPayload } from '@maple/shared';
import { findUserById } from '../repositories/user.repo';
import {
    messageDirectory,
    messageHistoryPage,
    MessageHistoryAccessError,
} from '../services/message-history.service';
import {
    previewMessageArchive,
    messageArchiveProgress,
    startMessageArchive,
    pauseMessageArchive,
    listMessageArchives,
} from '../services/message-archive.service';

const query = t.Object({
    pageId: t.Optional(t.String({ maxLength: 200 })),
    search: t.Optional(t.String({ maxLength: 300 })),
    platform: t.Optional(t.String({ maxLength: 32 })),
    from: t.Optional(t.Numeric({ minimum: 0 })),
    to: t.Optional(t.Numeric({ minimum: 0 })),
    includeAutomated: t.Optional(t.BooleanString()),
    conversation: t.Optional(t.String({ maxLength: 1000 })),
    offset: t.Optional(t.Numeric({ minimum: 0 })),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
    around: t.Optional(t.String({ maxLength: 1000 })),
    before: t.Optional(t.String({ maxLength: 1000 })),
});
const params = t.Object({ id: t.String({ format: 'uuid' }) });
export const messageHistoryRoutes = new Elysia({ prefix: '/api' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const header = request.headers.get('authorization');
        if (!header?.startsWith('Bearer ')) return { auth: null as AuthContext | null };
        try {
            const payload = (await jwt.verify(header.slice(7))) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            return { auth: user ? ({ user, payload } as AuthContext) : null };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })
    .get(
        '/device-data/message-conversations',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return await messageDirectory(auth.user._id, query);
            } catch (error) {
                if (!(error instanceof MessageHistoryAccessError)) throw error;
                set.status = error.status;
                return {
                    error: error.message,
                    ownerOnly: error.status === 403,
                    access: error.access,
                };
            }
        },
        { query },
    )
    .get(
        '/device-data/message-history',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return await messageHistoryPage(auth.user._id, query);
            } catch (error) {
                if (!(error instanceof MessageHistoryAccessError)) throw error;
                set.status = error.status;
                return {
                    error: error.message,
                    ownerOnly: error.status === 403,
                    access: error.access,
                };
            }
        },
        { query },
    )
    .get('/message-archives', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        return { imports: await listMessageArchives(auth.user._id) };
    })
    .post(
        '/message-archives/preview',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return await previewMessageArchive(auth.user._id, body.file);
            } catch (error) {
                set.status = 400;
                return { error: (error as Error).message };
            }
        },
        { body: t.Object({ file: t.File({ maxSize: '100m' }) }) },
    )
    .get(
        '/message-archives/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const job = await messageArchiveProgress(auth.user._id, params.id);
            if (!job) {
                set.status = 404;
                return { error: 'Import not found' };
            }
            return job;
        },
        { params },
    )
    .post(
        '/message-archives/:id/start',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                const job = await startMessageArchive(auth.user._id, params.id, body);
                if (!job) {
                    set.status = 404;
                    return { error: 'Import not found' };
                }
                return job;
            } catch (error) {
                set.status = 400;
                return { error: (error as Error).message };
            }
        },
        {
            params,
            body: t.Object({
                timeZone: t.String({ maxLength: 100 }),
                dataset: t.String({ maxLength: 64 }),
                platforms: t.Array(t.String({ maxLength: 32 }), { maxItems: 100 }),
            }),
        },
    )
    .post(
        '/message-archives/:id/pause',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const job = await pauseMessageArchive(auth.user._id, params.id);
            if (!job) {
                set.status = 404;
                return { error: 'Import not found' };
            }
            return job;
        },
        { params },
    );
