import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { findNoteByIdForCollab, updateNoteForCollab } from '../repositories/note.repo';
import type { NoteContent } from '@maple/shared';
import { collabRealtimeService } from './collab-realtime.service';

// Initialize Wasm once at module load
await Automerge.initializeBase64Wasm(automergeWasmBase64);

/**
 * Automerge service - handles CRDT-based collaboration for notes
 * Replaces OT-based collaboration with conflict-free automatic merging
 */
class AutomergeService {
    private documents = new Map<string, Automerge.Doc<any>>();
    private syncStates = new Map<string, Map<string, Automerge.SyncState>>();

    /**
     * Load document from MongoDB, migrate if needed
     * Returns the document and its URL
     */
    async getDocumentWithUrl(noteId: string): Promise<{ doc: Automerge.Doc<any>; url: string }> {
        // Check in-memory cache
        let doc = this.documents.get(noteId);

        // Load from database
        const note = await findNoteByIdForCollab(noteId, 'AutomergeService');
        if (!note) throw new Error('Note not found');

        let automergeUrl = note.automergeUrl;

        if (!doc) {
            if (note.automergeDoc) {
                // Load from binary
                doc = Automerge.load(note.automergeDoc as Uint8Array);
            } else {
                // MIGRATE: Convert ProseMirror JSON to Automerge
                doc = this.migrateFromProseMirror(note.content);

                // Save migration to DB immediately (not in background)
                // This ensures all clients get the same document binary
                const binary = Automerge.save(doc);
                await updateNoteForCollab(
                    noteId,
                    { automergeDoc: binary as Buffer },
                    'AutomergeService',
                );
            }

            this.documents.set(noteId, doc);
        }

        return { doc, url: automergeUrl || '' };
    }

    /**
     * Load document from MongoDB, migrate if needed
     */
    async getDocument(noteId: string): Promise<Automerge.Doc<any>> {
        const { doc } = await this.getDocumentWithUrl(noteId);
        return doc;
    }

    /**
     * Receive sync message from client
     */
    async receiveSyncMessage(
        noteId: string,
        clientID: string,
        message: Uint8Array,
        documentId?: string,
    ): Promise<Uint8Array> {
        const doc = await this.getDocument(noteId);
        const syncState = this.getSyncState(noteId, clientID);

        // Apply sync message (automatic CRDT merge)
        const [newDoc, newSyncState] = Automerge.receiveSyncMessage(doc, syncState, message);

        // Check if document actually changed
        const docChanged = !Automerge.equals(doc, newDoc);

        // Update in-memory state
        this.documents.set(noteId, newDoc);
        this.syncStates.get(noteId)!.set(clientID, newSyncState);

        // Persist to MongoDB only if document changed (background)
        if (docChanged) {
            this.persistDocument(noteId, newDoc).catch(console.error);
        }

        // Generate response message
        const [updatedSyncState, responseMessage] = Automerge.generateSyncMessage(
            newDoc,
            newSyncState,
        );

        // Update sync state after generating message
        this.syncStates.get(noteId)!.set(clientID, updatedSyncState);

        // If document changed, broadcast the CHANGE (incoming message) to other clients
        // We forward the operations so other clients can apply them
        if (docChanged) {
            this.broadcastSyncMessage(noteId, clientID, message, documentId);
        }

        // Return the response to the sender (Ack/Sync)
        // We removed the early return so the sender gets the acknowledgement
        if (responseMessage && responseMessage.length > 0) {
            return responseMessage;
        }

        // If document didn't change, send response to sender for sync protocol
        // (this is for initial sync or acknowledgments)
        if (responseMessage && responseMessage.length > 0) {
            return responseMessage;
        }

        return new Uint8Array();
    }

    /**
     * Persist document to MongoDB with dual storage
     */
    private async persistDocument(noteId: string, doc: Automerge.Doc<any>): Promise<void> {
        const binary = Automerge.save(doc);

        // Export ProseMirror JSON for search indexing
        const prosemirrorJSON = this.exportToProseMirror(doc);

        // Hash heads for cache validation
        const heads = Automerge.getHeads(doc);
        const version = this.hashHeads(heads);

        await updateNoteForCollab(
            noteId,
            {
                automergeDoc: binary as Buffer,
                content: prosemirrorJSON, // Keep in sync for search
                lastSyncedHeads: heads,
                version: version,
            },
            'AutomergeService',
        );
    }

    /**
     * Migrate ProseMirror JSON to Automerge document
     */
    private migrateFromProseMirror(content: NoteContent): Automerge.Doc<any> {
        const doc = Automerge.from({
            content: this.convertProseMirrorToAutomergeFormat(content),
        });
        return doc;
    }

    /**
     * Convert ProseMirror JSON to Automerge-compatible format
     * NOTE: This is a simplified conversion - full implementation would use SchemaAdapter
     */
    private convertProseMirrorToAutomergeFormat(content: NoteContent): any {
        // For now, store ProseMirror JSON directly
        // In a full implementation, this would convert to Automerge block structure
        return JSON.parse(JSON.stringify(content));
    }

    /**
     * Export Automerge document back to ProseMirror JSON format
     */
    private exportToProseMirror(doc: Automerge.Doc<any>): NoteContent {
        // Extract content from Automerge doc
        // In full implementation, this would use SchemaAdapter's export
        if (doc.content) {
            return doc.content as NoteContent;
        }

        // Fallback to empty document
        return {
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
        };
    }

    /**
     * Get or initialize sync state for a client
     */
    private getSyncState(noteId: string, clientID: string): Automerge.SyncState {
        if (!this.syncStates.has(noteId)) {
            this.syncStates.set(noteId, new Map());
        }

        const clientStates = this.syncStates.get(noteId)!;
        if (!clientStates.has(clientID)) {
            clientStates.set(clientID, Automerge.initSyncState());
        }

        return clientStates.get(clientID)!;
    }

    /**
     * Hash Automerge heads for version tracking
     */
    private hashHeads(heads: string[]): number {
        // Simple hash for cache validation
        return heads
            .join(',')
            .split('')
            .reduce((a, b) => {
                a = (a << 5) - a + b.charCodeAt(0);
                return a & a;
            }, 0);
    }

    /**
     * Broadcast sync message to other clients
     */
    private broadcastSyncMessage(
        noteId: string,
        senderClientID: string,
        message: Uint8Array,
        documentId?: string,
    ): void {
        const broadcastMessage: any = {
            type: 'automerge-sync',
            noteId,
            syncMessage: Buffer.from(message).toString('base64'),
            isBroadcast: true, // Flag to indicate this is a one-way broadcast
        };

        // Include documentId if provided
        if (documentId) {
            broadcastMessage.documentId = documentId;
        }

        // Use existing collab realtime service (works with both WebSocket and SignalR)
        collabRealtimeService.broadcast(noteId, broadcastMessage, senderClientID);
    }

    /**
     * Clean up sync state for a disconnected client
     */
    cleanupClientState(noteId: string, clientID: string): void {
        const clientStates = this.syncStates.get(noteId);
        if (clientStates) {
            clientStates.delete(clientID);
        }
    }

    /**
     * Clean up document from memory when no clients are connected
     */
    cleanupDocument(noteId: string): void {
        this.documents.delete(noteId);
        this.syncStates.delete(noteId);
    }
}

export const automergeService = new AutomergeService();
