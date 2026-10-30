import { Elysia, t } from 'elysia';
import { config } from '../config';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    getServerNetworkSettings,
    setServerLocalAddress,
} from '../repositories/server-network.repo';

export const serverInfoRoutes = new Elysia().get('/api/server-info', async ({ set }) => {
    set.headers['cache-control'] = 'no-store';
    if (!config.instanceId) {
        set.status = 503;
        return { error: 'Server identity is not configured' };
    }
    const { publicUrl, localUrl } = await getServerNetworkSettings();
    return { instanceId: config.instanceId, publicUrl, localUrl };
});

export const serverNetworkSettingsRoutes = new Elysia({ prefix: '/api/server/settings' })
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
    .onBeforeHandle(({ auth, set }) => {
        set.headers['cache-control'] = 'no-store';
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        if (auth.user.admin !== true) {
            set.status = 403;
            return { error: 'Server administrator access required' };
        }
    })
    .get('/network', () => getServerNetworkSettings())
    .put(
        '/network',
        async ({ body, set }) => {
            try {
                return await setServerLocalAddress(body.localUrl);
            } catch (error) {
                if (
                    error instanceof TypeError ||
                    (error instanceof Error && error.message.startsWith('Enter a hostname'))
                ) {
                    set.status = 400;
                    return {
                        error: 'Enter a hostname or HTTPS origin without credentials, a path, query or fragment.',
                    };
                }
                throw error;
            }
        },
        { body: t.Object({ localUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]) }) },
    );
