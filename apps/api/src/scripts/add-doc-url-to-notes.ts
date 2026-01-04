import { connectToDatabase, closeDatabase } from '../db/client';

/**
 * Extract docUrl from automergeUrl by removing the "automerge:" prefix
 * @param automergeUrl - Full Automerge URL (e.g., "automerge:abc123")
 * @returns URL-safe identifier without prefix (e.g., "abc123")
 */
function extractDocUrl(automergeUrl: string): string {
    return automergeUrl.replace(/^automerge:/, '');
}

async function migrateNotes() {
    try {
        console.log('[Migration] Connecting to database...');
        const db = await connectToDatabase();
        const collection = db.collection('notes');

        // Find all notes that have automergeUrl but no docUrl
        const notes = await collection
            .find({
                automergeUrl: { $exists: true },
                docUrl: { $exists: false },
            })
            .toArray();

        console.log(`[Migration] Found ${notes.length} notes with automergeUrl but no docUrl`);

        if (notes.length === 0) {
            console.log(
                '[Migration] No notes to migrate. All notes with automergeUrl already have docUrl.',
            );
            await closeDatabase();
            process.exit(0);
        }

        let updated = 0;
        let failed = 0;

        for (const note of notes) {
            try {
                const docUrl = extractDocUrl(note.automergeUrl);

                await collection.updateOne({ _id: note._id }, { $set: { docUrl } });

                console.log(`[Migration] Updated note ${note._id} with docUrl: ${docUrl}`);
                updated++;
            } catch (error) {
                console.error(`[Migration] Failed to update note ${note._id}:`, error);
                failed++;
            }
        }

        console.log('\n[Migration] Complete!');
        console.log(`[Migration] Successfully updated: ${updated} notes`);
        if (failed > 0) {
            console.log(`[Migration] Failed to update: ${failed} notes`);
        }

        await closeDatabase();
        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        console.error('[Migration] Fatal error:', error);
        await closeDatabase();
        process.exit(1);
    }
}

// Run migration
migrateNotes();
