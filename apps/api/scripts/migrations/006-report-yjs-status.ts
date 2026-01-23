/**
 * Report: Check if all memos and whiteboards have corresponding pages
 *
 * This is a READ-ONLY report - no modifications are made.
 *
 * Run with: bun run scripts/migrations/006-report-yjs-status.ts
 */

import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

async function report() {
    console.log('=== Y.js Data Status Report ===\n');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        const pages = db.collection('pages');
        const memos = db.collection('memos');
        const whiteboards = db.collection('whiteboards');

        // Get all data
        const allPages = await pages.find({}).toArray();
        const allMemos = await memos.find({}).toArray();
        const allWhiteboards = await whiteboards.find({}).toArray();

        console.log('\n--- Collection Counts ---');
        console.log(`Pages: ${allPages.length}`);
        console.log(`Memos: ${allMemos.length}`);
        console.log(`Whiteboards: ${allWhiteboards.length}`);

        // Create lookup sets
        const pageIds = new Set(allPages.map((p) => p.id));
        const pageIdToPage = new Map(allPages.map((p) => [p.id, p]));

        // Check memos
        console.log('\n--- Memos Status ---');
        const memosWithPage: string[] = [];
        const memosWithoutPage: string[] = [];

        for (const memo of allMemos) {
            const noteId = memo.noteId || memo.id || memo.documentId;
            if (pageIds.has(noteId)) {
                memosWithPage.push(noteId);
            } else {
                memosWithoutPage.push(noteId);
            }
        }

        console.log(`Memos WITH matching page: ${memosWithPage.length}`);
        console.log(`Memos WITHOUT matching page: ${memosWithoutPage.length}`);

        if (memosWithoutPage.length > 0) {
            console.log('\nOrphaned memo noteIds:');
            for (const noteId of memosWithoutPage) {
                console.log(`  - ${noteId}`);
            }
        }

        // Check whiteboards
        console.log('\n--- Whiteboards Status ---');
        const whiteboardsWithPage: string[] = [];
        const whiteboardsWithoutPage: string[] = [];

        for (const wb of allWhiteboards) {
            const wbId = wb.id || wb.documentId;
            if (pageIds.has(wbId)) {
                whiteboardsWithPage.push(wbId);
            } else {
                whiteboardsWithoutPage.push(wbId);
            }
        }

        console.log(`Whiteboards WITH matching page: ${whiteboardsWithPage.length}`);
        console.log(`Whiteboards WITHOUT matching page: ${whiteboardsWithoutPage.length}`);

        if (whiteboardsWithoutPage.length > 0) {
            console.log('\nOrphaned whiteboard ids:');
            for (const wbId of whiteboardsWithoutPage) {
                console.log(`  - ${wbId}`);
            }
        }

        // Check pages without Y.js data
        console.log('\n--- Pages Status ---');
        const memoNoteIds = new Set(allMemos.map((m) => m.noteId || m.id || m.documentId));
        const whiteboardIds = new Set(allWhiteboards.map((wb) => wb.id || wb.documentId));

        const pagesWithYjsData: string[] = [];
        const pagesWithoutYjsData: string[] = [];

        for (const page of allPages) {
            if (page.type === 'memo' && memoNoteIds.has(page.id)) {
                pagesWithYjsData.push(page.id);
            } else if (page.type === 'whiteboard' && whiteboardIds.has(page.id)) {
                pagesWithYjsData.push(page.id);
            } else if (page.type === 'memo' || page.type === 'whiteboard') {
                pagesWithoutYjsData.push(`${page.id} (${page.type}: ${page.title})`);
            }
        }

        console.log(`Memo/Whiteboard pages WITH Y.js data: ${pagesWithYjsData.length}`);
        console.log(`Memo/Whiteboard pages WITHOUT Y.js data: ${pagesWithoutYjsData.length}`);

        if (pagesWithoutYjsData.length > 0) {
            console.log('\nPages missing Y.js data:');
            for (const info of pagesWithoutYjsData) {
                console.log(`  - ${info}`);
            }
        }

        // Summary
        console.log('\n--- Summary ---');
        console.log(`All memos have pages: ${memosWithoutPage.length === 0 ? 'YES ✓' : 'NO ✗'}`);
        console.log(
            `All whiteboards have pages: ${whiteboardsWithoutPage.length === 0 ? 'YES ✓' : 'NO ✗'}`,
        );
        console.log(
            `All memo/whiteboard pages have Y.js data: ${pagesWithoutYjsData.length === 0 ? 'YES ✓' : 'NO ✗'}`,
        );
    } catch (error) {
        console.error('Report failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

// Run report
report();
