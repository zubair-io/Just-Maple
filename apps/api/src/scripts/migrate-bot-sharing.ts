import { ObjectId } from 'mongodb';
import { getDb } from '../db/client';

/**
 * Migration script to move bot sharing from UserBot.tagId to Tag.sharing.sharedBots
 *
 * This script:
 * 1. Finds all user bots with a tagId
 * 2. Adds those bots to the corresponding tag's sharing.sharedBots array
 * 3. Removes the tagId field from all user bots
 *
 * Run with: bun run src/scripts/migrate-bot-sharing.ts
 */

async function migrateBotSharing() {
    console.log('[Migration] Starting bot sharing migration...');

    const db = getDb();
    const userBotsCollection = db.collection('user_bots');
    const tagsCollection = db.collection('tags');

    // Find all user bots with tagId
    const userBotsWithTag = await userBotsCollection
        .find({ tagId: { $exists: true, $ne: null } })
        .toArray();

    console.log(`[Migration] Found ${userBotsWithTag.length} bots with tagId`);

    // Group bots by tagId
    const botsByTag = new Map<string, string[]>();
    for (const bot of userBotsWithTag) {
        const tagId = bot.tagId.toString();
        if (!botsByTag.has(tagId)) {
            botsByTag.set(tagId, []);
        }
        botsByTag.get(tagId)!.push(bot._id.toString());
    }

    console.log(`[Migration] Updating ${botsByTag.size} tags...`);

    // Update each tag with its bots
    let tagsUpdated = 0;
    for (const [tagId, botIds] of botsByTag.entries()) {
        try {
            const result = await tagsCollection.updateOne(
                { _id: new ObjectId(tagId) },
                {
                    $set: {
                        'sharing.sharedBots': botIds.map((id) => ({ userBotId: id })),
                        updatedAt: new Date(),
                    },
                },
            );

            if (result.modifiedCount > 0) {
                tagsUpdated++;
                console.log(`[Migration] Updated tag ${tagId} with ${botIds.length} bot(s)`);
            } else {
                console.warn(`[Migration] Tag ${tagId} not found or not updated`);
            }
        } catch (error) {
            console.error(`[Migration] Failed to update tag ${tagId}:`, error);
        }
    }

    console.log(`[Migration] Successfully updated ${tagsUpdated} tags`);

    // Remove tagId field from all user bots
    console.log('[Migration] Removing tagId field from all user bots...');
    const removeResult = await userBotsCollection.updateMany({}, { $unset: { tagId: '' } });

    console.log(`[Migration] Removed tagId from ${removeResult.modifiedCount} user bots`);

    console.log('[Migration] Bot sharing migration complete!');
}

// Run migration
migrateBotSharing()
    .then(() => {
        console.log('[Migration] Done');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Migration] Error:', error);
        process.exit(1);
    });
