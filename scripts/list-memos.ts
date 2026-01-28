/**
 * List all memos to find the correct noteId
 */
import { MongoClient } from 'mongodb';

async function listMemos() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple';
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        const db = client.db();
        const memos = db.collection('memos');

        const allMemos = await memos.find({}).project({ noteId: 1, updatedAt: 1 }).toArray();

        console.log('All memos in database:');
        allMemos.forEach((memo, i) => {
            console.log(`  ${i + 1}. noteId: ${memo.noteId} (updated: ${memo.updatedAt})`);
        });

        console.log(`\nTotal: ${allMemos.length} memos`);
    } finally {
        await client.close();
    }
}

listMemos();
