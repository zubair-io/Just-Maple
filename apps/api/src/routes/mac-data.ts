import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findMacDataHost } from '../repositories/mac-data-host.repo';
import { macDataRelay } from '../services/mac-data-relay.service';
import type { JWTPayload } from '@maple/shared';

/**
 * Status of the signed-in user's Mac data host: whether their Mac is connected and which
 * sources a notebook has Mac pages for. No message, email or event content.
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
            const host = await findMacDataHost(auth.user._id);
            const notebook = query.notebookId
                ? host?.notebooks.find((n) => n.notebookId === query.notebookId)
                : undefined;
            return {
                online: await macDataRelay.isOnline(auth.user._id),
                lastSeenAt: host?.lastSeenAt,
                timeZone: host?.timeZone,
                sources: notebook?.sources ?? [],
            };
        },
        { query: t.Object({ notebookId: t.Optional(t.String()) }) },
    );
