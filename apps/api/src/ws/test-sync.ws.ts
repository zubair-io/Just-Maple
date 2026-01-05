import { Elysia, type Context } from 'elysia';
import * as Automerge from '@automerge/automerge/slim';
import { jwtPlugin } from '../middleware/auth';
import {
    updateNoteForCollab,
    findNoteByIdForCollab,
    findNoteByDocumentId,
} from '../repositories/note.repo';
import { authenticateWebSocket } from './ws-auth';

/**
 * WebSocket for Automerge collaboration
 * Requires JWT authentication
 */

// Documents per documentId, sync states per client, connections, and client->documentId mapping
const documents = new Map<string, Automerge.Doc<any>>();
const syncStates = new Map<string, Automerge.SyncState>();
const connections = new Map<string, any>();
const clientDocumentIds = new Map<string, string>();
const clientUserIds = new Map<string, string>(); // Track which user owns each client
const documentUserIds = new Map<string, string>(); // Track userId per documentId for saving
const saveTimeouts = new Map<string, NodeJS.Timeout>(); // Debounce saves per documentId

/**
 * Save document to database (debounced)
 */
function scheduleSaveToDatabase(documentId: string, doc: Automerge.Doc<any>) {
    // Clear existing timeout
    const existingTimeout = saveTimeouts.get(documentId);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    // Schedule save after 2 seconds of no changes
    const timeout = setTimeout(async () => {
        try {
            console.log(`[TestSync] Attempting to save document with documentId: ${documentId}`);

            // Get the userId associated with this document
            const userId = documentUserIds.get(documentId);
            if (!userId) {
                console.error(
                    `[TestSync] No userId found for documentId: ${documentId}. Cannot save.`,
                );
                return;
            }

            // Find the note by documentId
            const note = await findNoteByDocumentId(documentId, userId);

            if (!note) {
                console.error(`[TestSync] Note not found for documentId: ${documentId}`);
                console.log(
                    `[TestSync] This likely means the document wasn't created in the database yet`,
                );
                return;
            }

            console.log(`[TestSync] Found note ${note._id} for documentId: ${documentId}`);

            const binaryDoc = Automerge.save(doc);
            const docArray = Array.from(binaryDoc);

            await updateNoteForCollab(
                note._id,
                { automergeDoc: docArray as any },
                'AutomergeService',
            );

            console.log(
                `[TestSync] Successfully saved document ${documentId} (note ${note._id}) to database`,
            );
        } catch (error) {
            console.error(`[TestSync] Failed to save document ${documentId}:`, error);
        } finally {
            saveTimeouts.delete(documentId);
        }
    }, 2000);

    saveTimeouts.set(documentId, timeout);
}

export const testSyncWs = new Elysia().use(jwtPlugin).ws('/ws/test-sync', {
    async open(ws) {
        // Authenticate user
        const auth = await authenticateWebSocket(ws);
        if (!auth) {
            return; // Connection already closed by authenticateWebSocket
        }

        const clientId = Math.random().toString(36).substring(7);
        ws.data.clientId = clientId;
        ws.data.userId = auth.userId;
        connections.set(clientId, ws);
        clientUserIds.set(clientId, auth.userId);

        // Initialize sync state
        syncStates.set(clientId, Automerge.initSyncState());

        console.log(`[TestSync] Client ${clientId} connected (user: ${auth.email})`);
    },

    message(ws, message) {
        const clientId = ws.data.clientId;
        console.log('Received message:', message, 'from clientId:', clientId);

        if (!clientId) {
            console.error('[TestSync] No clientId found for this connection');
            return;
        }

        console.log(
            `[TestSync] Received message from client ${clientId}, type:`,
            (message as any)?.type,
        );

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
                    // Store userId for this documentId (for saving to database)
                    const userId = clientUserIds.get(clientId);
                    if (userId && !documentUserIds.has(data.documentId)) {
                        documentUserIds.set(data.documentId, userId);
                    }
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

                // If document changed, save to database and broadcast to other clients
                if (docChanged) {
                    console.log(
                        `[TestSync] Document ${documentId} changed, scheduling save to database`,
                    );
                    // Schedule database save (debounced)
                    scheduleSaveToDatabase(documentId, doc);

                    // Broadcast to other clients with the SAME documentId
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
            clientUserIds.delete(clientId);
            console.log(`[TestSync] Client ${clientId} disconnected`);
        }
    },
});
