import { Elysia } from 'elysia';
import { config } from '../config';

/**
 * Shared OAuth callback endpoint.
 *
 * Google OAuth redirects here after user consent. The endpoint decodes
 * the `state` parameter to determine whether the request came from a
 * web browser popup or a native app, then redirects accordingly:
 *
 *   - web:    302 → {origin}/gmail/oauth/callback?code=...&state=...
 *   - native: 302 → justmaple://gmail/oauth/callback?code=...&state=...
 */
export const oauthRoutes = new Elysia({ prefix: '/api/oauth' }).get(
    '/callback',
    ({ query, set }) => {
        const { code, error, scope } = query;
        const rawState = (query.state as string) || '';

        // Decode the state payload
        let originalState = rawState;
        let platform = 'web';
        let origin = config.origin;

        try {
            const json = JSON.parse(
                Buffer.from(rawState.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
                    'utf-8',
                ),
            );
            originalState = json.s || rawState;
            platform = json.p || 'web';
            if (json.o) origin = json.o;
        } catch {
            // State isn't encoded — pass through as-is
        }

        // Validate origin against CORS allowlist to prevent open redirects
        if (platform === 'web') {
            const allowed = config.corsOrigins.some(
                (o) => o === origin || origin === config.origin,
            );
            if (!allowed) {
                origin = config.origin;
            }
        }

        // Build the target callback URL
        const params = new URLSearchParams();
        if (code) params.set('code', code);
        if (error) params.set('error', error);
        if (scope) params.set('scope', scope);
        params.set('state', originalState);

        let redirectUrl: string;
        if (platform === 'native') {
            redirectUrl = `justmaple://gmail/oauth/callback?${params.toString()}`;
        } else {
            redirectUrl = `${origin}/gmail/oauth/callback?${params.toString()}`;
        }

        set.status = 302;
        set.headers['location'] = redirectUrl;
        set.headers['cache-control'] = 'no-store';
    },
);
