import { Elysia, t } from 'elysia';
import { jwtPlugin } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import { eventStreamService } from '../services/event-stream.service';
import { customAlphabet } from 'nanoid';

// Generate short connection IDs
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 12);

/**
 * Event Stream Routes
 * Provides Server-Sent Events (SSE) endpoint for real-time app updates
 */
export const eventRoutes = new Elysia({ prefix: '/sse/events' })
    .use(jwtPlugin)

    // SSE stream endpoint for real-time app events
    .get(
        '/stream',
        async ({ jwt, query, set, request }) => {
            const token = query.token;

            // Verify JWT token (from query param since EventSource doesn't support headers)
            if (!token) {
                set.status = 401;
                return { error: 'Missing token' };
            }

            try {
                const payload = (await jwt.verify(token)) as JWTPayload | false;
                if (!payload) {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                const userId = user._id;
                const connectionId = nanoid(); // Generate unique connection ID

                console.log(
                    `[Event Stream Route] Creating SSE stream for user: ${userId} (connection: ${connectionId})`,
                );

                // Create SSE stream
                const stream = new ReadableStream({
                    start(controller) {
                        console.log(
                            `[Event Stream Route] Stream started for user: ${userId} (connection: ${connectionId})`,
                        );

                        // Register this SSE connection
                        eventStreamService.registerConnection(userId, controller, connectionId);

                        // Send initial connection event
                        const welcome = `data: ${JSON.stringify({ type: 'connected', userId })}\n\n`;
                        controller.enqueue(new TextEncoder().encode(welcome));
                        console.log(`[Event Stream Route] Sent welcome message to user: ${userId}`);

                        // Keep-alive ping every 15 seconds (browsers close idle SSE after ~20s)
                        const keepAlive = setInterval(() => {
                            try {
                                controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
                            } catch {
                                clearInterval(keepAlive);
                            }
                        }, 15000);

                        // Clean up on client disconnect
                        request.signal.addEventListener('abort', () => {
                            clearInterval(keepAlive);
                            eventStreamService.unregisterConnection(userId, connectionId);
                            try {
                                controller.close();
                            } catch {}
                        });
                    },

                    cancel() {
                        // Client closed connection
                        eventStreamService.unregisterConnection(userId, connectionId);
                    },
                });

                return new Response(stream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                    },
                });
            } catch (error) {
                console.error('[Event Stream] Authentication error:', error);
                set.status = 401;
                return { error: 'Invalid token' };
            }
        },
        {
            query: t.Object({
                token: t.Optional(t.String()),
            }),
        },
    )

    // Get statistics (for debugging/monitoring)
    .get('/stats', async ({ jwt, request, set }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) {
                set.status = 401;
                return { error: 'Invalid token' };
            }

            const stats = eventStreamService.getStats();
            return { stats };
        } catch {
            set.status = 401;
            return { error: 'Invalid token' };
        }
    });
