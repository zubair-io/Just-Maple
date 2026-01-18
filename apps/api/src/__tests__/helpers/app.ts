import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { authRoutes } from '../../routes/auth';
import { notebookRoutes } from '../../routes/notebooks';
import { pageRoutes } from '../../routes/pages';
import { messageRoutes } from '../../routes/messages';
import { botRoutes } from '../../routes/bots';

export function createTestApp() {
    return new Elysia()
        .use(
            cors({
                origin: ['http://localhost:4200'],
                credentials: true,
            }),
        )
        .use(authRoutes)
        .use(notebookRoutes)
        .use(pageRoutes)
        .use(messageRoutes)
        .use(botRoutes)
        .get('/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}

export type TestApp = ReturnType<typeof createTestApp>;
