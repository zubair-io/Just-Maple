/**
 * Migration: Recreate collections with unique indexes (CosmosDB)
 *
 * CosmosDB only allows unique indexes on empty collections.
 * This script:
 * 1. Downloads all data from the collection
 * 2. Drops the collection
 * 3. Creates the collection with unique index
 * 4. Re-imports the data
 *
 * Run with: bun run scripts/migrations/004-recreate-unique-indexes.ts
 */

import { MongoClient, Document } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

interface IndexToRecreate {
    collection: string;
    indexSpec: Record<string, 1 | -1>;
    label: string;
}

const indexes: IndexToRecreate[] = [
    { collection: 'users', indexSpec: { email: 1 }, label: 'users.email' },
    { collection: 'passkeys', indexSpec: { credentialId: 1 }, label: 'passkeys.credentialId' },
    { collection: 'memos', indexSpec: { noteId: 1 }, label: 'memos.noteId' },
    { collection: 'bot_templates', indexSpec: { handle: 1 }, label: 'bot_templates.handle' },
    {
        collection: 'user_bots',
        indexSpec: { userId: 1, handle: 1 },
        label: 'user_bots.userId+handle',
    },
];

async function recreateWithUniqueIndex(
    client: MongoClient,
    collectionName: string,
    indexSpec: Record<string, 1 | -1>,
    label: string,
): Promise<void> {
    const db = client.db();
    const collection = db.collection(collectionName);

    // Check if index already exists and is unique
    const existingIndexes = await collection.indexes();
    const indexKeys = Object.keys(indexSpec);
    const existingIndex = existingIndexes.find((idx) => {
        if (!idx.key) return false;
        const existingKeys = Object.keys(idx.key);
        return (
            existingKeys.length === indexKeys.length &&
            indexKeys.every((k) => idx.key[k] === indexSpec[k])
        );
    });

    if (existingIndex?.unique) {
        console.log(`  Already has unique index, skipping`);
        return;
    }

    // Step 1: Download all data
    console.log(`  Downloading data...`);
    const documents = await collection.find({}).toArray();
    console.log(`  Downloaded ${documents.length} documents`);

    if (documents.length === 0) {
        // Empty collection - just create the index
        console.log(`  Collection empty, creating unique index...`);
        await collection.createIndex(indexSpec, { unique: true });
        console.log(`  Done`);
        return;
    }

    // Step 2: Drop the collection
    console.log(`  Dropping collection...`);
    await collection.drop();
    console.log(`  Dropped`);

    // Step 3: Create collection with unique index
    console.log(`  Creating collection with unique index...`);
    const newCollection = db.collection(collectionName);
    await newCollection.createIndex(indexSpec, { unique: true });
    console.log(`  Index created`);

    // Step 4: Re-insert all documents
    console.log(`  Re-inserting ${documents.length} documents...`);
    try {
        // Remove _id to let MongoDB generate new ones if needed, or keep them
        const result = await newCollection.insertMany(documents, { ordered: false });
        console.log(`  Inserted ${result.insertedCount} documents`);
    } catch (e: any) {
        if (e.code === 11000) {
            // Duplicate key error - some documents had duplicates
            const insertedCount = e.result?.insertedCount || 0;
            console.error(
                `  Warning: Only inserted ${insertedCount}/${documents.length} documents`,
            );
            console.error(`  Some documents had duplicate values for the unique field`);
        } else {
            throw e;
        }
    }
}

async function main() {
    console.log('=== Recreating Collections with Unique Indexes ===\n');
    console.log(
        'WARNING: This will temporarily drop collections. Make sure no one is using the app.\n',
    );
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}\n`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();

        for (const idx of indexes) {
            console.log(`--- ${idx.label} ---`);
            try {
                await recreateWithUniqueIndex(client, idx.collection, idx.indexSpec, idx.label);
                console.log(`  Success\n`);
            } catch (e: any) {
                console.error(`  Error: ${e.message}\n`);
            }
        }

        console.log('=== Done! Restart the server to verify. ===');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

main();
