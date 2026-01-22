/**
 * Migration: Find and clean up duplicate data preventing unique indexes
 *
 * By default, shows duplicates without modifying data.
 * Run with --clean flag to actually remove duplicates (keeps most recent).
 *
 * Usage:
 *   bun run scripts/migrations/002-cleanup-duplicates.ts          # Show duplicates only
 *   bun run scripts/migrations/002-cleanup-duplicates.ts --clean  # Remove duplicates
 */

import { MongoClient, ObjectId } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/just-maple';
const shouldClean = process.argv.includes('--clean');

interface DuplicateGroup {
    key: string;
    count: number;
    ids: string[];
    keepId: string;
    removeIds: string[];
}

async function findDuplicates(
    client: MongoClient,
    collectionName: string,
    field: string | string[],
): Promise<DuplicateGroup[]> {
    const db = client.db();
    const collection = db.collection(collectionName);

    // Build aggregation pipeline for single or compound field
    const isCompound = Array.isArray(field);
    const groupId = isCompound
        ? field.reduce((acc, f) => ({ ...acc, [f]: `$${f}` }), {})
        : `$${field}`;

    const pipeline = [
        {
            $group: {
                _id: groupId,
                count: { $sum: 1 },
                docs: { $push: { id: '$_id', updatedAt: '$updatedAt', createdAt: '$createdAt' } },
            },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
    ];

    const duplicates = await collection.aggregate(pipeline).toArray();

    return duplicates.map((dup) => {
        // Sort docs by updatedAt or createdAt (most recent first), then by _id
        const sortedDocs = dup.docs.sort((a: any, b: any) => {
            const dateA = a.updatedAt || a.createdAt || new ObjectId(a.id).getTimestamp();
            const dateB = b.updatedAt || b.createdAt || new ObjectId(b.id).getTimestamp();
            return new Date(dateB).getTime() - new Date(dateA).getTime();
        });

        const ids = sortedDocs.map((d: any) => d.id.toString());
        const keyValue = isCompound
            ? Object.entries(dup._id)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')
            : String(dup._id);

        return {
            key: keyValue,
            count: dup.count,
            ids,
            keepId: ids[0], // Keep most recent
            removeIds: ids.slice(1), // Remove older ones
        };
    });
}

async function cleanupDuplicates(
    client: MongoClient,
    collectionName: string,
    duplicates: DuplicateGroup[],
): Promise<number> {
    const db = client.db();
    const collection = db.collection(collectionName);

    let totalRemoved = 0;

    for (const dup of duplicates) {
        const result = await collection.deleteMany({
            _id: { $in: dup.removeIds.map((id) => new ObjectId(id)) },
        });
        totalRemoved += result.deletedCount;
    }

    return totalRemoved;
}

async function processCollection(
    client: MongoClient,
    name: string,
    field: string | string[],
    fieldLabel: string,
): Promise<{ found: number; removed: number }> {
    console.log(`\n--- ${name}.${fieldLabel} ---`);

    const duplicates = await findDuplicates(client, name, field);

    if (duplicates.length === 0) {
        console.log('No duplicates found');
        return { found: 0, removed: 0 };
    }

    console.log(`Found ${duplicates.length} duplicate groups:\n`);

    for (const dup of duplicates) {
        console.log(`  "${dup.key}" (${dup.count} copies)`);
        console.log(`    Keep:   ${dup.keepId}`);
        console.log(`    Remove: ${dup.removeIds.join(', ')}`);
    }

    const totalDuplicates = duplicates.reduce((sum, d) => sum + d.removeIds.length, 0);

    if (shouldClean) {
        const removed = await cleanupDuplicates(client, name, duplicates);
        console.log(`\n  Removed ${removed} duplicate documents`);
        return { found: totalDuplicates, removed };
    } else {
        console.log(`\n  Would remove ${totalDuplicates} documents (run with --clean to apply)`);
        return { found: totalDuplicates, removed: 0 };
    }
}

async function migrate() {
    console.log(
        shouldClean ? 'CLEANUP MODE: Will remove duplicates' : 'DRY RUN: Showing duplicates only',
    );
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();

        const results: { collection: string; found: number; removed: number }[] = [];

        // Check each collection with unique index issues
        const collections: [string, string | string[], string][] = [
            ['users', 'email', 'email'],
            ['passkeys', 'credentialId', 'credentialId'],
            ['memos', 'noteId', 'noteId'],
            ['bot_templates', 'handle', 'handle'],
            ['user_bots', ['userId', 'handle'], 'userId+handle'],
        ];

        for (const [name, field, label] of collections) {
            const result = await processCollection(client, name, field, label);
            results.push({ collection: `${name}.${label}`, ...result });
        }

        // Summary
        console.log('\n========== SUMMARY ==========');
        const totalFound = results.reduce((sum, r) => sum + r.found, 0);
        const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);

        for (const r of results) {
            if (r.found > 0) {
                console.log(
                    `  ${r.collection}: ${r.found} duplicates${shouldClean ? `, ${r.removed} removed` : ''}`,
                );
            }
        }

        if (totalFound === 0) {
            console.log('  No duplicates found in any collection!');
        } else if (shouldClean) {
            console.log(`\nTotal: ${totalRemoved} duplicates removed`);
            console.log('Restart the server to create unique indexes.');
        } else {
            console.log(`\nTotal: ${totalFound} duplicates found`);
            console.log('Run with --clean flag to remove them.');
        }
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

migrate();
