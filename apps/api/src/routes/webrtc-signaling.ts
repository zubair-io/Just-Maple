import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import type { AuthContext } from '../middleware/auth';
import { webrtcSignalingService } from '../services/webrtc-signaling.service';

export const webrtcSignalingRoutes = new Elysia({ prefix: '/api/webrtc' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // Register peer for a document
    .post(
        '/register',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const { documentId, peerId } = body;
            webrtcSignalingService.registerPeer(documentId, peerId, auth.user._id);

            // Return list of other peers in the same document
            const peers = webrtcSignalingService
                .getPeersForDocument(documentId)
                .filter((p) => p.peerId !== peerId);

            return { success: true, peers };
        },
        {
            body: t.Object({
                documentId: t.String(),
                peerId: t.String(),
            }),
        },
    )

    // Send signal to another peer
    .post(
        '/signal',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const { from, to, type, payload } = body;

            webrtcSignalingService.queueSignal({
                from,
                to,
                type,
                payload,
            });

            return { success: true };
        },
        {
            body: t.Object({
                from: t.String(),
                to: t.String(),
                type: t.Union([
                    t.Literal('offer'),
                    t.Literal('answer'),
                    t.Literal('ice-candidate'),
                ]),
                payload: t.Any(),
            }),
        },
    )

    // Poll for pending signals (long-polling support)
    .get(
        '/poll/:peerId',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const { peerId } = params;
            const timeout = parseInt(query.timeout || '15000', 10);
            const maxTimeout = 30000; // Max 30 seconds
            const actualTimeout = Math.min(timeout, maxTimeout);

            // Long-polling: wait for signals to arrive
            const startTime = Date.now();
            const pollInterval = 500; // Check every 500ms

            return new Promise((resolve) => {
                const checkForSignals = () => {
                    const signals = webrtcSignalingService.pollSignals(peerId);

                    if (signals.length > 0) {
                        // Signals available - return immediately
                        resolve({ signals });
                        return;
                    }

                    const elapsed = Date.now() - startTime;
                    if (elapsed >= actualTimeout) {
                        // Timeout - return empty array
                        resolve({ signals: [] });
                        return;
                    }

                    // Continue polling
                    setTimeout(checkForSignals, pollInterval);
                };

                checkForSignals();
            });
        },
        {
            params: t.Object({
                peerId: t.String(),
            }),
            query: t.Object({
                timeout: t.Optional(t.String()),
            }),
        },
    )

    // Update heartbeat for a peer
    .post(
        '/heartbeat',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const { documentId, peerId } = body;
            const updated = webrtcSignalingService.updateHeartbeat(documentId, peerId);

            if (!updated) {
                set.status = 404;
                return {
                    error: 'Peer not found',
                    message: 'Peer is not registered for this document',
                };
            }

            // Return updated peer list
            const peers = webrtcSignalingService
                .getPeersForDocument(documentId)
                .filter((p) => p.peerId !== peerId);

            return { success: true, peers };
        },
        {
            body: t.Object({
                documentId: t.String(),
                peerId: t.String(),
            }),
        },
    )

    // Unregister peer from document
    .post(
        '/unregister',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const { documentId, peerId } = body;
            webrtcSignalingService.unregisterPeer(documentId, peerId);

            return { success: true };
        },
        {
            body: t.Object({
                documentId: t.String(),
                peerId: t.String(),
            }),
        },
    )

    // Get statistics (for debugging/monitoring)
    .get('/stats', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        const stats = webrtcSignalingService.getStats();
        return { stats };
    });
