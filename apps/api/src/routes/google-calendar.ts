import { Elysia } from 'elysia';
import { config } from '../config';

export const googleCalendarRoutes = new Elysia({ prefix: '/api/google-calendar' }).get(
    '/config',
    () => ({
        clientId: config.gmailClientId,
    }),
);
