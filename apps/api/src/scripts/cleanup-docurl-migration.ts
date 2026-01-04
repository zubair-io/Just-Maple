import { connectToDatabase, closeDatabase } from '../db/client';

/**
 * Extract docUrl from automergeUrl by removing the "automerge:" prefix
 */
function extractDocUrl(automergeUrl: string): string {
    return automergeUrl.replace(/^automerge:/, '');
}

async function cleanupDocUrls() {
    try {
        console.log('[Cleanup] Connecting to database...');
        const db = await connectToDatabase();
        const collection = db.collection('notes');

        // 1. Remove docUrl from notes without automergeUrl
        const notesWithoutAutomerge = await collection
            .find({
                docUrl: { $exists: true },
                automergeUrl: { $exists: false },
            })
            .toArray();

        console.log(
            `[Cleanup] Found ${notesWithoutAutomerge.length} notes with docUrl but no automergeUrl`,
        );

        let removedCount = 0;
        for (const note of notesWithoutAutomerge) {
            await collection.updateOne({ _id: note._id }, { $unset: { docUrl: '' } });
            console.log(`[Cleanup] Removed docUrl from note ${note._id}`);
            removedCount++;
        }

        // 2. Fix docUrl for notes with automergeUrl
        const notesWithAutomerge = await collection
            .find({
                automergeUrl: { $exists: true },
            })
            .toArray();

        console.log(`\n[Cleanup] Found ${notesWithAutomerge.length} notes with automergeUrl`);

        let fixedCount = 0;
        for (const note of notesWithAutomerge) {
            const correctDocUrl = extractDocUrl(note.automergeUrl);

            // Only update if docUrl is missing or incorrect
            if (!note.docUrl || note.docUrl !== correctDocUrl) {
                await collection.updateOne({ _id: note._id }, { $set: { docUrl: correctDocUrl } });
                console.log(`[Cleanup] Fixed docUrl for note ${note._id}: ${correctDocUrl}`);
                fixedCount++;
            }
        }

        console.log('\n[Cleanup] Complete!');
        console.log(`[Cleanup] Removed docUrl from ${removedCount} notes without automergeUrl`);
        console.log(`[Cleanup] Fixed docUrl for ${fixedCount} notes with automergeUrl`);

        await closeDatabase();
        process.exit(0);
    } catch (error) {
        console.error('[Cleanup] Fatal error:', error);
        await closeDatabase();
        process.exit(1);
    }
}

// Run cleanup
cleanupDocUrls();
