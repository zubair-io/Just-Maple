import { connectToDatabase, closeDatabase } from '../db/client';
import { customAlphabet } from 'nanoid';

/**
 * Generate a unique docUrl for routing
 * Uses base58 alphabet (compatible with Automerge URLs)
 */
const nanoidBase58 = customAlphabet(
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
    32,
);

/**
 * Check if docUrl contains invalid characters (not base58)
 */
function isInvalidDocUrl(str: string): boolean {
    // Check if it contains characters not in base58 alphabet
    return /[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]/.test(str);
}

async function fixInvalidDocUrls() {
    try {
        console.log('[Fix] Connecting to database...');
        const db = await connectToDatabase();
        const collection = db.collection('notes');

        // Find all notes
        const notes = await collection.find({}).toArray();

        console.log(`[Fix] Checking ${notes.length} notes for invalid docUrls`);

        let fixed = 0;

        for (const note of notes) {
            // Check if docUrl is missing or contains invalid characters
            if (!note.docUrl || isInvalidDocUrl(note.docUrl)) {
                const newDocUrl = nanoidBase58();
                await collection.updateOne({ _id: note._id }, { $set: { docUrl: newDocUrl } });
                console.log(
                    `[Fix] Fixed note ${note._id} (${note.title || 'Untitled'}): ${note.docUrl || 'missing'} → ${newDocUrl}`,
                );
                fixed++;
            }
        }

        console.log(`\n[Fix] Complete! Fixed ${fixed} notes`);

        await closeDatabase();
        process.exit(0);
    } catch (error) {
        console.error('[Fix] Fatal error:', error);
        await closeDatabase();
        process.exit(1);
    }
}

fixInvalidDocUrls();
