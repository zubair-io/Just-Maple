/**
 * Remove all todoBox nodes from a memo
 * Run with: bun scripts/remove-todobox.ts
 */
import * as Y from 'yjs';
import { MongoClient, Binary } from 'mongodb';

const NOTE_ID = 'c2f7dbb3-1232-458c-9e7e-50c5610ac04c';
const MONGODB_URI =
    'mongodb://bigleaf-maple:4mnSyj0OvQeisHaieXE5cBT40a8ON54ipsyXLAaBCWFMQrah9DPlKXCtlAqztlV5EteEHP08FlhZACDbgiYODQ==@bigleaf-maple.mongo.cosmos.azure.com:10255/justmaple?ssl=true&replicaSet=globaldb&retrywrites=false&maxIdleTimeMS=120000&appName=@bigleaf-maple@';

async function removeTodoBoxes() {
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db();
        const memos = db.collection('memos');

        // Fetch the memo
        const memo = await memos.findOne({ noteId: NOTE_ID });
        if (!memo) {
            console.error('Memo not found with noteId:', NOTE_ID);
            return;
        }

        console.log('Found memo, version:', memo.version);

        // Get the state as Uint8Array
        let bytes: Uint8Array;
        if (memo.state instanceof Binary) {
            bytes = new Uint8Array(memo.state.buffer);
        } else if (Buffer.isBuffer(memo.state)) {
            bytes = new Uint8Array(memo.state);
        } else {
            console.error('Unknown state format');
            return;
        }

        console.log('State size:', bytes.length, 'bytes');

        // Create Y.Doc and apply the state
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, bytes);
        console.log('Applied Y.js update');

        // Get the prosemirror content
        const prosemirror = ydoc.getXmlFragment('prosemirror');

        // Find all todoBox nodes
        const toRemove: number[] = [];
        let idx = 0;

        console.log('\n--- Scanning for todoBox nodes ---');
        prosemirror.forEach((child) => {
            if (child instanceof Y.XmlElement) {
                const nodeName = child.nodeName;
                console.log(`[${idx}] ${nodeName}`);
                if (nodeName === 'todobox' || nodeName === 'todoBox') {
                    toRemove.push(idx);
                    console.log(`  ^ Found todoBox to remove`);
                }
            }
            idx++;
        });

        if (toRemove.length === 0) {
            console.log('\nNo todoBox nodes found!');
            return;
        }

        console.log(`\nRemoving ${toRemove.length} todoBox node(s)...`);

        // Remove in reverse order to maintain correct indices
        ydoc.transact(() => {
            for (let i = toRemove.length - 1; i >= 0; i--) {
                prosemirror.delete(toRemove[i], 1);
                console.log('Removed element at index', toRemove[i]);
            }
        });

        // Encode the fixed state
        const fixedState = Y.encodeStateAsUpdate(ydoc);
        console.log('\nFixed state:', fixedState.length, 'bytes');

        // Save back to MongoDB
        const result = await memos.updateOne(
            { noteId: NOTE_ID },
            {
                $set: {
                    state: new Binary(Buffer.from(fixedState)),
                    updatedAt: new Date(),
                },
                $inc: { version: 1 },
            },
        );

        if (result.modifiedCount === 1) {
            console.log('\n✅ Memo updated successfully!');
            console.log('   Refresh the page in your browser.');
        } else {
            console.log('\n❌ Failed to update memo');
        }
    } finally {
        await client.close();
        console.log('\nMongoDB connection closed.');
    }
}

removeTodoBoxes();
