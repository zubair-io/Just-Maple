import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { join, resolve } from 'path';
import { connectToDatabase, getDb } from './db/client';
import { authRoutes } from './routes/auth';
import { notebookRoutes } from './routes/notebooks';
import { pageRoutes } from './routes/pages';
import { messageRoutes } from './routes/messages';
import { collectableRoutes } from './routes/collectables';
import { collectibleRegistryRoutes } from './routes/collectible-registry';
import { notificationRoutes } from './routes/notifications';
import { botRoutes } from './routes/bots';
import { legoRoutes } from './routes/lego';
import { collabRoutes } from './routes/collab';
import { memoRoutes } from './routes/memo';
import { memoVersionRoutes } from './routes/memo-versions';
import { storageRoutes } from './routes/storage';
import { whiteboardRoutes } from './routes/whiteboard';
import { recordingRoutes } from './routes/recordings';
import { externalRoutes } from './routes/external';
import { aiRoutes } from './routes/ai';
import { templateRoutes } from './routes/templates';
import { linkRoutes } from './routes/links';
import { realtimeWebSocket } from './ws/realtime.ws';
import { redisPubSub } from './services/redis.service';
import { config } from './config';

function getStaticDir(): string {
    // Path to frontend static files (computed at runtime)
    // In dev: relative to source (apps/web/dist/web/browser)
    // In production/bundled: ./web/paperbark/browser relative to dist folder
    // Can also be overridden with STATIC_DIR env var
    const env = Bun.env;
    if (env.STATIC_DIR) {
        return env.STATIC_DIR;
    }
    if (env.NODE_ENV === 'production') {
        return resolve(process.cwd(), 'web/paperbark/browser');
    }
    return resolve(import.meta.dir, '../../web/dist/web/browser');
}

async function main() {
    const STATIC_DIR = getStaticDir();

    console.log(`[Boot] NODE_ENV=${process.env.NODE_ENV}, isDev=${config.isDev}`);

    // Connect to MongoDB
    await connectToDatabase();

    // Connect to Redis for cross-replica pub/sub
    try {
        await redisPubSub.connect();
    } catch (error) {
        console.warn('[Redis] Failed to connect, running without cross-replica sync:', error);
    }

    const app = new Elysia()
        .use(
            cors({
                origin: config.corsOrigins,
                credentials: true,
            }),
        )
        .use(authRoutes)
        .use(notebookRoutes)
        .use(pageRoutes)
        .use(messageRoutes)
        .use(collectableRoutes)
        .use(collectibleRegistryRoutes)
        .use(notificationRoutes)
        .use(botRoutes)
        .use(legoRoutes)
        .use(collabRoutes)
        .use(memoRoutes)
        .use(memoVersionRoutes)
        .use(storageRoutes)
        .use(whiteboardRoutes)
        .use(recordingRoutes)
        .use(externalRoutes)
        .use(aiRoutes)
        .use(templateRoutes)
        .use(linkRoutes)
        .use(realtimeWebSocket); // Unified WebSocket for app events + notebook sync + chat

    app.get('/api/health', async ({ set }) => {
        try {
            // Check database connection
            const database = getDb();
            await database.command({ ping: 1 });
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                database: 'connected',
            };
        } catch {
            set.status = 503;
            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                database: 'disconnected',
            };
        }
    })
        // Serve static files and SPA fallback
        .get('*', async ({ path, set }) => {
            // Skip API routes, WebSocket routes, and SSE routes
            if (path.startsWith('/api') || path.startsWith('/ws') || path.startsWith('/sse')) {
                set.status = 404;
                return { error: 'Not found' };
            }

            // Try to serve static file first
            const filePath = join(STATIC_DIR, path);
            const file = Bun.file(filePath);

            if (await file.exists()) {
                // Set content type based on extension
                const ext = path.split('.').pop()?.toLowerCase();
                const contentTypes: Record<string, string> = {
                    js: 'application/javascript',
                    css: 'text/css',
                    html: 'text/html',
                    json: 'application/json',
                    png: 'image/png',
                    jpg: 'image/jpeg',
                    jpeg: 'image/jpeg',
                    svg: 'image/svg+xml',
                    ico: 'image/x-icon',
                    woff: 'font/woff',
                    woff2: 'font/woff2',
                    ttf: 'font/ttf',
                };
                if (ext && contentTypes[ext]) {
                    set.headers['content-type'] = contentTypes[ext];
                }
                return file;
            }

            // SPA fallback: serve index.html for non-file routes
            const indexPath = join(STATIC_DIR, 'index.html');
            const indexFile = Bun.file(indexPath);

            if (await indexFile.exists()) {
                set.headers['content-type'] = 'text/html';
                return indexFile;
            }

            // Frontend not built - return helpful message
            set.status = 404;
            return {
                error: 'Frontend not found',
                message: 'Run `bun run build` in apps/web to build the frontend',
            };
        })
        .listen({
            port: config.port,
            error(error) {
                if ((error as any).code === 'EADDRINUSE') {
                    console.error(`\n❌ ERROR: Port ${config.port} is already in use!`);
                    console.error(`   Another server is already running on this port.`);
                    console.error(`   Please stop the other server or change the port.\n`);
                    process.exit(1);
                }
                console.error('Failed to start server:', error);
                process.exit(1);
            },
        });

    // Check if frontend is available
    const indexFile = Bun.file(join(STATIC_DIR, 'index.html'));
    const frontendAvailable = await indexFile.exists();

    const envName = Bun.env.NODE_ENV === 'production' ? 'production' : 'development';
    console.log(`🍁 PaperbarkMaple API running at http://localhost:${config.port}`);
    console.log(`   Environment: ${envName}`);
    console.log(`   MongoDB: ${config.mongodbUri}`);
    console.log(`   Redis: ${redisPubSub.connected ? config.redisUrl : 'not connected'}`);
    console.log(`   WebSocket: ws://localhost:${config.port}/ws/realtime`);
    console.log(`   Frontend: ${frontendAvailable ? 'serving from ' + STATIC_DIR : 'not built'}`);
}

main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
