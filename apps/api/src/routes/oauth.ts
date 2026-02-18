import { Elysia } from 'elysia';
import { config } from '../config';

/**
 * Shared OAuth callback endpoint.
 *
 * Google OAuth redirects here after user consent. The endpoint decodes
 * the `state` parameter to determine whether the request came from a
 * web browser popup or a native app:
 *
 *   - web:    Returns an HTML page that posts the result back to the
 *             opener window via BroadcastChannel and closes itself.
 *   - native: 302 → justmaple://gmail/oauth/callback?code=...&state=...
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

        const safeCode = escapeHtml(code || '');
        const safeState = escapeHtml(originalState);
        const safeError = escapeHtml(error || '');

        set.headers['content-type'] = 'text/html; charset=utf-8';
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

            return `<!DOCTYPE html>
<html><head><title>Completing sign-in…</title></head>
<body>
<p>Completing sign-in…</p>
<script>window.location.href = ${JSON.stringify(nativeUrl)};</script>
</body></html>`;
        }

        // Web: post the result via BroadcastChannel and close.
        // BroadcastChannel works across same-origin tabs/popups even when
        // Cross-Origin-Opener-Policy blocks window.opener access.
        return `<!DOCTYPE html>
<html><head><title>Completing sign-in…</title></head>
<body>
<p>Completing sign-in…</p>
<script>
(function() {
  var data = {
    type: 'gmail_oauth_callback',
    code: ${JSON.stringify(safeCode)} || undefined,
    state: ${JSON.stringify(safeState)},
    error: ${JSON.stringify(safeError)} || undefined
  };

  // Use BroadcastChannel (works with Cross-Origin-Opener-Policy)
  try {
    var bc = new BroadcastChannel('oauth_callback');
    bc.postMessage(data);
    bc.close();
  } catch(e) {}

  window.close();

  // Fallback: if window.close() is blocked, show a message
  setTimeout(function() {
    document.body.innerHTML = '<p>Sign-in complete. You can close this window.</p>';
  }, 300);
})();
</script>
</body></html>`;
    },
);

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
