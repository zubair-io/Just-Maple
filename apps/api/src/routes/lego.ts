import { Elysia } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import { getLegos } from '../services/lego.service';

export const legoRoutes = new Elysia({ prefix: '/api/lego' })
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

    // Get LEGO dataset
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        try {
            const legos = await getLegos();

            // Cache response for 1 hour
            set.headers['Cache-Control'] = 'private, max-age=3600';

            return { legos };
        } catch (error: any) {
            console.error('[Lego Route] Failed to fetch legos:', error);
            set.status = 500;
            return { error: 'Failed to fetch LEGO dataset', message: error.message };
        }
    });
