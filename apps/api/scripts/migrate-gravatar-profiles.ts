/**
 * One-time migration script to fetch Gravatar data for existing users
 *
 * This script:
 * 1. Finds all users without profile pictures
 * 2. Fetches their Gravatar profile data (displayName, profilePictureUrl)
 * 3. Updates users with the fetched data
 *
 * Run with: bun run scripts/migrate-gravatar-profiles.ts
 */

import { MongoClient } from 'mongodb';
import { fetchGravatarProfile, getGravatarUrl } from '../src/services/gravatar.service';

// Get MongoDB URI from environment or use default
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple';

interface UserDocument {
    _id: any;
    email: string;
    displayName?: string;
    profilePictureUrl?: string;
    createdAt: Date;
    updatedAt: Date;
}

async function migrateGravatarProfiles() {
    console.log('🔍 Starting Gravatar profile migration...\n');

    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB\n');

        const db = client.db();
        const usersCollection = db.collection<UserDocument>('users');

        // Find all users without profile pictures
        const usersWithoutPictures = await usersCollection
            .find({
                $or: [{ profilePictureUrl: { $exists: false } }, { profilePictureUrl: null }],
            })
            .toArray();

        console.log(`📊 Found ${usersWithoutPictures.length} users without profile pictures\n`);

        if (usersWithoutPictures.length === 0) {
            console.log('✅ No users to migrate. All users already have profile pictures.');
            return;
        }

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const user of usersWithoutPictures) {
            try {
                console.log(`Processing: ${user.email}`);

                // Fetch Gravatar profile data
                const gravatarProfile = await fetchGravatarProfile(user.email);

                // Determine what to update
                const updates: Partial<UserDocument> = {
                    updatedAt: new Date(),
                };

                // Update display name only if user doesn't have one and Gravatar has one
                if (!user.displayName && gravatarProfile.displayName) {
                    updates.displayName = gravatarProfile.displayName;
                    console.log(`  ✓ Display name: ${gravatarProfile.displayName}`);
                }

                // Set profile picture URL (use Gravatar thumbnail if available, otherwise generate URL)
                updates.profilePictureUrl =
                    gravatarProfile.thumbnailUrl || getGravatarUrl(user.email);
                console.log(`  ✓ Profile picture: ${updates.profilePictureUrl}`);

                // Update the user
                await usersCollection.updateOne({ _id: user._id }, { $set: updates });

                updated++;
                console.log(`  ✅ Updated\n`);
            } catch (error) {
                console.error(`  ❌ Error processing ${user.email}:`, error);
                errors++;
            }

            // Add small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log('\n📊 Migration Summary:');
        console.log(`   Total users processed: ${usersWithoutPictures.length}`);
        console.log(`   ✅ Successfully updated: ${updated}`);
        console.log(`   ⏭️  Skipped: ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);
        console.log('\n✨ Migration complete!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await client.close();
        console.log('\n👋 Disconnected from MongoDB');
    }
}

// Run the migration
migrateGravatarProfiles().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
