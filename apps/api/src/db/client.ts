import { MongoClient, Db } from 'mongodb';
import { config } from '../config';
import { seedBotTemplates } from './seed-bots';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
    if (db) {
        return db;
    }
    console.log(`Connecting to MongoDB at ${config.mongodbUri}...`);
    try {
        client = new MongoClient(config.mongodbUri + '', {
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

/**
 * Helper to create a unique index with error handling for duplicates
 */
async function createUniqueIndex(
    database: Db,
    collection: string,
    indexSpec: Record<string, 1 | -1>,
    indexName: string,
): Promise<void> {
    try {
        await database.collection(collection).createIndex(indexSpec, { unique: true });
    } catch (e: any) {
        if (e.code === 67) {
            console.warn(
                `Warning: Could not create unique index on ${collection}.${indexName} - possible duplicate data`,
            );
        } else {
            throw e;
        }
    }
}

async function createIndexes(database: Db): Promise<void> {
    // Users collection
    await createUniqueIndex(database, 'users', { email: 1 }, 'email');

    // Magic links collection with TTL
    await createUniqueIndex(database, 'magic_links', { token: 1 }, 'token');
    await database
        .collection('magic_links')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await database.collection('magic_links').createIndex({ email: 1 });

    // Passkeys collection
    await createUniqueIndex(database, 'passkeys', { credentialId: 1 }, 'credentialId');
    await database.collection('passkeys').createIndex({ userId: 1 });

    // Notebooks collection (formerly tags)
    await database.collection('notebooks').createIndex({ label: 1 }); // For sorted listing
    await database.collection('notebooks').createIndex({ 'sharing.sharedWith.userId': 1 }); // For user's notebooks query
    await database.collection('notebooks').createIndex({ userId: 1 }); // Legacy format support

    // Pages collection (formerly notes)
    await database.collection('pages').createIndex({ tagId: 1, updatedAt: -1 }); // For listing pages by notebook
    await database.collection('pages').createIndex({ userId: 1, updatedAt: -1 }); // For listing user's pages

    // Drop old unique documentId index if it exists (CosmosDB compatibility)
    try {
        await database.collection('pages').dropIndex('documentId_1');
    } catch (e) {
        // Index doesn't exist, ignore
    }
    await database.collection('pages').createIndex({ documentId: 1 }); // For lookup by documentId

    // Memos collection (Y.Doc storage for notebook-type pages, formerly notebooks)
    // Drop existing index first (in case of migration issues with duplicates)
    try {
        await database.collection('memos').dropIndex('noteId_1');
    } catch (e) {
        // Index doesn't exist, ignore
    }
    await createUniqueIndex(database, 'memos', { noteId: 1 }, 'noteId');

    // Messages collection
    await database.collection('messages').createIndex({ tagId: 1, _id: -1 }); // For paginated queries
    await database.collection('messages').createIndex({ tagId: 1, createdAt: -1 }); // For unread counts

    // Unread tracking collection
    try {
        await database
            .collection('unread_tracking')
            .createIndex({ userId: 1, tagId: 1 }, { unique: true });
    } catch (e: any) {
        if (e.code === 67) {
            console.warn(
                'Warning: Could not create unique index on unread_tracking.userId+tagId - possible duplicate data',
            );
        } else {
            throw e;
        }
    }

    // Bot templates collection
    await createUniqueIndex(database, 'bot_templates', { handle: 1 }, 'handle');

    // User bots collection
    try {
        await database
            .collection('user_bots')
            .createIndex({ userId: 1, handle: 1 }, { unique: true });
    } catch (e: any) {
        if (e.code === 67) {
            console.warn(
                'Warning: Could not create unique index on user_bots.userId+handle - possible duplicate data',
            );
        } else {
            throw e;
        }
    }
    await database.collection('user_bots').createIndex({ userId: 1 });
    await database.collection('user_bots').createIndex({ templateId: 1 });
    await database.collection('user_bots').createIndex({ handle: 1 }); // For sorted listing

    // Bot invocations collection
    await database.collection('bot_invocations').createIndex({ userBotId: 1 });
    await database.collection('bot_invocations').createIndex({ sourceId: 1 });
    await database.collection('bot_invocations').createIndex({ sourceType: 1, sourceId: 1 });
    await database.collection('bot_invocations').createIndex({ status: 1, createdAt: -1 });
    await database.collection('bot_invocations').createIndex({ userId: 1, createdAt: -1 });

    // Threads collection
    await createUniqueIndex(database, 'threads', { parentMessageId: 1 }, 'parentMessageId');
    await database.collection('threads').createIndex({ tagId: 1 });
    await database.collection('threads').createIndex({ updatedAt: -1 }); // For sorted listing

    // Messages - add thread index
    await database.collection('messages').createIndex({ threadId: 1, createdAt: 1 });

    // Notifications collection
    await database.collection('notifications').createIndex({ userId: 1, createdAt: -1 }); // For user's notifications

    // Collectables collection
    await database.collection('collectables').createIndex({ tagId: 1, updatedAt: -1 }); // For listing by notebook
    await database.collection('collectables').createIndex({ userId: 1, updatedAt: -1 }); // For user's collectables

    // Collectible registries collection
    await database.collection('collectibleregistries').createIndex({ userId: 1, updatedAt: -1 }); // For user's registries
    await database.collection('collectibleregistries').createIndex({ title: 1 }); // For sorted listing

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
