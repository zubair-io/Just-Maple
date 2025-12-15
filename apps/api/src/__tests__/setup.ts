import { MongoClient, Db } from 'mongodb';
import { beforeAll, afterAll, afterEach, vi } from 'vitest';

let client: MongoClient | null = null;
let testDb: Db | null = null;
let mongoAvailable = false;

// Use the test database on the development MongoDB
const MONGODB_TEST_URI =
    process.env.MONGODB_TEST_URI || 'mongodb://192.168.0.244:27017/just-maple-test';

// Mock the db/client module to use our test database
vi.mock('../db/client', () => ({
    getDb: () => testDb,
    connectToDatabase: async () => testDb,
    closeDatabase: async () => {},
}));

beforeAll(async () => {
    try {
        client = new MongoClient(MONGODB_TEST_URI, {
            serverSelectionTimeoutMS: 5000, // Fail fast if MongoDB not available
            connectTimeoutMS: 5000,
        });
        await client.connect();
        testDb = client.db();
        mongoAvailable = true;

        // Create indexes like the real DB
        await testDb.collection('users').createIndex({ email: 1 }, { unique: true });
        await testDb.collection('magic_links').createIndex({ token: 1 }, { unique: true });
        await testDb
            .collection('magic_links')
            .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        await testDb.collection('magic_links').createIndex({ email: 1 });
        await testDb.collection('passkeys').createIndex({ credentialId: 1 }, { unique: true });
        await testDb.collection('passkeys').createIndex({ userId: 1 });

        console.log('Connected to test database:', MONGODB_TEST_URI);
    } catch (error) {
        console.warn('MongoDB not available - API integration tests will be skipped');
        console.warn('To run API tests, ensure MongoDB is running at:', MONGODB_TEST_URI);
        mongoAvailable = false;
    }
});

afterAll(async () => {
    if (client) {
        await client.close();
    }
});

afterEach(async () => {
    if (!testDb) return;
    // Clear all collections after each test
    const collections = await testDb.listCollections().toArray();
    for (const col of collections) {
        await testDb.collection(col.name).deleteMany({});
    }
});

export { testDb, mongoAvailable };
