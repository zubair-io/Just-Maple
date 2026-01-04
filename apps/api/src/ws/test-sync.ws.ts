import { Elysia } from 'elysia';
import * as Automerge from '@automerge/automerge/slim';

/**
 * Simple test WebSocket for Automerge collaboration
 * Single shared document, no auth, for testing only
 */

// Documents per documentId, sync states per client, connections, and client->documentId mapping
const documents = new Map<string, Automerge.Doc<any>>();
const syncStates = new Map<string, Automerge.SyncState>();
const connections = new Map<string, any>();
const clientDocumentIds = new Map<string, string>();

export const testSyncWs = new Elysia().ws('/ws/test-sync', {
    open(ws) {
        const clientId = Math.random().toString(36).substring(7);
        ws.data.clientId = clientId;
        connections.set(clientId, ws);

        // Initialize sync state
        syncStates.set(clientId, Automerge.initSyncState());
    },

    message(ws, message) {
        const clientId = ws.data.clientId;

        if (!clientId) {
            console.error('[TestSync] No clientId found for this connection');
            return;
        }

        try {
            // Elysia already parsed JSON, use message directly
            const data = message as any;

            if (data.type === 'ephemeral' && data.documentId) {
                const documentId = data.documentId;
                // Broadcast to other clients with the same documentId
                const sameDocClients = Array.from(clientDocumentIds.entries())
                    .filter(([id, docId]) => docId === documentId && id !== clientId)
                    .map(([id]) => id);

                sameDocClients.forEach((connId) => {
                    const conn = connections.get(connId);
                    if (conn) {
                        conn.send(JSON.stringify(data));
                    }
                });
                return;
            }

            if (data.type === 'sync' && data.data) {
                // Store documentId if this is the first message from this client
                if (data.documentId && !clientDocumentIds.has(clientId)) {
                    clientDocumentIds.set(clientId, data.documentId);
                }

                // Get the documentId for this client
                const documentId = clientDocumentIds.get(clientId);

                if (!documentId) {
                    console.error(`[TestSync] No documentId for client ${clientId}`);
                    return;
                }

                // Get or create document for this documentId
                if (!documents.has(documentId)) {
                    documents.set(documentId, Automerge.from({ text: '' }));
                }

                let doc = documents.get(documentId)!;

                // Decode base64
                const binaryString = Buffer.from(data.data, 'base64');
                const syncMessage = new Uint8Array(binaryString);

                // Get sync state
                const syncState = syncStates.get(clientId) || Automerge.initSyncState();

                // Apply sync message
                const [newDoc, newSyncState] = Automerge.receiveSyncMessage(
                    doc,
                    syncState,
                    syncMessage,
                );

                // Check if document changed
                const docChanged = !Automerge.equals(doc, newDoc);

                // ALWAYS update to the new document (Automerge docs are immutable)
                documents.set(documentId, newDoc);
                doc = newDoc;

                // Update sync state
                syncStates.set(clientId, newSyncState);

                // Generate response
                const [updatedSyncState, responseMessage] = Automerge.generateSyncMessage(
                    doc,
                    newSyncState,
                );
                syncStates.set(clientId, updatedSyncState);

                // If document changed, broadcast to other clients with the SAME documentId
                if (docChanged) {
                    const sameDocClients = Array.from(clientDocumentIds.entries())
                        .filter(([id, docId]) => docId === documentId && id !== clientId)
                        .map(([id]) => id);

                    sameDocClients.forEach((connId) => {
                        const conn = connections.get(connId);
                        if (!conn) return;

                        // Generate sync message for this specific client based on their sync state
                        const targetSyncState = syncStates.get(connId) || Automerge.initSyncState();
                        const [newTargetSyncState, targetSyncMessage] =
                            Automerge.generateSyncMessage(doc, targetSyncState);

                        if (targetSyncMessage && targetSyncMessage.length > 0) {
                            syncStates.set(connId, newTargetSyncState);
                            conn.send(
                                JSON.stringify({
                                    type: 'sync',
                                    data: Buffer.from(targetSyncMessage).toString('base64'),
                                    documentId,
                                }),
                            );
                        }
                    });
                }

                // Send response to sender
                if (responseMessage && responseMessage.length > 0) {
                    ws.send(
                        JSON.stringify({
                            type: 'sync',
                            data: Buffer.from(responseMessage).toString('base64'),
                            documentId, // Echo back the sender's documentId
                        }),
                    );
                }
            }
        } catch (error) {
            console.error('[TestSync] Error processing message:', error);
        }
    },

    close(ws) {
        const clientId = ws.data.clientId;
        if (clientId) {
            connections.delete(clientId);
            syncStates.delete(clientId);
            clientDocumentIds.delete(clientId);
        }
    },
});
