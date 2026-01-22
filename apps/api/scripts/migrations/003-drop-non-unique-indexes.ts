/**
 * Migration: Drop non-unique indexes so unique indexes can be created
 *
 * This script drops existing non-unique indexes that are blocking
 * the creation of unique indexes on server startup.
 *
 * Run with: bun run scripts/migrations/003-drop-non-unique-indexes.ts
 * Then restart the server to recreate indexes as unique.
 */

import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';

async function dropIndexes() {
    console.log('Dropping non-unique indexes to allow unique index creation...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        const indexes: [string, string][] = [
            ['users', 'email_1'],
            ['passkeys', 'credentialId_1'],
            ['memos', 'noteId_1'],
            ['bot_templates', 'handle_1'],
            ['user_bots', 'userId_1_handle_1'],
        ];

        for (const [collName, indexName] of indexes) {
            try {
                await db.collection(collName).dropIndex(indexName);
                console.log(`  Dropped: ${collName}.${indexName}`);
            } catch (e: any) {
                if (e.code === 27) {
                    console.log(`  Skip: ${collName}.${indexName} (index not found)`);
                } else {
                    console.log(`  Error: ${collName}.${indexName} - ${e.message}`);
                }
            }
        }

        console.log('\nDone. Restart the server to create unique indexes.');
    } catch (error) {
        console.error('Failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

dropIndexes();
