/**
 * Migration: Recreate pages collection with unique index on id (UUID v4)
 *
 * This migration:
 * 1. Backs up all documents from pages collection
 * 2. Converts all id fields to UUID v4 format
 * 3. Drops the pages collection
 * 4. Creates the collection with proper unique index on id
 * 5. Restores all documents with new UUID v4 ids
 *
 * Run with: bun run scripts/migrations/002b-recreate-pages-collection.ts
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
    console.log('Starting migration: Recreate pages collection with UUID v4 ids...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const pages = db.collection('pages');

        // Step 1: Backup all documents
        console.log('\n--- Step 1: Backing up documents ---');
        const documents = await pages.find({}).toArray();
        console.log(`Backed up ${documents.length} documents`);

        if (documents.length === 0) {
            console.log('No documents to migrate');
            return;
        }

        // Verify all documents have the id field
        const docsWithoutId = documents.filter((doc) => !doc.id);
        if (docsWithoutId.length > 0) {
            console.error(`Found ${docsWithoutId.length} documents without id field!`);
            console.log(
                'Document _ids without id:',
                docsWithoutId.map((d) => d._id),
            );
            throw new Error('Cannot proceed: some documents are missing the id field');
        }

        // Step 2: Convert all ids to UUID v4
        console.log('\n--- Step 2: Converting ids to UUID v4 ---');
        let convertedCount = 0;
        for (const doc of documents) {
            if (!isUUID(doc.id)) {
                const oldId = doc.id;
                doc.id = randomUUID();
                console.log(`  ${oldId} -> ${doc.id}`);
                convertedCount++;
            }
        }
        console.log(`Converted ${convertedCount} ids to UUID v4 format`);
        console.log(`${documents.length - convertedCount} ids were already UUID v4`);

        // Verify uniqueness after conversion
        const idSet = new Set(documents.map((d) => d.id));
        if (idSet.size !== documents.length) {
            throw new Error('ID collision after UUID generation - this should not happen!');
        }
        console.log('All ids are unique');

        // Step 3: Drop the collection
        console.log('\n--- Step 3: Dropping pages collection ---');
        await pages.drop();
        console.log('Collection dropped');

        // Step 4: Create collection with unique index
        console.log('\n--- Step 4: Creating collection with unique index ---');
        const newPages = db.collection('pages');

        // Create the unique index first (before inserting documents)
        await newPages.createIndex({ id: 1 }, { unique: true });
        console.log('Created unique index on {id: 1}');

        // Also create other useful indexes
        await newPages.createIndex({ userId: 1 });
        await newPages.createIndex({ tagId: 1 });
        await newPages.createIndex({ userId: 1, isTrashed: 1 });
        console.log('Created additional indexes');

        // Step 4: Restore documents
        console.log('\n--- Step 4: Restoring documents ---');
        const result = await newPages.insertMany(documents);
        console.log(`Restored ${result.insertedCount} documents`);

        // Verify
        const finalCount = await newPages.countDocuments();
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
