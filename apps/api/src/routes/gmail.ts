import { Elysia } from 'elysia';
import { config } from '../config';

export const gmailRoutes = new Elysia({ prefix: '/api/gmail' }).get('/config', () => ({
    clientId: config.gmailClientId,
}));
