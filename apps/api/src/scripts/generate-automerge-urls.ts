import { connectToDatabase, closeDatabase } from '../db/client';
import { customAlphabet } from 'nanoid';

/**
 * Generate a unique docUrl for routing
 * Uses base58 alphabet (compatible with Automerge URLs)
 * Excludes: 0, O, I, l (to avoid confusion)
 */
const nanoidBase58 = customAlphabet(
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
    32,
);

function generateDocUrl(): string {
    return nanoidBase58();
}

async function generateDocUrls() {
    try {
        console.log('[Generate] Connecting to database...');
        const db = await connectToDatabase();
        const collection = db.collection('notes');

        // Find all notes without docUrl
        const notes = await collection
            .find({
                docUrl: { $exists: false },
            })
            .toArray();

        console.log(`[Generate] Found ${notes.length} notes without docUrl`);

        if (notes.length === 0) {
            console.log('[Generate] No notes to process. All notes have docUrl.');
            await closeDatabase();
            process.exit(0);
        }

        let updated = 0;
        let failed = 0;

        for (const note of notes) {
            try {
                const docUrl = generateDocUrl();

                await collection.updateOne(
                    { _id: note._id },
                    {
                        $set: { docUrl },
                    },
                );

                console.log(
                    `[Generate] Updated note ${note._id} (${note.title || 'Untitled'}) with docUrl: ${docUrl}`,
                );
                updated++;
            } catch (error) {
                console.error(`[Generate] Failed to update note ${note._id}:`, error);
                failed++;
            }
        }

        console.log('\n[Generate] Complete!');
        console.log(`[Generate] Successfully updated: ${updated} notes`);
        if (failed > 0) {
            console.log(`[Generate] Failed to update: ${failed} notes`);
        }

        await closeDatabase();
        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        console.error('[Generate] Fatal error:', error);
        await closeDatabase();
        process.exit(1);
    }
}

// Run generation
generateDocUrls();
