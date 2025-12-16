/**
 * Migration Script: Fix Paper Registry Links
 *
 * This script:
 * 1. Loops through all papers
 * 2. Finds the correct registry by matching providerId === paper.data.itemId
 * 3. Updates paper.data.registryData if it's wrong
 * 4. Deletes duplicate papers that have the same registryData
 *
 * Usage:
 *   MONGODB_URI="mongodb://..." bun run scripts/fix-paper-registry-links.ts
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI environment variable is required');
    process.exit(1);
}

async function migrate() {
    console.log('Starting paper registry link fix...');
    console.log('Connecting to database...');

    const client = new MongoClient(MONGODB_URI!);

    try {
        await client.connect();
        const db = client.db();
        console.log('Connected to database');

        const papersCollection = db.collection('paper');
        const registriesCollection = db.collection('collectibleregistries');

        // Get all papers
        const papers = await papersCollection.find({}).toArray();
        console.log(`Found ${papers.length} papers to check`);

        // Get all registries and create lookup maps
        const registries = await registriesCollection.find({}).toArray();
        console.log(`Found ${registries.length} registries`);

        // Map: providerId -> registry
        const registryByProviderId = new Map<string, any>();
        for (const reg of registries) {
            registryByProviderId.set(reg.providerId, reg);
        }

        // Track stats
        let fixed = 0;
        let alreadyCorrect = 0;
        let noMatchingRegistry = 0;
        let deleted = 0;

        // First pass: check and fix registry links
        console.log('\n--- Checking Paper Registry Links ---');

        for (const paper of papers) {
            const itemId = paper.data?.itemId;
            const currentRegistryData = paper.data?.registryData?.toString();

            if (!itemId) {
                console.log(`  Paper ${paper._id}: No itemId, skipping`);
                continue;
            }

            // Find the correct registry by providerId
            const correctRegistry = registryByProviderId.get(itemId);

            if (!correctRegistry) {
                console.log(`  Paper ${paper._id}: No registry found for itemId="${itemId}"`);
                noMatchingRegistry++;
                continue;
            }

            const correctRegistryId = correctRegistry._id.toString();

            if (currentRegistryData === correctRegistryId) {
                alreadyCorrect++;
            } else {
                console.log(`  Paper ${paper._id}: Wrong registryData`);
                console.log(`    itemId: ${itemId}`);
                console.log(`    Current registryData: ${currentRegistryData}`);
                console.log(`    Correct registryData: ${correctRegistryId}`);

                // Update the paper with correct registryData
                await papersCollection.updateOne(
                    { _id: paper._id },
                    {
                        $set: {
                            'data.registryData': new ObjectId(correctRegistryId),
                            updatedAt: new Date(),
                        },
                    },
                );
                console.log(`    ✓ Fixed!`);
                fixed++;
            }
        }

        // Re-fetch papers after fixes for duplicate detection
        const updatedPapers = await papersCollection.find({}).toArray();

        // Second pass: find and delete duplicates (same registryData AND same tag)
        console.log('\n--- Checking for Duplicates ---');

        // Build map of (registryData + tagId) -> papers
        const papersByRegistryAndTag = new Map<string, any[]>();

        for (const paper of updatedPapers) {
            const registryData = paper.data?.registryData?.toString();
            if (!registryData) continue;

            for (const tagId of paper.tags || []) {
                const key = `${registryData}:${tagId.toString()}`;
                if (!papersByRegistryAndTag.has(key)) {
                    papersByRegistryAndTag.set(key, []);
                }
                papersByRegistryAndTag.get(key)!.push(paper);
            }
        }

        // Delete duplicates (same registryData + same tag)
        for (const [key, papersInGroup] of papersByRegistryAndTag) {
            if (papersInGroup.length > 1) {
                const [registryId, tagId] = key.split(':');
                console.log(
                    `\n  Found ${papersInGroup.length} papers with registryData=${registryId} in tag=${tagId}`,
                );

                // Sort by createdAt, keep the oldest one
                papersInGroup.sort(
                    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                );

                const keep = papersInGroup[0];
                const toDelete = papersInGroup.slice(1);

                console.log(`    Keeping paper ${keep._id} (created: ${keep.createdAt})`);

                for (const dup of toDelete) {
                    console.log(`    Deleting duplicate ${dup._id} (created: ${dup.createdAt})`);
                    await papersCollection.deleteOne({ _id: dup._id });
                    deleted++;
                }
            }
        }

        console.log('\n--- Migration Complete ---');
        console.log(`\nSummary:`);
        console.log(`  Already correct: ${alreadyCorrect}`);
        console.log(`  Fixed: ${fixed}`);
        console.log(`  No matching registry: ${noMatchingRegistry}`);
        console.log(`  Duplicates deleted: ${deleted}`);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
        console.log('\nDatabase connection closed');
    }
}

migrate().catch(console.error);
