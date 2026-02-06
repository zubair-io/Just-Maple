/**
 * Migration: Recreate memos collection with `id` + `pageId` fields
 *
 * Cosmos DB doesn't support dropping indexes, so we recreate the collection.
 *
 * This migration:
 * 1. Downloads all documents from memos collection
 * 2. Adds `id` field (set to old `noteId`) on each document
 * 3. Renames `noteId` → `pageId`
 * 4. Writes a JSON backup to disk (safety net)
 * 5. Drops the memos collection (removes old unique noteId index)
 * 6. Creates unique index on `id` + non-unique index on `pageId`
 * 7. Re-inserts all documents
 *
 * Run with: bun run scripts/migrations/009-recreate-memos-collection.ts
 */

import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

async function migrate() {
    console.log('Starting migration: Recreate memos collection with id + pageId fields...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const memos = db.collection('memos');

        // Step 1: Download all documents
        console.log('\n--- Step 1: Downloading all memo documents ---');
        const documents = await memos.find({}).toArray();
        console.log(`Downloaded ${documents.length} documents`);

        if (documents.length === 0) {
            console.log('No documents to migrate. Dropping and recreating empty collection...');
            try {
                await memos.drop();
            } catch {
                // Collection might not exist
            }
            const newMemos = db.collection('memos');
            await newMemos.createIndex({ id: 1 }, { unique: true });
            await newMemos.createIndex({ pageId: 1 });
            console.log('Created empty collection with new indexes');
            return;
        }

        // Step 2: Transform documents — add `id`, rename `noteId` → `pageId`
        console.log('\n--- Step 2: Transforming documents ---');
        let addedId = 0;
        let renamedNoteId = 0;

        for (const doc of documents) {
            // Add `id` field if missing (id = noteId for existing memos)
            if (!doc.id && doc.noteId) {
                doc.id = doc.noteId;
                addedId++;
            }

            // Rename `noteId` → `pageId`
            if (doc.noteId !== undefined) {
                doc.pageId = doc.noteId;
                delete doc.noteId;
                renamedNoteId++;
            }
        }

        console.log(`  ${addedId} documents got id = noteId`);
        console.log(`  ${renamedNoteId} documents had noteId renamed to pageId`);

        // Verify all docs have id and pageId
        const missingId = documents.filter((d) => !d.id);
        const missingPageId = documents.filter((d) => !d.pageId);
        if (missingId.length > 0) {
            console.error(`  ${missingId.length} documents missing id!`);
            throw new Error('Cannot proceed: some documents are missing the id field');
        }
        if (missingPageId.length > 0) {
            console.warn(`  ${missingPageId.length} documents missing pageId`);
        }

        // Verify uniqueness of the id field
        const idSet = new Set(documents.map((d) => d.id));
        if (idSet.size !== documents.length) {
            const ids = documents.map((d) => d.id);
            const dupes = ids.filter((id: string, i: number) => ids.indexOf(id) !== i);
            console.error(`Duplicate ids found: ${[...new Set(dupes)].join(', ')}`);
            throw new Error(
                `ID uniqueness check failed! ${documents.length} docs but ${idSet.size} unique ids`,
            );
        }
        console.log(`  All ${documents.length} ids are unique ✓`);

        // Step 3: Write backup to disk (safety net before drop)
        console.log('\n--- Step 3: Writing backup to disk ---');
        const backupPath = resolve(__dirname, `009-memos-backup-${Date.now()}.json`);
        writeFileSync(backupPath, JSON.stringify(documents, null, 2));
        console.log(`  Backup written to: ${backupPath}`);

        // Step 4: Drop the collection
        console.log('\n--- Step 4: Dropping memos collection ---');
        await memos.drop();
        console.log('  Collection dropped');

        // Brief pause for Cosmos DB to release the collection name
        await new Promise((r) => setTimeout(r, 2000));

        // Step 5: Create collection with new indexes
        console.log('\n--- Step 5: Creating new indexes ---');
        const newMemos = db.collection('memos');
        await newMemos.createIndex({ id: 1 }, { unique: true });
        console.log('  Created unique index on { id: 1 }');
        await newMemos.createIndex({ pageId: 1 });
        console.log('  Created non-unique index on { pageId: 1 }');

        // Step 6: Re-insert all documents
        console.log('\n--- Step 6: Re-inserting documents ---');
        const result = await newMemos.insertMany(documents);
        console.log(`  Inserted ${result.insertedCount} documents`);

        // Step 7: Verify
        console.log('\n--- Step 7: Verification ---');
        const finalCount = await newMemos.countDocuments();
        console.log(`  Documents in collection: ${finalCount}`);

        if (finalCount !== documents.length) {
            throw new Error(
                `Document count mismatch! Expected ${documents.length}, got ${finalCount}`,
            );
        }

        // Spot-check
        const sample = await newMemos.findOne({});
        if (sample) {
            console.log(`  Sample document — id: ${sample.id}, pageId: ${sample.pageId}`);
            console.log(`  Has noteId: ${'noteId' in sample} (should be false)`);
            console.log(`  id === pageId: ${sample.id === sample.pageId}`);
        }

        console.log('\n✓ Migration completed successfully');
    } catch (error) {
        console.error('\n✗ Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

// Run migration
migrate();
