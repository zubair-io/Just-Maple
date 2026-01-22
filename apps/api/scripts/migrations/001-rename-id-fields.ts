/**
 * Migration: Rename ID fields in recordings and whiteboards collections
 *
 * This migration renames:
 * - recordings.recordingId -> recordings.id
 * - whiteboards.documentId -> whiteboards.id
 *
 * Run with: bun run scripts/migrations/001-rename-id-fields.ts
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
    console.log('Starting migration: Rename ID fields...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        // Migrate recordings collection: recordingId -> id
        console.log('\n--- Migrating recordings collection ---');
        const recordings = db.collection('recordings');

        // Check if migration is needed
        const recordingWithOldField = await recordings.findOne({ recordingId: { $exists: true } });
        if (recordingWithOldField) {
            console.log('Found documents with recordingId field, migrating...');

            // Rename field for all documents
            const recordingResult = await recordings.updateMany(
                { recordingId: { $exists: true } },
                { $rename: { recordingId: 'id' } },
            );
            console.log(`Recordings: Updated ${recordingResult.modifiedCount} documents`);

            // Create index on new field (if not exists)
            await recordings.createIndex({ id: 1, userId: 1 });
            console.log('Recordings: Created index on {id: 1, userId: 1}');
        } else {
            const hasNewField = await recordings.findOne({ id: { $exists: true } });
            if (hasNewField) {
                console.log('Recordings: Already migrated (id field exists)');
            } else {
                console.log('Recordings: No documents to migrate');
            }
        }

        // Migrate whiteboards collection: documentId -> id
        console.log('\n--- Migrating whiteboards collection ---');
        const whiteboards = db.collection('whiteboards');

        // Check if migration is needed
        const whiteboardWithOldField = await whiteboards.findOne({ documentId: { $exists: true } });
        if (whiteboardWithOldField) {
            console.log('Found documents with documentId field, migrating...');

            // Rename field for all documents
            const whiteboardResult = await whiteboards.updateMany(
                { documentId: { $exists: true } },
                { $rename: { documentId: 'id' } },
            );
            console.log(`Whiteboards: Updated ${whiteboardResult.modifiedCount} documents`);

            // Create index on new field (if not exists)
            await whiteboards.createIndex({ id: 1 }, { unique: true });
            console.log('Whiteboards: Created unique index on {id: 1}');
        } else {
            const hasNewField = await whiteboards.findOne({ id: { $exists: true } });
            if (hasNewField) {
                console.log('Whiteboards: Already migrated (id field exists)');
            } else {
                console.log('Whiteboards: No documents to migrate');
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
