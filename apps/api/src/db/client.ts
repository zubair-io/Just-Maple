import { ensurePasskeyIndexes } from './passkey-indexes';
import { MongoClient, Db } from 'mongodb';
import { config } from '../config';
import { seedBotTemplates } from './seed-bots';
import { seedSystemTemplates } from './seed-templates';
import { SqliteDatabase } from './sqlite/client';

let client: MongoClient | null = null;
let db: Db | null = null;
let sqlite: SqliteDatabase | null = null;

export function getSqliteDatabase(): SqliteDatabase | null {
    return sqlite;
}

export async function connectToDatabase(): Promise<Db> {
    if (db) {
        return db;
    }
    if (config.databaseDriver === 'sqlite') {
        sqlite = new SqliteDatabase(config.databasePath);
        try {
            await sqlite.ready;
            db = sqlite.asRepositoryDatabase();
            await createIndexes(db);
            await seedBotTemplates();
            await seedSystemTemplates();
            console.log('SQLite connected successfully');
            return db;
        } catch (error) {
            await sqlite.close().catch(() => {});
            sqlite = null;
            db = null;
            throw error;
        }
    }
    if (config.databaseDriver !== 'mongodb')
        throw new Error('DATABASE_DRIVER must be sqlite or mongodb');
    console.log('Connecting to MongoDB...');
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

        // Seed system templates
        await seedSystemTemplates();

        return db;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

/**
 * Helper to create a unique index with error handling for duplicates and conflicts
 */
async function createUniqueIndex(
    database: Db,
    collection: string,
    indexSpec: Record<string, 1 | -1>,
    indexName: string,
    options?: { sparse?: boolean },
): Promise<void> {
    try {
        await database.collection(collection).createIndex(indexSpec, { unique: true, ...options });
    } catch (e: any) {
        if (config.databaseDriver === 'sqlite') throw e;
        // 67 = CannotCreateIndex (duplicate data prevents unique index)
        // 85 = IndexOptionsConflict (index exists with different options, e.g. non-unique)
        if (e.code === 67 || e.code === 85) {
            console.warn(
                `Warning: Could not create unique index on ${collection}.${indexName} - ${e.code === 85 ? 'index exists with different options' : 'possible duplicate data'}`,
            );
        } else {
            throw e;
        }
    }
}

export async function createIndexes(database: Db): Promise<void> {
    await ensurePasskeyIndexes(database);

    // Passkeys collection
    await createUniqueIndex(database, 'passkeys', { credentialId: 1 }, 'credentialId');
    await database.collection('passkeys').createIndex({ userId: 1 });

    // Notebooks collection (formerly tags)
    await database.collection('notebooks').createIndex({ label: 1 }); // For sorted listing
    await database.collection('notebooks').createIndex({ 'sharing.sharedWith.userId': 1 }); // For user's notebooks query
    await database.collection('notebooks').createIndex({ userId: 1 }); // Legacy format support

    // Pages collection (formerly notes)
    await database.collection('pages').createIndex({ notebookId: 1, updatedAt: -1 }); // For listing pages by notebook
    await database.collection('pages').createIndex({ userId: 1, updatedAt: -1 }); // For listing user's pages

    // Drop old documentId index if it exists (migration)
    try {
        await database.collection('pages').dropIndex('documentId_1');
    } catch (e) {
        // Index doesn't exist, ignore
    }
    await createUniqueIndex(database, 'pages', { id: 1 }, 'id'); // For lookup by id

    // Memos collection (Y.Doc storage for notebook-type pages, formerly notebooks)
    // Migration: recreate collection handles old indexes. These are created fresh.
    await createUniqueIndex(database, 'memos', { id: 1 }, 'id');
    await database.collection('memos').createIndex({ pageId: 1 }); // Non-unique: parent page lookup

    // Device data uploaded by the user's Mac and iPhone
    await database.collection('device_items').createIndex({ userId: 1, source: 1 });
    await database.collection('device_items').createIndex({ userId: 1, deviceId: 1, source: 1 }); // Collector counts without loading bodies
    await database.collection('device_items').createIndex({ occurredAt: 1 }); // Retention
    await database.collection('device_items').createIndex({ userId: 1, threadKey: 1 });
    await database.collection('device_items').createIndex({ userId: 1, source: 1, occurredAt: -1 }); // Newest first (drafted replies' voice)
    await database.collection('collectors').createIndex({ userId: 1 });
    // "Add to calendar" proposals and the Mac action queue (sorted in code)
    await database.collection('calendar_proposals').createIndex({ userId: 1, status: 1 });
    await database.collection('calendar_proposals').createIndex({ userId: 1, 'event.start': 1 }); // Duplicate offers
    // Home Assistant action proposals (sorted in code)
    await database.collection('home_proposals').createIndex({ userId: 1, status: 1 });
    await database.collection('home_proposals').createIndex({ userId: 1, 'call.entityId': 1 }); // Duplicate offers
    // Bot action log and per-bot autonomy (bot-action.repo; sorted in code)
    await database.collection('bot_actions').createIndex({ ownerId: 1, botId: 1, createdAt: 1 }); // A bot's Activity
    await database.collection('bot_actions').createIndex({ notebookId: 1, createdAt: 1 }); // A notebook's Activity
    await database.collection('bot_actions').createIndex({ createdAt: -1 }); // Activity: newest first
    await database.collection('bot_actions').createIndex({ ownerId: 1, status: 1 }); // Expiry
    await database.collection('bot_actions').createIndex({ ownerId: 1, 'undo.state': 1 }); // Undo queue
    await database.collection('bot_actions').createIndex({ 'undo.id': 1 }); // Undo results
    await database.collection('bot_autonomy').createIndex({ userId: 1, botId: 1 });
    // About me
    await database.collection('profile_entities').createIndex({ userId: 1 });
    await database.collection('profile_relations').createIndex({ userId: 1 });
    await database.collection('profile_facts').createIndex({ userId: 1 });
    // About me lives in notebooks: who has one there, and a fact by id within a notebook.
    await database.collection('profile_entities').createIndex({ notebookId: 1, isMe: 1 });
    await database.collection('profile_entities').createIndex({ userId: 1, notebookId: 1 });
    await database.collection('profile_relations').createIndex({ userId: 1, notebookId: 1 });
    await database.collection('profile_facts').createIndex({ notebookId: 1 });
    await database.collection('profile_facts').createIndex({ userId: 1, notebookId: 1 });
    // Connected-data graph: everything is per notebook.
    await database.collection('pages').createIndex({ type: 1 }); // Notebooks with a graph page
    await database.collection('device_items').createIndex({ userId: 1, updatedAt: 1 }); // New items to link
    await database.collection('graph_links').createIndex({ notebookId: 1, status: 1 });
    await database.collection('graph_links').createIndex({ notebookId: 1, a: 1 });
    await database.collection('graph_links').createIndex({ notebookId: 1, b: 1 });
    await database.collection('graph_nodes').createIndex({ notebookId: 1 });
    await database.collection('proactive_triage_budget').createIndex({ createdAt: 1 }); // Cleanup
    await database
        .collection('graph_links')
        .createIndex({ notebookId: 1, status: 1, updatedAt: -1 }); // Reads, newest first
    await database.collection('graph_links').createIndex({ updatedAt: -1 });
    await database.collection('graph_links').createIndex({ notebookId: 1, checkedAt: 1 }); // Gone items
    await database.collection('graph_links').createIndex({ checkedAt: 1 });
    // One document per reason two nodes are connected (graph_links is kept for the migration).
    await database.collection('graph_relations').createIndex({ notebookId: 1, status: 1 });
    await database.collection('graph_relations').createIndex({ notebookId: 1, a: 1 });
    await database.collection('graph_relations').createIndex({ notebookId: 1, b: 1 });
    await database.collection('graph_relations').createIndex({ notebookId: 1, pair: 1 });
    await database
        .collection('graph_relations')
        .createIndex({ notebookId: 1, status: 1, updatedAt: -1 }); // Reads, newest first
    await database.collection('graph_relations').createIndex({ updatedAt: -1 });
    await database.collection('graph_relations').createIndex({ notebookId: 1, checkedAt: 1 });
    await database.collection('graph_relations').createIndex({ checkedAt: 1 });
    await database.collection('graph_judged').createIndex({ notebookId: 1, judgedAt: 1 });
    await database.collection('graph_counted').createIndex({ notebookId: 1, countedAt: 1 });
    await database.collection('graph_usage').createIndex({ day: 1 });
    // Follow-ups: per person, read through each notebook's pages.
    await database.collection('follow_ups').createIndex({ userId: 1, status: 1 });
    await database.collection('follow_up_scanned').createIndex({ scannedAt: 1 }); // Cleanup
    await database.collection('follow_up_usage').createIndex({ day: 1 }); // Cleanup
    await database.collection('travel_estimates').createIndex({ userId: 1 });
    await database.collection('travel_estimates').createIndex({ savedAt: 1 }); // Cleanup
    await database.collection('scheduled_sends').createIndex({ sentAt: 1 }); // Cleanup

    // Messages collection
    await database.collection('messages').createIndex({ notebookId: 1, _id: -1 }); // For paginated queries
    await database.collection('messages').createIndex({ notebookId: 1, createdAt: -1 }); // For unread counts

    // Unread tracking collection
    // Drop legacy unique index on userId+notebookId which causes E11000 duplicate key errors
    // when page-based tracking inserts multiple docs with null notebookId for the same user
    try {
        await database.collection('unread_tracking').dropIndex('userId_1_notebookId_1');
    } catch {
        // Index doesn't exist, ignore
    }
    await createUniqueIndex(
        database,
        'unread_tracking',
        { userId: 1, pageId: 1 },
        'userId+pageId',
        {
            sparse: true,
        },
    );
    // Chat read markers (see unread.repo.ts for why they left unread_tracking)
    await createUniqueIndex(
        database,
        'chat_read_markers',
        { userId: 1, pageId: 1 },
        'userId+pageId',
    );

    // Bot templates collection
    await createUniqueIndex(database, 'bot_templates', { handle: 1 }, 'handle');

    // User bots collection
    try {
        await database
            .collection('user_bots')
            .createIndex({ userId: 1, handle: 1 }, { unique: true });
    } catch (e: any) {
        if (e.code === 67 || e.code === 85) {
            console.warn(
                'Warning: Could not create unique index on user_bots.userId+handle - possible duplicate data or index conflict',
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
    await database.collection('threads').createIndex({ notebookId: 1 });
    await database.collection('threads').createIndex({ updatedAt: -1 }); // For sorted listing

    // Messages - add thread index
    await database.collection('messages').createIndex({ threadId: 1, createdAt: 1 });

    // Notifications collection
    await database.collection('notifications').createIndex({ userId: 1, createdAt: -1 }); // For user's notifications

    // Collectables collection
    await database.collection('collectables').createIndex({ notebookId: 1, updatedAt: -1 }); // For listing by notebook
    await database.collection('collectables').createIndex({ userId: 1, updatedAt: -1 }); // For user's collectables

    // Collectible registries collection
    await database.collection('collectibleregistries').createIndex({ userId: 1, updatedAt: -1 }); // For user's registries
    await database.collection('collectibleregistries').createIndex({ title: 1 }); // For sorted listing

    // Recordings collection
    await database.collection('recordings').createIndex({ id: 1, userId: 1 }); // For lookup by client-generated ID
    await database.collection('recordings').createIndex({ userId: 1, createdAt: -1 }); // For user's recordings

    // Templates collection
    await createUniqueIndex(database, 'templates', { id: 1 }, 'id');
    await database.collection('templates').createIndex({ userId: 1, updatedAt: -1 }); // For user's templates
    await database.collection('templates').createIndex({ isSystem: 1, updatedAt: -1 }); // Composite index for sorted queries
    await database
        .collection('templates')
        .createIndex({ category: 1, isSystem: -1, updatedAt: -1 }); // For category filter with sort

    // Memo versions collection (version history for memos)
    await database.collection('memo_versions').createIndex({ noteId: 1, createdAt: -1 }); // Primary query: versions for a memo, newest first
    await database.collection('memo_versions').createIndex({ noteId: 1, version: 1 }); // For cleanup/retention policy

    // Search index collection
    // Note: Text indexes are not supported on Azure Cosmos DB, so we skip the text index
    // and rely on regex-based search in the search repository instead
    await createUniqueIndex(database, 'search_index', { pageId: 1 }, 'pageId');
    await database.collection('search_index').createIndex({ notebookId: 1 });
    await database.collection('search_index').createIndex({ type: 1 });
    await database.collection('search_index').createIndex({ updatedAt: -1 });

    // Notebook slug index (sparse - only public notebooks have slugs)
    await createUniqueIndex(database, 'notebooks', { slug: 1 }, 'slug', { sparse: true });

    // Page publishing indexes
    await createUniqueIndex(
        database,
        'pages',
        { notebookId: 1, publishedSlug: 1 },
        'publishedSlug',
        {
            sparse: true,
        },
    );
    await database
        .collection('pages')
        .createIndex({ notebookId: 1, isPublished: 1, publishedOrder: 1 }, { sparse: true });

    // Custom domains collection
    await createUniqueIndex(database, 'custom_domains', { domain: 1 }, 'domain');
    await database.collection('custom_domains').createIndex({ notebookId: 1 });

    console.log('Database indexes created');
}

export function getDb(): Db {
    if (!db) {
        throw new Error('Database not connected. Call connectToDatabase() first.');
    }
    return db;
}

export async function closeDatabase(): Promise<void> {
    if (sqlite) {
        await sqlite.close();
        sqlite = null;
        db = null;
    }
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('MongoDB connection closed');
    }
}
