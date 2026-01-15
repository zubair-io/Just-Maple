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
    console.log('[WSAuth] ws.data:', JSON.stringify(Object.keys(ws.data || {})));

    // Try to get token from Sec-WebSocket-Protocol header first (recommended)
    const request = ws.data?.request;
    const headers = request?.headers;

    // Debug: log all available header access methods
    console.log('[WSAuth] request exists:', !!request);
    console.log('[WSAuth] headers type:', typeof headers);

    let token: string | null = null;

    // Try different ways to access the header
    if (headers) {
        // Try as Headers object (fetch API style)
        if (typeof headers.get === 'function') {
            const protocol = headers.get('sec-websocket-protocol');
            console.log(
                '[WSAuth] headers.get("sec-websocket-protocol"):',
                protocol ? 'present' : 'missing',
            );
            if (protocol) {
                token = protocol.split(',')[0]?.trim();
            }
        }

        // Try as plain object
        if (!token && headers['sec-websocket-protocol']) {
            console.log('[WSAuth] headers["sec-websocket-protocol"]:', 'present');
            token = headers['sec-websocket-protocol'].split(',')[0]?.trim();
        }

        // Try lowercase
        if (!token && headers['Sec-WebSocket-Protocol']) {
            console.log('[WSAuth] headers["Sec-WebSocket-Protocol"]:', 'present');
            token = headers['Sec-WebSocket-Protocol'].split(',')[0]?.trim();
        }
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
