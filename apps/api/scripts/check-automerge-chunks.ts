import { MongoClient } from 'mongodb';

const mongoUri = 'mongodb://192.168.0.244:27017/justmaple';

async function checkCollection() {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        const db = client.db();
        const collection = db.collection('automerge_chunks');

        console.log('Checking automerge_chunks collection...');

        const count = await collection.countDocuments();
        console.log(`Total documents: ${count}`);

        if (count > 0) {
            const docs = await collection.find().limit(10).toArray();
            console.log('\nSample documents:');
            docs.forEach((doc, i) => {
                console.log(`\n${i + 1}.`, {
                    documentId: doc.documentId,
                    storageKey: doc.storageKey,
                    storageKeyType: typeof doc.storageKey,
                    isArray: Array.isArray(doc.storageKey),
                });
            });

            console.log('\n--- Dropping collection ---');
            await collection.drop();
            console.log('Collection dropped');
        } else {
            console.log('Collection is empty');
        }

        console.log('\nIndexes:');
        const indexes = await collection.listIndexes().toArray();
        indexes.forEach((idx) => {
            console.log('-', idx.name, JSON.stringify(idx.key));
        });
    } catch (error: any) {
        console.error('Error:', error.message);
    } finally {
        await client.close();
    }
}

checkCollection();
