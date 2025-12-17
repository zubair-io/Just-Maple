import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findNotificationById,
    findNotificationsByUserId,
    markNotificationAsRead,
    registerDevice,
    unregisterDevice,
    findDeviceRegistrationsByUserId,
} from '../repositories/notification.repo';

export const notificationRoutes = new Elysia({ prefix: '/api/notifications' })
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

    // Register device for push notifications
    .post(
        '/register',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const registration = await registerDevice(
                auth.user._id,
                body.serverKey,
                body.deviceToken,
                body.platform,
            );

            return { registration };
        },
        {
            body: t.Object({
                serverKey: t.String({ minLength: 1 }),
                deviceToken: t.String({ minLength: 1 }),
                platform: t.Union([t.Literal('ios'), t.Literal('macos')]),
            }),
        },
    )

    // Unregister device from push notifications
    .delete(
        '/unregister',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const deleted = await unregisterDevice(auth.user._id, body.serverKey);

            if (!deleted) {
                set.status = 404;
                return { error: 'Device not found' };
            }

            return { message: 'Device unregistered successfully' };
        },
        {
            body: t.Object({
                serverKey: t.String({ minLength: 1 }),
            }),
        },
    )

    // Get list of registered devices
    .get('/devices', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        const devices = await findDeviceRegistrationsByUserId(auth.user._id);

        return { devices };
    })

    // Get notification history for user
    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const limit = Math.min(query.limit || 50, 100);
            const skip = query.skip || 0;

            const result = await findNotificationsByUserId(auth.user._id, limit, skip);

            return result;
        },
        {
            query: t.Object({
                limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
                skip: t.Optional(t.Number({ minimum: 0 })),
            }),
        },
    )

    // Get a single notification by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notification = await findNotificationById(params.id);

            if (!notification) {
                set.status = 404;
                return { error: 'Notification not found' };
            }

            // Ensure user owns this notification
            if (notification.userId !== auth.user._id) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have access to this notification',
                };
            }

            return { notification };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Mark notification as read
    .patch(
        '/:id/read',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updated = await markNotificationAsRead(params.id, auth.user._id);

            if (!updated) {
                set.status = 404;
                return { error: 'Notification not found' };
            }

            return { message: 'Notification marked as read' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
