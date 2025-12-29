import { MongoClient, Db } from 'mongodb';
import { beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

let client: MongoClient | null = null;
let testDb: Db | null = null;

// Read MongoDB connection info from global setup
const tmpFile = path.join(process.cwd(), '.test-tmp', 'mongo-uri.txt');
let mongoAvailable = false;
let mongoUri = '';

if (fs.existsSync(tmpFile)) {
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    mongoAvailable = data.available;
    mongoUri = data.uri || '';
}

// Mock the db/client module to use our test database
vi.mock('../db/client', () => ({
    getDb: () => testDb,
    connectToDatabase: async () => testDb,
    closeDatabase: async () => {},
}));

beforeAll(async () => {
    if (!mongoAvailable || !mongoUri) {
        console.warn('MongoDB not available - tests will be skipped');
        return;
    }

    try {
        // Connect to the MongoDB instance started in global setup
        client = new MongoClient(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });
        await client.connect();
        testDb = client.db('just-maple-test');

        console.log('Connected to test database');
    } catch (error) {
        console.warn('Failed to connect to test database:', error);
        mongoAvailable = false;
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
