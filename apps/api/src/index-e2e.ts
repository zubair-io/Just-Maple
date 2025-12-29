import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';

// Start mongodb-memory-server and override config
let mongoServer: MongoMemoryServer | null = null;
let client: MongoClient | null = null;
let testDb: Db | null = null;

async function startE2EDatabase() {
    console.log('Starting MongoDB Memory Server for E2E tests...');

    mongoServer = await MongoMemoryServer.create({
        instance: { dbName: 'justmaple-e2e' },
    });

    const uri = mongoServer.getUri();
    console.log(`MongoDB Memory Server started: ${uri}`);

    // Override the MongoDB URI in environment
    process.env.MONGODB_URI = uri;

    // Import and start the main server AFTER setting the env var
    await import('./index');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down E2E server...');
    if (client) {
        await client.close();
    }
    if (mongoServer) {
        await mongoServer.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down E2E server...');
    if (client) {
        await client.close();
    }
    if (mongoServer) {
        await mongoServer.stop();
    }
    process.exit(0);
});

startE2EDatabase().catch((error) => {
    console.error('Failed to start E2E server:', error);
    process.exit(1);
});
