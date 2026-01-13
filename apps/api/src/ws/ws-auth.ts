import type { JWTPayload } from '@maple/shared';
import { findUserById } from '../repositories/user.repo';

/**
 * Authenticate WebSocket connection using JWT token from Sec-WebSocket-Protocol header
 * Falls back to query parameter for backward compatibility
 * Returns user ID if authentication succeeds, null otherwise
 */
export async function authenticateWebSocket(
    ws: any,
): Promise<{ userId: string; email: string } | null> {
    console.log('[WSAuth] New connection opened');

    // Try to get token from Sec-WebSocket-Protocol header first (recommended)
    const headers = ws.data.request.headers;
    const protocols = headers?.['sec-websocket-protocol'];
    let token: string | null = null;

    if (protocols) {
        // Protocol can be comma-separated if multiple subprotocols are specified
        // The token should be the first one
        token = protocols.split(',')[0]?.trim();
        console.log(
            '[WSAuth] Token from Sec-WebSocket-Protocol header:',
            token ? 'present' : 'missing',
        );
    }

    // Fallback: get token from query parameter (backward compatibility)
    if (!token) {
        const url = new URL(ws.data.request.url);
        token = url.searchParams.get('token');
        if (token) {
            console.log('[WSAuth] Token from query parameter (legacy):', 'present');
            console.warn(
                '[WSAuth] WARNING: Query parameter auth is deprecated. Use Sec-WebSocket-Protocol header instead.',
            );
        }
    }

    if (!token) {
        console.error('[WSAuth] No token provided in header or query');
        ws.close(1008, 'Authentication required');
        return null;
    }

    try {
        // Verify JWT token
        const payload = (await ws.data.jwt.verify(token)) as JWTPayload | false;

        if (!payload) {
            console.error('[WSAuth] Invalid token');
            ws.close(1008, 'Invalid token');
            return null;
        }

        // Verify user exists
        const user = await findUserById(payload.sub);
        if (!user) {
            console.error('[WSAuth] User not found');
            ws.close(1008, 'User not found');
            return null;
        }

        console.log(`[WSAuth] User authenticated: ${user.email}`);
        return { userId: user._id, email: user.email };
    } catch (error) {
        console.error('[WSAuth] Auth error:', error);
        ws.close(1008, 'Authentication failed');
        return null;
    }
}
