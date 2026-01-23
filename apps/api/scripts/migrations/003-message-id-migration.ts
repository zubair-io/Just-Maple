/**
 * Migration: Add UUID v4 id field to messages collection
 *
 * This migration:
 * 1. Adds a UUID v4 `id` field to all existing messages
 * 2. Creates a unique index on `id`
 *
 * Run with: bun run scripts/migrations/003-message-id-migration.ts
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

async function migrate() {
    console.log('Starting migration: Add UUID v4 id field to messages...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const messages = db.collection('messages');

        // Step 1: Count messages without id field
        const countWithoutId = await messages.countDocuments({ id: { $exists: false } });
        console.log(`\nFound ${countWithoutId} messages without id field`);

        if (countWithoutId === 0) {
            console.log('All messages already have id field');
        } else {
            // Step 2: Add UUID v4 id to all messages that don't have one
            console.log('\n--- Adding UUID v4 id to messages ---');

            const cursor = messages.find({ id: { $exists: false } });
            let updatedCount = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                if (!doc) continue;

                const newId = randomUUID();
                await messages.updateOne({ _id: doc._id }, { $set: { id: newId } });
                updatedCount++;

                if (updatedCount % 100 === 0) {
                    console.log(`  Updated ${updatedCount} messages...`);
                }
            }

            console.log(`Updated ${updatedCount} messages with UUID v4 ids`);
        }

        // Step 3: Create unique index on id
        console.log('\n--- Creating unique index on id ---');
        try {
            await messages.createIndex({ id: 1 }, { unique: true });
            console.log('Created unique index on {id: 1}');
        } catch (error: any) {
            if (error.code === 11000 || error.message?.includes('duplicate')) {
                console.log('Unique index already exists or duplicate key error');
            } else {
                throw error;
            }
        }

        // Step 4: Verify
        const totalCount = await messages.countDocuments();
        const countWithId = await messages.countDocuments({ id: { $exists: true } });
        console.log(`\nVerification: ${countWithId}/${totalCount} messages have id field`);

        if (countWithId !== totalCount) {
            throw new Error('Not all messages have id field!');
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
