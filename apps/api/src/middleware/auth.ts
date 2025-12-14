import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload, UserResponse } from '@maple/shared';

export const jwtPlugin = jwt({
    name: 'jwt',
    secret: config.jwtSecret,
    exp: config.jwtExpiresIn,
});

export interface AuthContext {
    user: UserResponse;
    payload: JWTPayload;
}

export const authMiddleware = new Elysia({ name: 'auth-middleware' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }

        const token = authHeader.slice(7);

        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;

            if (!payload) {
                return { auth: null as AuthContext | null };
            }

            const user = await findUserById(payload.sub);

            if (!user) {
                return { auth: null as AuthContext | null };
            }

            return {
                auth: {
                    user,
                    payload,
                } as AuthContext,
            };
        } catch {
            return { auth: null as AuthContext | null };
        }
    });

// Helper function to check auth and return early if not authenticated
export function checkAuth(auth: AuthContext | null, set: { status: number }): auth is AuthContext {
    if (!auth) {
        set.status = 401;
        return false;
    }
    return true;
}

export const requireAuth = new Elysia({ name: 'require-auth' })
    .use(authMiddleware)
    .macro(({ onBeforeHandle }) => ({
        isAuth(enabled: boolean) {
            if (!enabled) return;
            onBeforeHandle(({ auth, set }) => {
                if (!auth) {
                    set.status = 401;
                    return { error: 'Unauthorized', message: 'Valid authentication required' };
                }
            });
        },
    }));
