/**
 * Migration: Rename tagId to notebookId
 *
 * This script renames the 'tagId' field to 'notebookId' in all relevant collections.
 *
 * Collections affected:
 * - pages
 * - messages
 * - threads
 * - collectables
 * - bot_invocations
 * - unread_tracking
 *
 * Usage:
 *   bun run scripts/migrate-tagid-to-notebookid.ts
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/justmaple';
const DRY_RUN = process.argv.includes('--dry-run');

interface MigrationResult {
    collection: string;
    matched: number;
    modified: number;
}

async function migrateCollection(db: any, collectionName: string): Promise<MigrationResult> {
    const collection = db.collection(collectionName);

    // Count documents with tagId
    const count = await collection.countDocuments({ tagId: { $exists: true } });

    if (DRY_RUN) {
        console.log(
            `[DRY RUN] ${collectionName}: Would rename tagId → notebookId in ${count} documents`,
        );
        return { collection: collectionName, matched: count, modified: 0 };
    }

    if (count === 0) {
        console.log(`${collectionName}: No documents with tagId found`);
        return { collection: collectionName, matched: 0, modified: 0 };
    }

    // Try $rename first (faster), fall back to manual update if not supported
    try {
        const result = await collection.updateMany(
            { tagId: { $exists: true } },
            { $rename: { tagId: 'notebookId' } },
        );

        console.log(
            `${collectionName}: Renamed tagId → notebookId in ${result.modifiedCount}/${result.matchedCount} documents`,
        );

        return {
            collection: collectionName,
            matched: result.matchedCount,
            modified: result.modifiedCount,
        };
    } catch (error: any) {
        // $rename not supported (e.g., CosmosDB) or index conflict - use manual approach
        console.log(`${collectionName}: $rename failed (${error.code}), using manual migration...`);

        let modified = 0;
        const cursor = collection.find({ tagId: { $exists: true } });

        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            if (!doc) continue;

            try {
                await collection.updateOne(
                    { _id: doc._id },
                    {
                        $set: { notebookId: doc.tagId },
                        $unset: { tagId: '' },
                    },
                );
                modified++;
            } catch (updateError: any) {
                console.warn(
                    `${collectionName}: Failed to migrate doc ${doc._id}: ${updateError.message}`,
                );
            }
        }

        console.log(
            `${collectionName}: Manually migrated tagId → notebookId in ${modified}/${count} documents`,
        );

        return {
            collection: collectionName,
            matched: count,
            modified,
        };
    }
}

const INDEX_MIGRATIONS = [
    {
        collection: 'pages',
        oldIndexes: ['tagId_1_updatedAt_-1', 'tagId_1'],
        newIndexes: [{ key: { notebookId: 1, updatedAt: -1 } }],
    },
    {
        collection: 'messages',
        oldIndexes: ['tagId_1__id_-1', 'tagId_1_createdAt_-1'],
        newIndexes: [
            { key: { notebookId: 1, _id: -1 } },
            { key: { notebookId: 1, createdAt: -1 } },
        ],
    },
    {
        collection: 'threads',
        oldIndexes: ['tagId_1'],
        newIndexes: [{ key: { notebookId: 1 } }],
    },
    {
        collection: 'collectables',
        oldIndexes: ['tagId_1_updatedAt_-1'],
        newIndexes: [{ key: { notebookId: 1, updatedAt: -1 } }],
    },
    {
        collection: 'unread_tracking',
        oldIndexes: ['userId_1_tagId_1'],
        newIndexes: [{ key: { userId: 1, notebookId: 1 }, options: { unique: true } }],
    },
];

async function dropOldIndexes(db: any): Promise<void> {
    for (const migration of INDEX_MIGRATIONS) {
        const collection = db.collection(migration.collection);

        for (const indexName of migration.oldIndexes) {
            try {
                if (DRY_RUN) {
                    console.log(`[DRY RUN] ${migration.collection}: Would drop index ${indexName}`);
                } else {
                    await collection.dropIndex(indexName);
                    console.log(`${migration.collection}: Dropped index ${indexName}`);
                }
            } catch (e: any) {
                if (e.code === 27) {
                    console.log(
                        `${migration.collection}: Index ${indexName} not found (already dropped)`,
                    );
                } else {
                    console.warn(
                        `${migration.collection}: Could not drop index ${indexName}:`,
                        e.message,
                    );
                }
            }
        }
    }
}

async function createNewIndexes(db: any): Promise<void> {
    console.log('\nCreating new indexes...\n');

    for (const migration of INDEX_MIGRATIONS) {
        const collection = db.collection(migration.collection);

        for (const index of migration.newIndexes) {
            try {
                if (DRY_RUN) {
                    console.log(
                        `[DRY RUN] ${migration.collection}: Would create index on ${JSON.stringify(index.key)}`,
                    );
                } else {
                    await collection.createIndex(index.key, (index as any).options || {});
                    console.log(
                        `${migration.collection}: Created index on ${JSON.stringify(index.key)}`,
                    );
                }
            } catch (e: any) {
                console.warn(
                    `${migration.collection}: Could not create index on ${JSON.stringify(index.key)}:`,
                    e.message,
                );
            }
        }
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('Migration: tagId → notebookId');
    console.log('='.repeat(60));

    if (DRY_RUN) {
        console.log('\n*** DRY RUN MODE - No changes will be made ***\n');
    }

    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();

        // Drop old indexes FIRST to avoid conflicts during data migration
        console.log('\nDropping old indexes first...\n');
        await dropOldIndexes(db);

        console.log('\nMigrating collections...\n');

        const collections = [
            'pages',
            'messages',
            'threads',
            'collectables',
            'bot_invocations',
            'unread_tracking',
        ];

        const results: MigrationResult[] = [];

        for (const collectionName of collections) {
            try {
                const result = await migrateCollection(db, collectionName);
                results.push(result);
            } catch (error) {
                console.error(`Error migrating ${collectionName}:`, error);
                results.push({ collection: collectionName, matched: 0, modified: 0 });
            }
        }

        // Create new indexes after data migration
        await createNewIndexes(db);

        console.log('\n' + '='.repeat(60));
        console.log('Migration Summary');
        console.log('='.repeat(60));

        let totalMatched = 0;
        let totalModified = 0;

        for (const result of results) {
            totalMatched += result.matched;
            totalModified += result.modified;
            console.log(`  ${result.collection}: ${result.modified}/${result.matched} documents`);
        }

        console.log('-'.repeat(60));
        console.log(`  TOTAL: ${totalModified}/${totalMatched} documents`);

        if (DRY_RUN) {
            console.log('\n*** DRY RUN COMPLETE - Run without --dry-run to apply changes ***');
        } else {
            console.log('\n*** MIGRATION COMPLETE ***');
        }
    } finally {
        await client.close();
    }
}

main().catch(console.error);
