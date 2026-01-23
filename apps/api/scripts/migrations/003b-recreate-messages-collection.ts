/**
 * Migration: Recreate messages collection with unique index on id (UUID v4)
 *
 * This migration:
 * 1. Backs up all documents from messages collection
 * 2. Adds UUID v4 id to any documents without one
 * 3. Drops the messages collection
 * 4. Creates the collection with proper unique index on id
 * 5. Restores all documents
 *
 * Run with: bun run scripts/migrations/003b-recreate-messages-collection.ts
 */

import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUUID(str: string): boolean {
    return UUID_REGEX.test(str);
}

async function migrate() {
    console.log('Starting migration: Recreate messages collection with UUID v4 ids...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const messages = db.collection('messages');

        // Step 1: Backup all documents
        console.log('\n--- Step 1: Backing up documents ---');
        const documents = await messages.find({}).toArray();
        console.log(`Backed up ${documents.length} documents`);

        if (documents.length === 0) {
            console.log('No documents to migrate');

            // Still create the index on empty collection
            console.log('\n--- Creating collection with unique index ---');
            const newMessages = db.collection('messages');
            await newMessages.createIndex({ id: 1 }, { unique: true });
            console.log('Created unique index on {id: 1}');
            return;
        }

        // Step 2: Add UUID v4 id to documents that don't have one
        console.log('\n--- Step 2: Adding UUID v4 ids to documents ---');
        let addedCount = 0;
        let convertedCount = 0;
        for (const doc of documents) {
            if (!doc.id) {
                doc.id = randomUUID();
                addedCount++;
            } else if (!isUUID(doc.id)) {
                const oldId = doc.id;
                doc.id = randomUUID();
                console.log(`  Converted ${oldId} -> ${doc.id}`);
                convertedCount++;
            }
        }
        console.log(`Added id to ${addedCount} documents`);
        console.log(`Converted ${convertedCount} non-UUID ids to UUID v4`);
        console.log(
            `${documents.length - addedCount - convertedCount} documents already had valid UUID v4 ids`,
        );

        // Verify uniqueness after adding ids
        const idSet = new Set(documents.map((d) => d.id));
        if (idSet.size !== documents.length) {
            throw new Error('ID collision after UUID generation - this should not happen!');
        }
        console.log('All ids are unique');

        // Step 3: Drop the collection
        console.log('\n--- Step 3: Dropping messages collection ---');
        await messages.drop();
        console.log('Collection dropped');

        // Step 4: Create collection with unique index
        console.log('\n--- Step 4: Creating collection with unique index ---');
        const newMessages = db.collection('messages');

        // Create the unique index first (before inserting documents)
        await newMessages.createIndex({ id: 1 }, { unique: true });
        console.log('Created unique index on {id: 1}');

        // Also create other useful indexes
        await newMessages.createIndex({ tagId: 1, _id: -1 });
        await newMessages.createIndex({ threadId: 1, _id: -1 });
        await newMessages.createIndex({ userId: 1 });
        console.log('Created additional indexes');

        // Step 5: Restore documents
        console.log('\n--- Step 5: Restoring documents ---');
        const result = await newMessages.insertMany(documents);
        console.log(`Restored ${result.insertedCount} documents`);

        // Verify
        const finalCount = await newMessages.countDocuments();
        console.log(`\nVerification: ${finalCount} documents in collection`);

        if (finalCount !== documents.length) {
            throw new Error(
                `Document count mismatch! Expected ${documents.length}, got ${finalCount}`,
            );
        }

        console.log('\n--- Migration completed successfully ---');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

// Run migration
migrate();
