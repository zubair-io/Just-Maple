import { connectToDatabase, getDb } from '../db/client';

async function checkDocUrlEqualsId() {
    await connectToDatabase();
    const db = getDb();
    const collection = db.collection('notes');

    // Find all notes
    const notes = await collection.find({}).toArray();

    console.log(`Checking ${notes.length} notes...`);

    let matchCount = 0;

    for (const note of notes) {
        if (note.docUrl === note._id.toString()) {
            console.log(`Found match: _id=${note._id}, docUrl=${note.docUrl}`);
            matchCount++;
        }
    }

    console.log(`\nTotal notes where docUrl === _id: ${matchCount}`);

    process.exit(0);
}

checkDocUrlEqualsId().catch((error) => {
    console.error('Check failed:', error);
    process.exit(1);
});
