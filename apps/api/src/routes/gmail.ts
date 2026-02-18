import { Elysia, t } from 'elysia';
import { config } from '../config';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const gmailRoutes = new Elysia({ prefix: '/api/gmail' })
    .get('/config', () => ({
        clientId: config.gmailClientId,
        redirectUri: `${config.origin}/api/oauth/callback`,
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
