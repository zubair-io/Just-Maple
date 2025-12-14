import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { connectToDatabase } from './db/client';
import { authRoutes } from './routes/auth';
import { tagRoutes } from './routes/tags';
import { noteRoutes } from './routes/notes';
import { config } from './config';

async function main() {
    // Connect to MongoDB
    await connectToDatabase();

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
        .get('/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
        .listen(config.port);

    console.log(`🍁 PaperbarkMaple API running at http://localhost:${config.port}`);
    console.log(`   Environment: ${config.isDev ? 'development' : 'production'}`);
    console.log(`   MongoDB: ${config.mongodbUri}`);
}

main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
