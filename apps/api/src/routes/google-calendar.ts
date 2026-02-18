import { Elysia, t } from 'elysia';
import { jwtPlugin, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import { config } from '../config';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const googleCalendarRoutes = new Elysia({ prefix: '/api/google-calendar' })
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
    .get('/config', () => ({
        clientId: config.gmailClientId,
    }))
    .post(
        '/token',
        async ({ body, set }) => {
            const params = new URLSearchParams({
                client_id: config.gmailClientId,
                client_secret: config.gmailClientSecret,
                code: body.code,
                code_verifier: body.code_verifier,
                grant_type: 'authorization_code',
                redirect_uri: body.redirect_uri,
            });

            const response = await fetch(GOOGLE_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });

            const data = await response.json();

            if (!response.ok) {
                set.status = response.status;
                return { error: data.error, error_description: data.error_description };
            }

            return data;
        },
        {
            body: t.Object({
                code: t.String(),
                code_verifier: t.String(),
                redirect_uri: t.String(),
            }),
        },
    )
    .post(
        '/refresh',
        async ({ body, set }) => {
            const params = new URLSearchParams({
                client_id: config.gmailClientId,
                client_secret: config.gmailClientSecret,
                refresh_token: body.refresh_token,
                grant_type: 'refresh_token',
            });

            const response = await fetch(GOOGLE_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });

            const data = await response.json();

            if (!response.ok) {
                set.status = response.status;
                return { error: data.error, error_description: data.error_description };
            }

            return data;
        },
        {
            body: t.Object({
                refresh_token: t.String(),
            }),
        },
    );
