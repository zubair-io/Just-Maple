/**
 * Migration: Rename documentId → id in pages collection and migrate 'write' type to 'memo'
 *
 * This migration:
 * 1. Renames pages.documentId -> pages.id
 * 2. Migrates page type 'write' -> 'memo'
 * 3. Creates a unique index on the id field
 *
 * Run with: bun run scripts/migrations/002-page-id-migration.ts
 */

import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

async function migrate() {
    console.log('Starting migration: Page ID field and type migration...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        // Migrate pages collection: documentId -> id
        console.log('\n--- Migrating pages collection ---');
        const pages = db.collection('pages');

        // Step 1: Rename documentId -> id
        const pagesWithOldField = await pages.findOne({ documentId: { $exists: true } });
        if (pagesWithOldField) {
            console.log('Found documents with documentId field, renaming to id...');

            const renameResult = await pages.updateMany(
                { documentId: { $exists: true } },
                { $rename: { documentId: 'id' } },
            );
            console.log(
                `Pages: Renamed documentId → id for ${renameResult.modifiedCount} documents`,
            );
        } else {
            const hasNewField = await pages.findOne({ id: { $exists: true } });
            if (hasNewField) {
                console.log('Pages: Already migrated (id field exists)');
            } else {
                console.log('Pages: No documents to migrate');
            }
        }

        // Step 2: Migrate 'write' type to 'memo'
        console.log('\n--- Migrating page types ---');
        const pagesWithWriteType = await pages.countDocuments({ type: 'write' });
        if (pagesWithWriteType > 0) {
            console.log(
                `Found ${pagesWithWriteType} pages with type 'write', migrating to 'memo'...`,
            );

            const typeResult = await pages.updateMany(
                { type: 'write' },
                { $set: { type: 'memo' } },
            );
            console.log(`Pages: Updated type for ${typeResult.modifiedCount} documents`);
        } else {
            console.log('Pages: No documents with type "write" found');
        }

        // Step 3: Create unique index on id field
        console.log('\n--- Creating indexes ---');
        try {
            // Drop old index if exists (might fail if doesn't exist, that's ok)
            try {
                await pages.dropIndex('documentId_1');
                console.log('Pages: Dropped old documentId index');
            } catch {
                // Index might not exist, continue
            }

            await pages.createIndex({ id: 1 }, { unique: true });
            console.log('Pages: Created unique index on {id: 1}');
        } catch (error: any) {
            if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
                console.log('Pages: Index already exists with same options');
            } else {
                throw error;
            }
        }

        // Step 4: Also migrate memos collection (documentId -> id)
        console.log('\n--- Migrating memos collection ---');
        const memos = db.collection('memos');

        const memosWithOldField = await memos.findOne({ documentId: { $exists: true } });
        if (memosWithOldField) {
            console.log('Found memos with documentId field, renaming to id...');

            const memoRenameResult = await memos.updateMany(
                { documentId: { $exists: true } },
                { $rename: { documentId: 'id' } },
            );
            console.log(
                `Memos: Renamed documentId → id for ${memoRenameResult.modifiedCount} documents`,
            );

            // Update index
            try {
                await memos.dropIndex('documentId_1');
            } catch {
                // Index might not exist
            }
            await memos.createIndex({ id: 1 }, { unique: true });
            console.log('Memos: Created unique index on {id: 1}');
        } else {
            const hasNewField = await memos.findOne({ id: { $exists: true } });
            if (hasNewField) {
                console.log('Memos: Already migrated (id field exists)');
            } else {
                console.log('Memos: No documents to migrate');
            }
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
