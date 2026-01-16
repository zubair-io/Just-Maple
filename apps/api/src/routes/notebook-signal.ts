import { Elysia, t } from 'elysia';
import { jwtPlugin } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload, SignalMessage } from '@maple/shared';
import { yjsSSEService } from '../services/yjs-sse.service';

/**
 * Notebook Signaling Routes
 * WebRTC signaling relay for P2P collaboration
 */
export const notebookSignalRoutes = new Elysia({ prefix: '/sse/signal' })
    .use(jwtPlugin)

    /**
     * Relay WebRTC signaling message
     * POST /sse/signal/:noteId
     */
    .post(
        '/:noteId',
        async ({ jwt, params, body, request, set }) => {
            const { noteId } = params;

            // Auth from header
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

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Verify the sender is connected to this room
                if (!yjsSSEService.isClientConnected(noteId, body.from)) {
                    set.status = 403;
                    return { error: 'Client not connected to room' };
                }

                // Construct signal message
                const message: SignalMessage = {
                    type: body.type,
                    from: body.from,
                    to: body.to,
                    roomId: noteId,
                    payload: body.payload,
                    timestamp: new Date().toISOString(),
                };

                // Relay message via SSE
                yjsSSEService.relaySignal(noteId, message);

                return { success: true };
            } catch (error) {
                console.error('[Signal Relay] Error:', error);
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
            body: t.Object({
                type: t.Union([
                    t.Literal('announce'),
                    t.Literal('leave'),
                    t.Literal('offer'),
                    t.Literal('answer'),
                    t.Literal('ice-candidate'),
                ]),
                from: t.String(),
                to: t.Optional(t.String()),
                payload: t.Any(),
            }),
        },
    )

    /**
     * Announce presence in a room (alternative to SSE auto-announce)
     * POST /sse/signal/:noteId/announce
     */
    .post(
        '/:noteId/announce',
        async ({ jwt, params, body, request, set }) => {
            const { noteId } = params;

            // Auth from header
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

                // Verify user exists
                const user = await findUserById(payload.sub);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Check if client is connected
                if (!yjsSSEService.isClientConnected(noteId, body.clientId)) {
                    set.status = 403;
                    return { error: 'Client not connected to room via SSE' };
                }

                // Broadcast announce to other peers
                const message: SignalMessage = {
                    type: 'announce',
                    from: body.clientId,
                    roomId: noteId,
                    payload: {
                        userId: user._id,
                        userName: user.name || user.email || 'Anonymous',
                    },
                    timestamp: new Date().toISOString(),
                };

                yjsSSEService.relaySignal(noteId, message);

                return {
                    success: true,
                    peerCount: yjsSSEService.getClientCount(noteId),
                };
            } catch (error) {
                console.error('[Signal Announce] Error:', error);
                set.status = 500;
                return { error: 'Internal server error' };
            }
        },
        {
            params: t.Object({
                noteId: t.String(),
            }),
            body: t.Object({
                clientId: t.String(),
            }),
        },
    );
