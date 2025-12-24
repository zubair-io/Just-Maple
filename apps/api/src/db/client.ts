import { MongoClient, Db } from 'mongodb';
import { config } from '../config';
import { seedBotTemplates } from './seed-bots';

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

        // Seed bot templates
        await seedBotTemplates();

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

    // Notes collection
    await database.collection('notes').createIndex({ tagId: 1, updatedAt: -1 }); // For listing notes by tag
    await database.collection('notes').createIndex({ userId: 1, updatedAt: -1 }); // For listing user's notes

    // Messages collection
    await database.collection('messages').createIndex({ tagId: 1, _id: -1 }); // For paginated queries
    await database.collection('messages').createIndex({ tagId: 1, createdAt: -1 }); // For unread counts

    // Unread tracking collection
    await database
        .collection('unread_tracking')
        .createIndex({ userId: 1, tagId: 1 }, { unique: true });

    // Bot templates collection
    await database.collection('bot_templates').createIndex({ handle: 1 }, { unique: true });
    await database.collection('bot_templates').createIndex({ name: 'text', description: 'text' });

    // User bots collection
    await database.collection('user_bots').createIndex({ userId: 1, handle: 1 }, { unique: true });
    await database.collection('user_bots').createIndex({ userId: 1 });
    await database.collection('user_bots').createIndex({ templateId: 1 });

    // Bot invocations collection
    await database.collection('bot_invocations').createIndex({ userBotId: 1 });
    await database.collection('bot_invocations').createIndex({ sourceId: 1 });
    await database.collection('bot_invocations').createIndex({ sourceType: 1, sourceId: 1 });
    await database.collection('bot_invocations').createIndex({ status: 1, createdAt: -1 });
    await database.collection('bot_invocations').createIndex({ userId: 1, createdAt: -1 });

    // Threads collection
    await database.collection('threads').createIndex({ parentMessageId: 1 }, { unique: true });
    await database.collection('threads').createIndex({ tagId: 1 });

    // Messages - add thread index
    await database.collection('messages').createIndex({ threadId: 1, createdAt: 1 });

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
