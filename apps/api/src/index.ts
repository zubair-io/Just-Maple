import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { join, resolve } from 'path';
import { connectToDatabase, getDb } from './db/client';
import { authRoutes } from './routes/auth';
import { tagRoutes } from './routes/tags';
import { noteRoutes } from './routes/notes';
import { messageRoutes } from './routes/messages';
import { paperRoutes } from './routes/papers';
import { collectibleRegistryRoutes } from './routes/collectible-registry';
import { notificationRoutes } from './routes/notifications';
import { botRoutes } from './routes/bots';
import { chatWebSocket, WebSocketRealtimeService } from './ws/chat.ws';
import { SignalRRealtimeService } from './services/signalr.service';
import { setRealtimeService } from './services/realtime.service';
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

    // Connect to MongoDB
    await connectToDatabase();

    // Initialize realtime service
    // - WebSocket: dev/self-hosted (direct connections)
    // - SignalR: production (via AutumnBlaze Azure Functions)
    if (config.useSignalR) {
        console.log('   Using SignalR realtime service');
        setRealtimeService(new SignalRRealtimeService());
    } else {
        setRealtimeService(new WebSocketRealtimeService());
    }

    const app = new Elysia()
        .use(
            cors({
                origin: config.corsOrigins,
                credentials: true,
            }),
        )
        .use(authRoutes)
        .use(tagRoutes)
        .use(noteRoutes)
        .use(messageRoutes)
        .use(paperRoutes)
        .use(collectibleRegistryRoutes)
        .use(notificationRoutes)
        .use(botRoutes)
        .use(chatWebSocket)
        .get('/api/health', async ({ set }) => {
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
            // Skip API routes and WebSocket routes
            if (path.startsWith('/api') || path.startsWith('/ws')) {
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
        .listen(config.port);

    // Check if frontend is available
    const indexFile = Bun.file(join(STATIC_DIR, 'index.html'));
    const frontendAvailable = await indexFile.exists();

    const envName = Bun.env.NODE_ENV === 'production' ? 'production' : 'development';
    console.log(`🍁 PaperbarkMaple API running at http://localhost:${config.port}`);
    console.log(`   Environment: ${envName}`);
    console.log(`   MongoDB: ${config.mongodbUri}`);
    console.log(`   WebSocket: ws://localhost:${config.port}/ws/chat`);
    console.log(`   Frontend: ${frontendAvailable ? 'serving from ' + STATIC_DIR : 'not built'}`);
}

main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
