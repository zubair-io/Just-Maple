import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

let mongoServer: MongoMemoryServer | null = null;
let client: MongoClient | null = null;
let testDb: Db | null = null;

export async function setup() {
    try {
        console.log('Starting MongoDB Memory Server...');

        // Start in-memory MongoDB server
        mongoServer = await MongoMemoryServer.create({
            instance: {
                dbName: 'just-maple-test',
            },
        });

        const uri = mongoServer.getUri();

        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });
        await client.connect();
        testDb = client.db('just-maple-test');

        // Create indexes like the real DB
        await testDb.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
        await testDb
            .collection('passkey_challenges')
            .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        await testDb.collection('passkeys').createIndex({ credentialId: 1 }, { unique: true });
        await testDb.collection('passkeys').createIndex({ userId: 1 });

        console.log('Connected to in-memory test database');

        // Store connection info in a temp file for test files to access
        const tmpDir = path.join(process.cwd(), '.test-tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        fs.writeFileSync(
            path.join(tmpDir, 'mongo-uri.txt'),
            JSON.stringify({ uri, available: true }),
        );

        // Return teardown function
        return async () => {
            console.log('Cleaning up MongoDB Memory Server...');
            if (client) {
                await client.close();
            }
            if (mongoServer) {
                await mongoServer.stop();
            }
            // Clean up temp file
            if (fs.existsSync(path.join(tmpDir, 'mongo-uri.txt'))) {
                fs.unlinkSync(path.join(tmpDir, 'mongo-uri.txt'));
            }
        };
    } catch (error) {
        console.warn('MongoDB Memory Server failed to start - tests will be skipped');
        console.warn('Error:', error);

        // Write failure status
        const tmpDir = path.join(process.cwd(), '.test-tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        fs.writeFileSync(path.join(tmpDir, 'mongo-uri.txt'), JSON.stringify({ available: false }));

        return async () => {
            // Cleanup
        };
    }
}
