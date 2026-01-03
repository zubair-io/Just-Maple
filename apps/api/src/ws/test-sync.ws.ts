import { Elysia } from 'elysia';
import * as Automerge from '@automerge/automerge/slim';

/**
 * Simple test WebSocket for Automerge collaboration
 * Single shared document, no auth, for testing only
 */

// Shared document and sync states
let sharedDoc: Automerge.Doc<any> = Automerge.from({ text: '' });
const syncStates = new Map<string, Automerge.SyncState>();
const connections = new Map<string, any>();
const clientDocumentIds = new Map<string, string>();

export const testSyncWs = new Elysia().ws('/ws/test-sync', {
    open(ws) {
        const clientId = Math.random().toString(36).substring(7);
        ws.data.clientId = clientId;
        connections.set(clientId, ws);

        console.log(`[TestSync] Client connected: ${clientId}`);

        // Initialize sync state
        syncStates.set(clientId, Automerge.initSyncState());

        // Don't send initial sync - let client initiate with their documentId
    },

    message(ws, message) {
        const clientId = ws.data.clientId;
        console.log('[TestSync] message handler called for client:', clientId);
        console.log('[TestSync] message type:', typeof message);
        console.log('[TestSync] message content:', message);

        if (!clientId) {
            console.error('[TestSync] No clientId found for this connection');
            return;
        }

        try {
            // Elysia already parsed JSON, use message directly
            const data = message as any;

            console.log(`[TestSync] Received message from ${clientId}:`, {
                type: data.type,
                hasData: !!data.data,
                documentId: data.documentId,
            });

            if (data.type === 'sync' && data.data) {
                // Store documentId if this is the first message from this client
                if (data.documentId && !clientDocumentIds.has(clientId)) {
                    clientDocumentIds.set(clientId, data.documentId);
                    console.log(`[TestSync] Stored documentId for ${clientId}:`, data.documentId);
                }

                // Get the documentId for this client
                const documentId = clientDocumentIds.get(clientId);
                console.log(`[TestSync] Using documentId for ${clientId}:`, documentId);

                // Decode base64
                const binaryString = Buffer.from(data.data, 'base64');
                const syncMessage = new Uint8Array(binaryString);

                // Get sync state
                const syncState = syncStates.get(clientId) || Automerge.initSyncState();

                // Apply sync message
                const [newDoc, newSyncState] = Automerge.receiveSyncMessage(
                    sharedDoc,
                    syncState,
                    syncMessage,
                );

                // Check if document changed
                const docChanged = !Automerge.equals(sharedDoc, newDoc);

                // ALWAYS update to the new document (Automerge docs are immutable)
                sharedDoc = newDoc;

                if (docChanged) {
                    console.log('[TestSync] Document changed');
                }

                // Update sync state
                syncStates.set(clientId, newSyncState);

                // Generate response
                const [updatedSyncState, responseMessage] = Automerge.generateSyncMessage(
                    newDoc,
                    newSyncState,
                );
                syncStates.set(clientId, updatedSyncState);

                // If document changed, broadcast to other clients
                if (docChanged) {
                    console.log(`[TestSync] Broadcasting to ${connections.size - 1} other clients`);
                    connections.forEach((conn, connId) => {
                        if (connId !== clientId) {
                            const targetDocId = clientDocumentIds.get(connId);
                            console.log(
                                `[TestSync] Broadcasting to ${connId} with docId:`,
                                targetDocId,
                            );

                            // Generate sync message for this specific client based on their sync state
                            const targetSyncState =
                                syncStates.get(connId) || Automerge.initSyncState();
                            const [newTargetSyncState, targetSyncMessage] =
                                Automerge.generateSyncMessage(newDoc, targetSyncState);

                            console.log(
                                `[TestSync] Generated message for ${connId}: ${targetSyncMessage?.length || 0} bytes`,
                            );

                            if (targetSyncMessage && targetSyncMessage.length > 0) {
                                syncStates.set(connId, newTargetSyncState);
                                conn.send(
                                    JSON.stringify({
                                        type: 'sync',
                                        data: Buffer.from(targetSyncMessage).toString('base64'),
                                        documentId: targetDocId,
                                    }),
                                );
                                console.log(`[TestSync] Sent broadcast to ${connId}`);
                            }
                        }
                    });
                }

                // Send response to sender
                if (responseMessage && responseMessage.length > 0) {
                    console.log(
                        `[TestSync] Sending response to ${clientId}: ${responseMessage.length} bytes`,
                    );
                    ws.send(
                        JSON.stringify({
                            type: 'sync',
                            data: Buffer.from(responseMessage).toString('base64'),
                            documentId, // Echo back the sender's documentId
                        }),
                    );
                } else {
                    console.log(`[TestSync] No response needed for ${clientId}`);
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
            console.log(`[TestSync] Client disconnected: ${clientId}`);
        }
    },
});
