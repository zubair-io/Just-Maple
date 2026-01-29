/**
 * Migration script to build the search index for all existing pages.
 * This extracts plain text from Y.js documents and page content,
 * then stores it in the search_index collection for full-text search.
 *
 * Run with: bun run apps/api/src/scripts/build-search-index.ts
 */

import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
await Bun.file(envPath)
    .text()
    .then((content) => {
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                if (key && !process.env[key]) {
                    process.env[key] = value;
                }
            }
        }
    })
    .catch(() => {
        console.warn(`Warning: Could not load .env from ${envPath}`);
    });

// Now import the modules that need the database connection
import { connectToDatabase, closeDatabase } from '../db/client';
import { reindexAll } from '../repositories/search.repo';

async function buildSearchIndex() {
    console.log('Building search index for all pages...\n');

    try {
        // Connect to database (this creates indexes including search_index)
        await connectToDatabase();

        console.log('Starting reindex...\n');

        // Run the reindex
        await reindexAll();

        console.log('\nSearch index build complete!');
    } catch (error) {
        console.error('Search index build failed:', error);
        throw error;
    } finally {
        await closeDatabase();
        console.log('Database connection closed.');
    }
}

buildSearchIndex().catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});
