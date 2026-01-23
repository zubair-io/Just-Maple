/**
 * Migration: Recover orphaned memos and whiteboards by creating pages for them
 *
 * This migration:
 * 1. Finds all memos that don't have a corresponding page
 * 2. Finds all whiteboards that don't have a corresponding page
 * 3. Creates pages for them with the specified user and tag
 *
 * Run with: bun run scripts/migrations/005-recover-orphaned-yjs-data.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

// Configuration - user and tag to assign recovered pages to
const TARGET_USER_ID = '693fa606c14587d250fe1f3d';
const TARGET_TAG_ID = '693fa65cc14587d250fe1f40';

async function migrate() {
    console.log('Starting migration: Recover orphaned memos and whiteboards...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);
    console.log(`\nTarget user: ${TARGET_USER_ID}`);
    console.log(`Target tag: ${TARGET_TAG_ID}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        const pages = db.collection('pages');
        const memos = db.collection('memos');
        const whiteboards = db.collection('whiteboards');

        // Step 1: Get all current page IDs
        console.log('\n--- Step 1: Getting current page IDs ---');
        const pageIds = new Set(await pages.distinct('id'));
        console.log(`Found ${pageIds.size} existing pages`);

        // Step 2: Find orphaned memos (noteId doesn't match any page id)
        console.log('\n--- Step 2: Finding orphaned memos ---');
        const allMemos = await memos.find({}).toArray();
        const orphanedMemos = allMemos.filter((memo) => {
            const noteId = memo.noteId || memo.id || memo.documentId;
            return noteId && !pageIds.has(noteId);
        });
        console.log(`Found ${orphanedMemos.length} orphaned memos`);

        // Step 3: Find orphaned whiteboards (id doesn't match any page id)
        console.log('\n--- Step 3: Finding orphaned whiteboards ---');
        const allWhiteboards = await whiteboards.find({}).toArray();
        const orphanedWhiteboards = allWhiteboards.filter((wb) => {
            const wbId = wb.id || wb.documentId;
            return wbId && !pageIds.has(wbId);
        });
        console.log(`Found ${orphanedWhiteboards.length} orphaned whiteboards`);

        if (orphanedMemos.length === 0 && orphanedWhiteboards.length === 0) {
            console.log('\nNo orphaned data to recover!');
            return;
        }

        const now = new Date();
        let createdMemoPages = 0;
        let createdWhiteboardPages = 0;

        // Step 4: Create pages for orphaned memos
        console.log('\n--- Step 4: Creating pages for orphaned memos ---');
        for (const memo of orphanedMemos) {
            const noteId = memo.noteId || memo.id || memo.documentId;
            if (!noteId) continue;

            const pageDoc = {
                id: noteId, // Use the memo's noteId as the page id
                userId: new ObjectId(TARGET_USER_ID),
                tagId: new ObjectId(TARGET_TAG_ID),
                type: 'memo',
                title: `Recovered Memo ${createdMemoPages + 1}`,
                content: { type: 'doc', content: [] },
                isFavorite: false,
                isArchived: false,
                isTrashed: false,
                createdAt: memo.updatedAt || now,
                updatedAt: memo.updatedAt || now,
            };

            try {
                await pages.insertOne(pageDoc);
                console.log(`  Created page for memo: ${noteId}`);
                createdMemoPages++;
            } catch (err: any) {
                if (err.code === 11000) {
                    console.log(`  Skipped (page already exists): ${noteId}`);
                } else {
                    console.error(`  Failed to create page for memo ${noteId}:`, err.message);
                }
            }
        }

        // Step 5: Create pages for orphaned whiteboards
        console.log('\n--- Step 5: Creating pages for orphaned whiteboards ---');
        for (const wb of orphanedWhiteboards) {
            const wbId = wb.id || wb.documentId;
            if (!wbId) continue;

            const pageDoc = {
                id: wbId, // Use the whiteboard's id as the page id
                userId: new ObjectId(TARGET_USER_ID),
                tagId: new ObjectId(TARGET_TAG_ID),
                type: 'whiteboard',
                title: `Recovered Whiteboard ${createdWhiteboardPages + 1}`,
                content: { type: 'doc', content: [] },
                isFavorite: false,
                isArchived: false,
                isTrashed: false,
                createdAt: wb.updatedAt || now,
                updatedAt: wb.updatedAt || now,
            };

            try {
                await pages.insertOne(pageDoc);
                console.log(`  Created page for whiteboard: ${wbId}`);
                createdWhiteboardPages++;
            } catch (err: any) {
                if (err.code === 11000) {
                    console.log(`  Skipped (page already exists): ${wbId}`);
                } else {
                    console.error(`  Failed to create page for whiteboard ${wbId}:`, err.message);
                }
            }
        }

        // Summary
        console.log('\n--- Summary ---');
        console.log(`Created ${createdMemoPages} memo pages`);
        console.log(`Created ${createdWhiteboardPages} whiteboard pages`);
        console.log(`Total pages recovered: ${createdMemoPages + createdWhiteboardPages}`);

        // Verify
        const finalPageCount = await pages.countDocuments();
        console.log(`\nTotal pages in collection: ${finalPageCount}`);

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
