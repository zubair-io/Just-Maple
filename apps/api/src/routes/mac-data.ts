import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findDeviceDataPages } from '../repositories/page.repo';
import { listCollectors } from '../repositories/collector.repo';
import type { JWTPayload, MacDataSource } from '@maple/shared';

/**
 * What a notebook's proactive bot can watch: the signed-in user's device data pages in
 * that notebook, and when their devices last uploaded. No message, email or event content.
 */
export const macDataRoutes = new Elysia({ prefix: '/api/mac-data' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
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
        '/status',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const [pages, collectors] = await Promise.all([
                query.notebookId ? findDeviceDataPages(auth.user._id, query.notebookId) : [],
                listCollectors(auth.user._id),
            ]);
            const sources = [
                ...new Set(pages.map((page) => page.deviceSource).filter(Boolean)),
            ] as MacDataSource[];
            const latest = (key: 'lastSeenAt' | 'lastUploadAt') =>
                collectors
                    .map((c) => c[key])
                    .filter((value): value is string => !!value)
                    .sort()
                    .at(-1);
            return {
                // A device checked in within the last half hour.
                online: collectors.some(
                    (c) => !!c.lastSeenAt && Date.now() - Date.parse(c.lastSeenAt) < 30 * 60_000,
                ),
                lastSeenAt: latest('lastSeenAt'),
                lastUploadAt: latest('lastUploadAt'),
                timeZone: collectors.find((c) => c.timeZone)?.timeZone,
                sources,
            };
        },
        { query: t.Object({ notebookId: t.Optional(t.String()) }) },
    );
