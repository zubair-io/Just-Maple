/**
 * Migration Script: Tag & Note Type Refactoring
 *
 * This script performs the following migrations:
 * 1. Tags: Add value='mixed' to tags without a value field
 * 2. Tags: Remove deprecated fields (color, parentId, order)
 * 3. Notes: Add type='write' to notes without a type field
 *
 * Usage:
 *   MONGODB_URI="mongodb://..." bun run scripts/migrate-tag-note-types.ts
 *
 * For production CosmosDB:
 *   MONGODB_URI="mongodb://japanese-maple:xxx@japanese-maple.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@japanese-maple@" bun run scripts/migrate-tag-note-types.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI environment variable is required');
    process.exit(1);
}

async function migrate() {
    console.log('Starting migration...');
    console.log('Connecting to database...');

    const client = new MongoClient(MONGODB_URI!);

    try {
        await client.connect();
        const db = client.db();
        console.log('Connected to database');

        // Migration 1: Update tags - set value = 'mixed' where not set
        console.log('\n--- Migrating Tags ---');

        const tagsCollection = db.collection('tags');
        const tagsWithoutValue = await tagsCollection.countDocuments({
            $or: [{ value: { $exists: false } }, { value: { $nin: ['mixed', 'recordings', 'notes'] } }],
        });
        console.log(`Found ${tagsWithoutValue} tags without valid value field`);

        if (tagsWithoutValue > 0) {
            const tagUpdateResult = await tagsCollection.updateMany(
                {
                    $or: [
                        { value: { $exists: false } },
                        { value: { $nin: ['mixed', 'recordings', 'notes'] } },
                    ],
                },
                { $set: { value: 'mixed' } },
            );
            console.log(`Updated ${tagUpdateResult.modifiedCount} tags with value='mixed'`);
        }

        // Migration 2: Remove deprecated fields from tags
        const tagsWithDeprecated = await tagsCollection.countDocuments({
            $or: [{ color: { $exists: true } }, { parentId: { $exists: true } }, { order: { $exists: true } }],
        });
        console.log(`Found ${tagsWithDeprecated} tags with deprecated fields`);

        if (tagsWithDeprecated > 0) {
            const removeDeprecatedResult = await tagsCollection.updateMany(
                {},
                { $unset: { color: '', parentId: '', order: '' } },
            );
            console.log(`Removed deprecated fields from ${removeDeprecatedResult.modifiedCount} tags`);
        }

        // Migration 3: Update notes - set type = 'write' where not set
        console.log('\n--- Migrating Notes ---');

        const notesCollection = db.collection('notes');
        const notesWithoutType = await notesCollection.countDocuments({
            type: { $exists: false },
        });
        console.log(`Found ${notesWithoutType} notes without type field`);

        if (notesWithoutType > 0) {
            const noteUpdateResult = await notesCollection.updateMany(
                { type: { $exists: false } },
                { $set: { type: 'write' } },
            );
            console.log(`Updated ${noteUpdateResult.modifiedCount} notes with type='write'`);
        }

        console.log('\n--- Migration Complete ---');

        // Summary
        const totalTags = await tagsCollection.countDocuments();
        const totalNotes = await notesCollection.countDocuments();
        console.log(`\nSummary:`);
        console.log(`  Total tags: ${totalTags}`);
        console.log(`  Total notes: ${totalNotes}`);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
        console.log('\nDatabase connection closed');
    }
}

migrate().catch(console.error);
