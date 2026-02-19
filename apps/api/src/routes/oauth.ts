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
 *   - native: 302 redirects to justmaple:// scheme
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
            console.log(
                '[OAuth] Decoded state: platform=%s, svc=%s, origin=%s',
                platform,
                svc,
                origin,
            );
        } catch {
            // State isn't encoded — pass through as-is
            console.log('[OAuth] State not encoded, using raw state');
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

        // Native: 302 redirect to custom scheme.
        // ASWebAuthenticationSession intercepts HTTP redirects to the
        // callback scheme at the network level, which is more reliable
        // on iOS than JS-initiated navigations (window.location.href).
        if (platform === 'native') {
            const params = new URLSearchParams();
            if (code) params.set('code', code);
            if (error) params.set('error', error);
            if (scope) params.set('scope', scope);
            params.set('state', originalState);

            const nativeUrl = `justmaple://gmail/oauth/callback?${params.toString()}`;
            console.log('[OAuth] Redirecting native to: %s', nativeUrl);

            set.status = 302;
            set.headers['location'] = nativeUrl;
            return;
        }

        // Web: 302 redirect to the Angular callback route.
        // The callback component handles token exchange and navigation.
        const redirectParams = new URLSearchParams();
        if (code) redirectParams.set('code', code);
        redirectParams.set('state', originalState);
        redirectParams.set('svc', svc);
        if (error) redirectParams.set('error', error);

        const webRedirect = `${origin}/gmail/oauth/callback?${redirectParams.toString()}`;
        console.log('[OAuth] Redirecting web to: %s', webRedirect);

        set.status = 302;
        set.headers['location'] = webRedirect;
        return;
    },
);
