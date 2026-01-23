/**
 * Migration: Clean up orphaned memos and whiteboards after page ID migration
 *
 * This migration:
 * 1. Gets all current page IDs (UUIDs) from the pages collection
 * 2. Removes memos where noteId doesn't match any current page ID
 * 3. Removes whiteboards where id doesn't match any current page ID
 *
 * Background: The 002b migration converted page IDs from base58 to UUID v4,
 * but the memos/whiteboards collections still reference the old base58 IDs.
 * This results in orphaned Y.js data that can't be found.
 *
 * Run with: bun run scripts/migrations/004-cleanup-orphaned-yjs-data.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

async function migrate() {
    console.log('Starting migration: Clean up orphaned memos and whiteboards...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        // Step 1: Get all current page IDs
        console.log('\n--- Step 1: Getting current page IDs ---');
        const pages = db.collection('pages');
        const pageIds = await pages.distinct('id');
        console.log(`Found ${pageIds.length} pages with IDs`);

        // Create a Set for efficient lookup
        const validPageIds = new Set(pageIds);

        // Step 2: Clean up orphaned memos
        console.log('\n--- Step 2: Cleaning up orphaned memos ---');
        const memos = db.collection('memos');
        const allMemos = await memos.find({}).toArray();
        console.log(`Found ${allMemos.length} total memos`);

        const orphanedMemoIds: string[] = [];
        for (const memo of allMemos) {
            const noteId = memo.noteId || memo.id || memo.documentId;
            if (!noteId || !validPageIds.has(noteId)) {
                orphanedMemoIds.push(memo._id.toString());
                console.log(`  Orphaned memo: noteId=${noteId}`);
            }
        }

        if (orphanedMemoIds.length > 0) {
            console.log(`Deleting ${orphanedMemoIds.length} orphaned memos...`);
            const memoResult = await memos.deleteMany({
                _id: { $in: orphanedMemoIds.map((id) => new ObjectId(id)) },
            });
            console.log(`Deleted ${memoResult.deletedCount} orphaned memos`);
        } else {
            console.log('No orphaned memos found');
        }

        // Step 3: Clean up orphaned whiteboards
        console.log('\n--- Step 3: Cleaning up orphaned whiteboards ---');
        const whiteboards = db.collection('whiteboards');
        const allWhiteboards = await whiteboards.find({}).toArray();
        console.log(`Found ${allWhiteboards.length} total whiteboards`);

        const orphanedWhiteboardIds: string[] = [];
        for (const wb of allWhiteboards) {
            const wbId = wb.id || wb.documentId;
            if (!wbId || !validPageIds.has(wbId)) {
                orphanedWhiteboardIds.push(wb._id.toString());
                console.log(`  Orphaned whiteboard: id=${wbId}`);
            }
        }

        if (orphanedWhiteboardIds.length > 0) {
            console.log(`Deleting ${orphanedWhiteboardIds.length} orphaned whiteboards...`);
            const wbResult = await whiteboards.deleteMany({
                _id: { $in: orphanedWhiteboardIds.map((id) => new ObjectId(id)) },
            });
            console.log(`Deleted ${wbResult.deletedCount} orphaned whiteboards`);
        } else {
            console.log('No orphaned whiteboards found');
        }

        // Summary
        console.log('\n--- Summary ---');
        console.log(`Pages: ${pageIds.length}`);
        console.log(`Orphaned memos deleted: ${orphanedMemoIds.length}`);
        console.log(`Orphaned whiteboards deleted: ${orphanedWhiteboardIds.length}`);

        // Remaining valid documents
        const remainingMemos = await memos.countDocuments();
        const remainingWhiteboards = await whiteboards.countDocuments();
        console.log(`Remaining memos: ${remainingMemos}`);
        console.log(`Remaining whiteboards: ${remainingWhiteboards}`);

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
