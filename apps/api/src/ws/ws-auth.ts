import type { JWTPayload } from '@maple/shared';
import { findUserById } from '../repositories/user.repo';

/**
 * Authenticate WebSocket connection using JWT token from query parameter
 * Returns user ID if authentication succeeds, null otherwise
 */
export async function authenticateWebSocket(
    ws: any,
): Promise<{ userId: string; email: string } | null> {
    console.log('[WSAuth] New connection opened');
    console.log('[WSAuth] URL:', ws.data.request.url);

    // Get token from query parameter
    const url = new URL(ws.data.request.url);
    const token = url.searchParams.get('token');

    console.log('[WSAuth] Token from query:', token ? 'present' : 'missing');

    if (!token) {
        console.error('[WSAuth] No token provided');
        ws.close();
        return null;
    }

    try {
        // Verify JWT token
        const payload = (await ws.data.jwt.verify(token)) as JWTPayload | false;

        if (!payload) {
            console.error('[WSAuth] Invalid token');
            ws.close();
            return null;
        }

        // Verify user exists
        const user = await findUserById(payload.sub);
        if (!user) {
            console.error('[WSAuth] User not found');
            ws.close();
            return null;
        }

        console.log(`[WSAuth] User authenticated: ${user.email}`);
        return { userId: user._id, email: user.email };
    } catch (error) {
        console.error('[WSAuth] Auth error:', error);
        ws.close();
        return null;
    }
}
