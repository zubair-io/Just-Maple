import { Elysia } from 'elysia';
import { config } from '../config';

/**
 * Shared OAuth callback endpoint.
 *
 * Google OAuth redirects here after user consent. The endpoint decodes
 * the `state` parameter to determine whether the request came from a
 * web browser or a native app:
 *
 *   - web:    302 redirects to {origin}/gmail/oauth/callback with code,
 *             state, and svc query params for the Angular callback route.
 *   - native: Returns an HTML page that navigates to justmaple:// scheme
 *             (caught by ASWebAuthenticationSession)
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
        let svc = 'gmail'; // default service identifier

        try {
            const json = JSON.parse(
                Buffer.from(rawState.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
                    'utf-8',
                ),
            );
            originalState = json.s || rawState;
            platform = json.p || 'web';
            if (json.o) origin = json.o;
            if (json.svc) svc = json.svc;
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

        set.headers['cache-control'] = 'no-store';

        // Native: use JS redirect to custom scheme.
        // ASWebAuthenticationSession detects JS-initiated navigation to the
        // callback scheme more reliably than a 302 redirect.
        if (platform === 'native') {
            const params = new URLSearchParams();
            if (code) params.set('code', code);
            if (error) params.set('error', error);
            if (scope) params.set('scope', scope);
            params.set('state', originalState);

            const nativeUrl = `justmaple://gmail/oauth/callback?${params.toString()}`;

            set.headers['content-type'] = 'text/html; charset=utf-8';
            return `<!DOCTYPE html>
<html><head><title>Completing sign-in…</title></head>
<body>
<p>Completing sign-in…</p>
<script>window.location.href = ${JSON.stringify(nativeUrl)};</script>
</body></html>`;
        }

        // Web: 302 redirect to the Angular callback route.
        // The callback component handles token exchange and navigation.
        const redirectParams = new URLSearchParams();
        if (code) redirectParams.set('code', code);
        redirectParams.set('state', originalState);
        redirectParams.set('svc', svc);
        if (error) redirectParams.set('error', error);

        set.status = 302;
        set.headers['location'] = `${origin}/gmail/oauth/callback?${redirectParams.toString()}`;
        return;
    },
);
