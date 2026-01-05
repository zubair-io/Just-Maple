import { connectToDatabase, getDb } from '../db/client';
import { customAlphabet } from 'nanoid';

const nanoidBase58 = customAlphabet(
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
    32,
);

function isValidBase58(str: string): boolean {
    const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    return base58Regex.test(str);
}

async function fixInvalidDocUrls() {
    await connectToDatabase();
    const db = getDb();
    const collection = db.collection('notes');

    // Find all notes
    const notes = await collection.find({}).toArray();

    console.log(`Found ${notes.length} total notes`);

    let fixedCount = 0;
    let alreadyValidCount = 0;
    let missingCount = 0;

    for (const note of notes) {
        if (!note.docUrl) {
            // Missing docUrl - generate new one
            const newDocUrl = nanoidBase58();
            await collection.updateOne({ _id: note._id }, { $set: { docUrl: newDocUrl } });
            console.log(`Added missing docUrl for note ${note._id}: ${newDocUrl}`);
            missingCount++;
        } else if (!isValidBase58(note.docUrl)) {
            // Invalid docUrl - regenerate
            const newDocUrl = nanoidBase58();
            await collection.updateOne({ _id: note._id }, { $set: { docUrl: newDocUrl } });
            console.log(
                `Fixed invalid docUrl for note ${note._id}: ${note.docUrl} -> ${newDocUrl}`,
            );
            fixedCount++;
        } else {
            alreadyValidCount++;
        }
    }

    console.log('\nMigration complete!');
    console.log(`- Already valid: ${alreadyValidCount}`);
    console.log(`- Fixed invalid: ${fixedCount}`);
    console.log(`- Added missing: ${missingCount}`);

    process.exit(0);
}

fixInvalidDocUrls().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
