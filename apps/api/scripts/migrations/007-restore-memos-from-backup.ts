/**
 * Migration: Restore memos from backup and create corresponding pages
 *
 * This migration:
 * 1. Reads the backup JSON file
 * 2. Creates pages with base58 IDs (so memo lookup works)
 * 3. Inserts memos with their original noteId and Y.js state
 *
 * Run with: bun run scripts/migrations/007-restore-memos-from-backup.ts
 */

import { MongoClient, ObjectId, Binary } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { homedir } from 'os';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';
const BACKUP_FILE = resolve(homedir(), 'Projects/justmaple.memo.json');

// Configuration
const TARGET_USER_ID = '693fa606c14587d250fe1f3d';
const TARGET_TAG_ID = '693fa65cc14587d250fe1f40';

interface BackupMemo {
    _id: { $oid: string };
    noteId?: string;
    state?: {
        $binary: {
            base64: string;
            subType: string;
        };
    };
    updatedAt?: { $date: string };
    version?: number;
    // Non-memo fields (folder document)
    type?: string;
    label?: string;
}

async function migrate() {
    console.log('=== Restore Memos from Backup ===\n');
    console.log(`Backup file: ${BACKUP_FILE}`);
    console.log(`Target user: ${TARGET_USER_ID}`);
    console.log(`Target tag: ${TARGET_TAG_ID}`);
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    // Read backup file
    let backupData: BackupMemo[];
    try {
        const fileContent = readFileSync(BACKUP_FILE, 'utf-8');
        backupData = JSON.parse(fileContent);
        console.log(`\nLoaded ${backupData.length} documents from backup`);
    } catch (err) {
        console.error('Failed to read backup file:', err);
        process.exit(1);
    }

    // Filter to only memo documents (have noteId and state)
    const memoBackups = backupData.filter((doc) => doc.noteId && doc.state);
    console.log(`Found ${memoBackups.length} memo documents`);

    // Show which have content vs empty
    const withContent = memoBackups.filter((m) => m.state?.$binary.base64 !== 'AAA=');
    const empty = memoBackups.filter((m) => m.state?.$binary.base64 === 'AAA=');
    console.log(`  - With content: ${withContent.length}`);
    console.log(`  - Empty (AAA=): ${empty.length}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        const pages = db.collection('pages');
        const memos = db.collection('memos');

        let createdPages = 0;
        let restoredMemos = 0;
        let skippedPages = 0;
        let skippedMemos = 0;

        console.log('\n--- Restoring memos ---');

        for (const backup of memoBackups) {
            const noteId = backup.noteId!;
            const stateBase64 = backup.state!.$binary.base64;
            const updatedAt = backup.updatedAt?.$date
                ? new Date(backup.updatedAt.$date)
                : new Date();
            const version = backup.version || 1;

            console.log(`\nProcessing: ${noteId}`);
            console.log(`  State size: ${stateBase64.length} chars (base64)`);

            // Step 1: Create page with base58 ID
            const pageDoc = {
                id: noteId, // Use base58 noteId as page id
                userId: new ObjectId(TARGET_USER_ID),
                tagId: new ObjectId(TARGET_TAG_ID),
                type: 'memo',
                title: `Restored Memo`,
                content: { type: 'doc', content: [] },
                isFavorite: false,
                isArchived: false,
                isTrashed: false,
                createdAt: updatedAt,
                updatedAt: updatedAt,
            };

            try {
                await pages.insertOne(pageDoc);
                console.log(`  ✓ Created page`);
                createdPages++;
            } catch (err: any) {
                if (err.code === 11000) {
                    console.log(`  - Page already exists (skipped)`);
                    skippedPages++;
                } else {
                    console.error(`  ✗ Failed to create page:`, err.message);
                    continue;
                }
            }

            // Step 2: Insert memo with original state
            // Convert base64 to Binary
            const stateBuffer = Buffer.from(stateBase64, 'base64');

            const memoDoc = {
                noteId: noteId,
                state: new Binary(stateBuffer),
                version: version,
                updatedAt: updatedAt,
            };

            try {
                // Check if memo already exists
                const existing = await memos.findOne({ noteId });
                if (existing) {
                    // Update existing memo with backup state
                    await memos.updateOne(
                        { noteId },
                        {
                            $set: {
                                state: new Binary(stateBuffer),
                                version: version,
                                updatedAt: updatedAt,
                            },
                        },
                    );
                    console.log(`  ✓ Updated existing memo`);
                    restoredMemos++;
                } else {
                    await memos.insertOne(memoDoc);
                    console.log(`  ✓ Created memo`);
                    restoredMemos++;
                }
            } catch (err: any) {
                console.error(`  ✗ Failed to create/update memo:`, err.message);
                skippedMemos++;
            }
        }

        // Summary
        console.log('\n--- Summary ---');
        console.log(`Pages created: ${createdPages}`);
        console.log(`Pages skipped (already exist): ${skippedPages}`);
        console.log(`Memos restored: ${restoredMemos}`);
        console.log(`Memos skipped/failed: ${skippedMemos}`);

        // Verify
        const totalPages = await pages.countDocuments();
        const totalMemos = await memos.countDocuments();
        console.log(`\nTotal pages in DB: ${totalPages}`);
        console.log(`Total memos in DB: ${totalMemos}`);

        console.log('\n=== Migration completed ===');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

// Run migration
migrate();
