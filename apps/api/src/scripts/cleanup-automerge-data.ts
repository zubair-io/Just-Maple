/**
 * Cleanup script to remove corrupted automergeDoc data
 * Run this if you have notes with invalid Automerge binaries
 *
 * Usage:
 *   bun run apps/api/src/scripts/cleanup-automerge-data.ts
 */

import { getDB } from '../db';

async function cleanupAutomergeData() {
    console.log('[Cleanup] Starting automergeDoc cleanup...');

    const db = await getDB();
    const notesCollection = db.collection('notes');

    // Find all notes with automergeDoc
    const notesWithAutomerge = await notesCollection
        .find({ automergeDoc: { $exists: true, $ne: null } })
        .toArray();

    console.log(`[Cleanup] Found ${notesWithAutomerge.length} notes with automergeDoc data`);

    let cleanedCount = 0;

    for (const note of notesWithAutomerge) {
        const noteId = note._id.toString();

        // Check if automergeDoc looks invalid
        // Valid Automerge docs should have specific magic bytes at the start
        const automergeDoc = note.automergeDoc;

        // If it's a Buffer, check the first few bytes
        if (automergeDoc && automergeDoc.buffer) {
            const bytes = Buffer.from(automergeDoc.buffer);

            // Automerge documents start with specific magic bytes
            // If the data doesn't start correctly, it's likely corrupted
            const isLikelyCorrupted =
                bytes.length < 10 || // Too small
                (bytes[0] !== 0x85 && bytes[0] !== 0x84); // Doesn't start with Automerge magic bytes

            if (isLikelyCorrupted) {
                console.log(`[Cleanup] Removing corrupted automergeDoc from note ${noteId}`);

                await notesCollection.updateOne(
                    { _id: note._id },
                    {
                        $unset: {
                            automergeDoc: '',
                            version: '',
                            lastSyncedHeads: '',
                        },
                    },
                );

                cleanedCount++;
            } else {
                console.log(
                    `[Cleanup] Note ${noteId} has valid automergeDoc (${bytes.length} bytes)`,
                );
            }
        } else {
            // No valid buffer - remove it
            console.log(`[Cleanup] Removing invalid automergeDoc from note ${noteId}`);

            await notesCollection.updateOne(
                { _id: note._id },
                {
                    $unset: {
                        automergeDoc: '',
                        version: '',
                        lastSyncedHeads: '',
                    },
                },
            );

            cleanedCount++;
        }
    }

    console.log(`[Cleanup] Cleaned ${cleanedCount} notes`);
    console.log('[Cleanup] Done! Notes will be migrated on next open.');

    process.exit(0);
}

cleanupAutomergeData().catch((error) => {
    console.error('[Cleanup] Error:', error);
    process.exit(1);
});
