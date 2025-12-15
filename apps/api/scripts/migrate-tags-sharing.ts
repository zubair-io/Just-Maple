/**
 * Migration script: Convert tags from userId to sharing model
 *
 * Run with: bun run scripts/migrate-tags-sharing.ts
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple';

async function migrate() {
    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db();
        const tagsCollection = db.collection('tags');

        // Find all tags with userId but no sharing field
        const legacyTags = await tagsCollection
            .find({
                userId: { $exists: true },
                sharing: { $exists: false },
            })
            .toArray();

        console.log(`Found ${legacyTags.length} tags to migrate`);

        if (legacyTags.length === 0) {
            console.log('No tags need migration');
            return;
        }

        let migrated = 0;
        let errors = 0;

        for (const tag of legacyTags) {
            try {
                const userId = tag.userId instanceof ObjectId ? tag.userId.toString() : tag.userId;

                // Update tag with sharing model
                await tagsCollection.updateOne(
                    { _id: tag._id },
                    {
                        $set: {
                            sharing: {
                                sharedWith: [
                                    {
                                        userId: userId,
                                        accessLevel: 'owner',
                                    },
                                ],
                                isPublic: false,
                            },
                            updatedAt: new Date(),
                        },
                        $unset: { userId: '' },
                    },
                );

                migrated++;
                console.log(`✓ Migrated tag: ${tag.label} (${tag._id})`);
            } catch (err) {
                errors++;
                console.error(`✗ Failed to migrate tag: ${tag.label} (${tag._id})`, err);
            }
        }

        console.log('\n--- Migration Complete ---');
        console.log(`Migrated: ${migrated}`);
        console.log(`Errors: ${errors}`);
    } finally {
        await client.close();
    }
}

migrate().catch(console.error);
