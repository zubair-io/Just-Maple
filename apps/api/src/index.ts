import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { connectToDatabase, getDb } from './db/client';
import { authRoutes } from './routes/auth';
import { tagRoutes } from './routes/tags';
import { noteRoutes } from './routes/notes';
import { messageRoutes } from './routes/messages';
import { paperRoutes } from './routes/papers';
import { collectibleRegistryRoutes } from './routes/collectible-registry';
import { chatWebSocket, WebSocketRealtimeService } from './ws/chat.ws';
import { setRealtimeService } from './services/realtime.service';
import { config } from './config';

async function main() {
    // Connect to MongoDB
    await connectToDatabase();

    // Initialize realtime service (WebSocket for dev/self-hosted)
    setRealtimeService(new WebSocketRealtimeService());

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
        .listen(config.port);

    console.log(`🍁 PaperbarkMaple API running at http://localhost:${config.port}`);
    console.log(`   Environment: ${config.isDev ? 'development' : 'production'}`);
    console.log(`   MongoDB: ${config.mongodbUri}`);
    console.log(`   WebSocket: ws://localhost:${config.port}/ws/chat`);
}

main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
