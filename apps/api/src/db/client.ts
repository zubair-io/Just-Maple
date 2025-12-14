import { MongoClient, Db } from 'mongodb';
import { config } from '../config';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
    if (db) {
        return db;
    }

    try {
        client = new MongoClient(config.mongodbUri, {
            maxPoolSize: 10,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        await client.connect();
        db = client.db();

        console.log('MongoDB connected successfully');

        // Create indexes
        await createIndexes(db);

        return db;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

async function createIndexes(database: Db): Promise<void> {
    // Users collection
    await database.collection('users').createIndex({ email: 1 }, { unique: true });

    // Magic links collection with TTL
    await database.collection('magic_links').createIndex({ token: 1 }, { unique: true });
    await database
        .collection('magic_links')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await database.collection('magic_links').createIndex({ email: 1 });

    // Passkeys collection
    await database.collection('passkeys').createIndex({ credentialId: 1 }, { unique: true });
    await database.collection('passkeys').createIndex({ userId: 1 });

    console.log('Database indexes created');
}

export function getDb(): Db {
    if (!db) {
        throw new Error('Database not connected. Call connectToDatabase() first.');
    }
    return db;
}

export async function closeDatabase(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('MongoDB connection closed');
    }
}
