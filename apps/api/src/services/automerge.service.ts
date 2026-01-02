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
     */
    async getDocument(noteId: string): Promise<Automerge.Doc<any>> {
        // Check in-memory cache
        let doc = this.documents.get(noteId);
        if (doc) return doc;

        // Load from database
        const note = await findNoteByIdForCollab(noteId, 'AutomergeService');
        if (!note) throw new Error('Note not found');

        if (note.automergeDoc) {
            // Load from binary
            console.log(`[Automerge Service] Loading existing document for note ${noteId}`);
            doc = Automerge.load(note.automergeDoc as Uint8Array);
        } else {
            // MIGRATE: Convert ProseMirror JSON to Automerge
            console.log(
                `[Automerge Service] Migrating note ${noteId} from ProseMirror JSON to Automerge`,
            );
            doc = this.migrateFromProseMirror(note.content);

            // Save migration to DB (background)
            const binary = Automerge.save(doc);
            updateNoteForCollab(
                noteId,
                { automergeDoc: binary as Buffer },
                'AutomergeService',
            ).catch(console.error);
        }

        this.documents.set(noteId, doc);
        return doc;
    }

    /**
     * Receive sync message from client
     */
    async receiveSyncMessage(
        noteId: string,
        clientID: string,
        message: Uint8Array,
    ): Promise<Uint8Array> {
        const doc = await this.getDocument(noteId);
        const syncState = this.getSyncState(noteId, clientID);

        console.log(
            `[Automerge Service] Receiving sync message from client ${clientID} for note ${noteId}`,
        );

        // Apply sync message (automatic CRDT merge)
        const [newDoc, newSyncState] = Automerge.receiveSyncMessage(doc, syncState, message);

        // Update in-memory state
        this.documents.set(noteId, newDoc);
        this.syncStates.get(noteId)!.set(clientID, newSyncState);

        // Persist to MongoDB (background)
        this.persistDocument(noteId, newDoc).catch(console.error);

        // Generate response message
        const responseMessage = Automerge.generateSyncMessage(newDoc, newSyncState);

        // Broadcast to other clients
        if (responseMessage) {
            this.broadcastSyncMessage(noteId, clientID, responseMessage);
        }

        return responseMessage || new Uint8Array();
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

        console.log(`[Automerge Service] Persisted version ${version} for note ${noteId}`);
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
    ): void {
        console.log(
            `[Automerge Service] Broadcasting sync message for note ${noteId} (sender: ${senderClientID})`,
        );

        // Use existing collab realtime service (works with both WebSocket and SignalR)
        collabRealtimeService.broadcast(
            noteId,
            {
                type: 'automerge-sync',
                noteId,
                syncMessage: Buffer.from(message).toString('base64'),
            },
            senderClientID,
        );
    }

    /**
     * Clean up sync state for a disconnected client
     */
    cleanupClientState(noteId: string, clientID: string): void {
        const clientStates = this.syncStates.get(noteId);
        if (clientStates) {
            clientStates.delete(clientID);
            console.log(
                `[Automerge Service] Cleaned up sync state for client ${clientID} on note ${noteId}`,
            );
        }
    }

    /**
     * Clean up document from memory when no clients are connected
     */
    cleanupDocument(noteId: string): void {
        this.documents.delete(noteId);
        this.syncStates.delete(noteId);
        console.log(`[Automerge Service] Cleaned up document ${noteId} from memory`);
    }
}

export const automergeService = new AutomergeService();
