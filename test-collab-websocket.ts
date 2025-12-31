import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

const ACCESS_TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTU0NzdjMzVmYTM5YTA1OGFkOGU4MGIiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJleHAiOjE3NjgzNTMzNTUsImlhdCI6MTc2NzE0Mzc1NX0.ooVGauNafcYdHRP9kIZaeZd092ngLE4tcESwG4Cdbcc';

// First, create a test note
async function createTestNote(): Promise<string> {
    const response = await fetch('http://localhost:7071/api/notes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
            title: 'Collab Test Note',
            tagIds: [],
            type: 'write',
        }),
    });

    const data = await response.json();
    console.log('Created test note:', data.note._id);
    return data.note._id;
}

async function testCollabWebSocket(noteId: string) {
    console.log(`\n=== Testing Collaboration WebSocket for note ${noteId} ===\n`);

    const wsUrl = `ws://localhost:7071/ws/collab/${noteId}?token=${ACCESS_TOKEN}`;
    const ws = new WebSocket(wsUrl);

    // Create Y.js document
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');

    ws.on('open', () => {
        console.log('✓ WebSocket connected');

        // Send Sync Step 1 (state vector)
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeSyncStep1(encoder, ydoc);
        const syncStep1 = encoding.toUint8Array(encoder);

        console.log(
            `Sending Sync Step 1 (${syncStep1.length} bytes):`,
            Array.from(syncStep1.slice(0, 20)),
        );
        ws.send(syncStep1);

        // Type some text to trigger an update
        setTimeout(() => {
            console.log('\nTyping text to trigger Y.js update...');
            ytext.insert(0, 'Hello from collaboration test!');
        }, 1000);
    });

    ws.on('message', (data: Buffer) => {
        console.log(`\n← Received message (${data.length} bytes):`, Array.from(data.slice(0, 30)));

        try {
            const decoder = decoding.createDecoder(data);
            const messageType = decoding.readVarUint(decoder);

            console.log(`  Message type: ${messageType} (0=sync, 1=awareness)`);

            if (messageType === 0) {
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, 0); // messageSync
                syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);

                // If encoder has content, send response
                if (encoding.length(encoder) > 1) {
                    const response = encoding.toUint8Array(encoder);
                    console.log(`  → Sending sync response (${response.length} bytes)`);
                    ws.send(response);
                }
            }
        } catch (error) {
            console.error('✗ Error decoding message:', error);
            console.error('  Message bytes:', Array.from(data));
        }
    });

    // Listen for Y.js updates
    ydoc.on('update', (update: Uint8Array) => {
        console.log(`\nY.js local update (${update.length} bytes)`);

        // Broadcast update
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);

        console.log(
            `→ Broadcasting update (${message.length} bytes):`,
            Array.from(message.slice(0, 30)),
        );
        ws.send(message);
    });

    ws.on('error', (error) => {
        console.error('✗ WebSocket error:', error);
    });

    ws.on('close', () => {
        console.log('\nWebSocket closed');
        process.exit(0);
    });

    // Keep alive for 10 seconds
    setTimeout(() => {
        console.log('\nTest complete, closing...');
        ws.close();
    }, 10000);
}

// Run the test
createTestNote()
    .then((noteId) => testCollabWebSocket(noteId))
    .catch((error) => {
        console.error('Test failed:', error);
        process.exit(1);
    });
