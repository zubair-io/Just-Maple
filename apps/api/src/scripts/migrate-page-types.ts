/**
 * Migration script to update page types:
 * - 'lego' -> 'collectable'
 * - 'notebook' -> 'memo'
 *
 * Run with: bun run apps/api/src/scripts/migrate-page-types.ts
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

const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/maple';

async function migrate() {
    console.log('Connecting to MongoDB...', mongodbUri);
    const client = new MongoClient(mongodbUri);
    await client.connect();

    const db = client.db();
    const pagesCollection = db.collection('pages');

    console.log('\n--- Page Type Migration ---\n');

    // Get counts before migration
    const legoBefore = await pagesCollection.countDocuments({ type: 'lego' });
    const notebookBefore = await pagesCollection.countDocuments({ type: 'notebook' });

    console.log(`Found ${legoBefore} pages with type 'lego'`);
    console.log(`Found ${notebookBefore} pages with type 'notebook'`);

    if (legoBefore === 0 && notebookBefore === 0) {
        console.log('\nNo pages to migrate. Exiting.');
        await client.close();
        return;
    }

    // Migrate 'lego' -> 'collectable'
    if (legoBefore > 0) {
        console.log(`\nMigrating 'lego' -> 'collectable'...`);
        const legoResult = await pagesCollection.updateMany(
            { type: 'lego' },
            { $set: { type: 'collectable' } },
        );
        console.log(`  Updated ${legoResult.modifiedCount} pages`);
    }

    // Migrate 'notebook' -> 'memo'
    if (notebookBefore > 0) {
        console.log(`\nMigrating 'notebook' -> 'memo'...`);
        const notebookResult = await pagesCollection.updateMany(
            { type: 'notebook' },
            { $set: { type: 'memo' } },
        );
        console.log(`  Updated ${notebookResult.modifiedCount} pages`);
    }

    // Verify migration
    console.log('\n--- Verification ---\n');
    const legoAfter = await pagesCollection.countDocuments({ type: 'lego' });
    const notebookAfter = await pagesCollection.countDocuments({ type: 'notebook' });
    const collectableAfter = await pagesCollection.countDocuments({ type: 'collectable' });
    const memoAfter = await pagesCollection.countDocuments({ type: 'memo' });

    console.log(`Pages with type 'lego': ${legoAfter} (was ${legoBefore})`);
    console.log(`Pages with type 'notebook': ${notebookAfter} (was ${notebookBefore})`);
    console.log(`Pages with type 'collectable': ${collectableAfter}`);
    console.log(`Pages with type 'memo': ${memoAfter}`);

    if (legoAfter === 0 && notebookAfter === 0) {
        console.log('\nMigration completed successfully!');
    } else {
        console.log('\nWarning: Some pages may not have been migrated.');
    }

    await client.close();
    console.log('\nDatabase connection closed.');
}

migrate().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
