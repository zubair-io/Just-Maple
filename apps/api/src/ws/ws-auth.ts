import type { JWTPayload } from '@maple/shared';
import { findUserById } from '../repositories/user.repo';

/**
 * Authenticate WebSocket connection using JWT token from Sec-WebSocket-Protocol header
 * Falls back to query parameter for backward compatibility
 * Returns user ID if authentication succeeds, null otherwise
 */
export async function authenticateWebSocket(
    ws: any,
): Promise<{ userId: string; email?: string } | null> {
    // Try to get token from Sec-WebSocket-Protocol header first (recommended)
    const request = ws.data?.request;
    const headers = request?.headers;

    let token: string | null = null;

    // Try different ways to access the header
    if (headers) {
        // Try as Headers object (fetch API style)
        if (typeof headers.get === 'function') {
            const protocol = headers.get('sec-websocket-protocol');
            if (protocol) {
                token = protocol.split(',')[0]?.trim();
            }
        }

        // Try as plain object
        if (!token && headers['sec-websocket-protocol']) {
            token = headers['sec-websocket-protocol'].split(',')[0]?.trim();
        }

        // Try lowercase
        if (!token && headers['Sec-WebSocket-Protocol']) {
            token = headers['Sec-WebSocket-Protocol'].split(',')[0]?.trim();
        }
    }

    // Fallback: get token from query parameter (backward compatibility)
    if (!token) {
        const url = new URL(ws.data.request.url);
        token = url.searchParams.get('token');
    }

    if (!token) {
        ws.close(1008, 'Authentication required');
        return null;
    }

    try {
        // Verify JWT token
        const payload = (await ws.data.jwt.verify(token)) as JWTPayload | false;

        if (!payload) {
            ws.close(1008, 'Invalid token');
            return null;
        }

        // Verify user exists
        const user = await findUserById(payload.sub);
        if (!user) {
            ws.close(1008, 'User not found');
            return null;
        }

        return { userId: user._id, email: user.email };
    } catch {
        ws.close(1008, 'Authentication failed');
        return null;
    }
}
