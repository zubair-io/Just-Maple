import { Step } from 'prosemirror-transform';
import { updateNoteInternal, findNoteByIdInternal } from '../repositories/note.repo';
import { collabRealtimeService } from './collab-realtime.service';

// Store document version + steps in memory (clear after 30 min idle)
interface DocumentAuthority {
    version: number;
    steps: Step[]; // Recent steps (for rebasing)
    lastActivity: Date;
    clientIds: Set<string>; // Track connected clients
}

class OTService {
    private documents = new Map<string, DocumentAuthority>();

    // Load document from MongoDB
    async getDocument(noteId: string): Promise<DocumentAuthority> {
        let doc = this.documents.get(noteId);

        if (!doc) {
            const note = await findNoteByIdInternal(noteId);
            if (!note) throw new Error('Note not found');

            doc = {
                version: note.version || 0,
                steps: [], // Start fresh (steps not persisted long-term)
                lastActivity: new Date(),
                clientIds: new Set(),
            };
            this.documents.set(noteId, doc);
        }

        doc.lastActivity = new Date();
        return doc;
    }

    // Apply new steps from a client
    async receiveSteps(
        noteId: string,
        clientSteps: Step[],
        clientVersion: number,
        clientID: string,
    ): Promise<{ version: number; steps: Step[] } | null> {
        const doc = await this.getDocument(noteId);

        // Client is behind - they need to catch up first
        if (clientVersion < doc.version) {
            // Return steps they're missing
            const missedSteps = doc.steps.slice(clientVersion - (doc.version - doc.steps.length));
            return { version: doc.version, steps: missedSteps };
        }

        // Client is up to date - apply their steps
        if (clientVersion === doc.version) {
            doc.steps.push(...clientSteps);
            doc.version += clientSteps.length;

            // Persist to MongoDB (async, don't block)
            this.persistSteps(noteId, clientSteps, doc.version).catch(console.error);

            // Broadcast to other clients using abstract service
            this.broadcastSteps(noteId, clientSteps, doc.version, clientID);

            return null; // No response needed
        }

        // Client is ahead - something went wrong
        console.error(`Client ${clientID} is ahead of authority for note ${noteId}`);
        return null;
    }

    private async persistSteps(noteId: string, steps: Step[], version: number): Promise<void> {
        // Apply steps to ProseMirror document to get updated content
        const note = await findNoteByIdInternal(noteId);
        if (!note || !note.content) return;

        // TODO: Apply steps to note.content (ProseMirror JSON)
        // For now, just update version
        await updateNoteInternal(noteId, { version });
    }

    private broadcastSteps(noteId: string, steps: Step[], version: number, sender: string): void {
        const message = {
            type: 'steps',
            version,
            steps: steps.map((s) => s.toJSON()),
            clientID: sender,
        };

        // Use abstract realtime service (works with both WebSocket and SignalR)
        collabRealtimeService.broadcast(noteId, message, sender);
    }

    // Broadcast new note creation to all clients in the tag
    async broadcastNoteCreated(tagId: string, note: any): Promise<void> {
        const message = {
            type: 'note-created',
            tagId,
            note,
        };

        // Broadcast to all clients viewing this tag
        collabRealtimeService.broadcast(tagId, message);
    }

    addConnection(noteId: string, clientID: string, connection: any): void {
        const doc = this.documents.get(noteId);
        if (doc) {
            doc.clientIds.add(clientID);
        }

        // Register with realtime service
        collabRealtimeService.addConnection(noteId, clientID, connection);
    }

    removeConnection(noteId: string, clientID: string): void {
        const doc = this.documents.get(noteId);
        if (doc) {
            doc.clientIds.delete(clientID);

            // Cleanup after 30 min idle
            if (doc.clientIds.size === 0) {
                setTimeout(
                    () => {
                        const d = this.documents.get(noteId);
                        if (d && d.clientIds.size === 0) {
                            this.documents.delete(noteId);
                        }
                    },
                    30 * 60 * 1000,
                );
            }
        }

        // Unregister from realtime service
        collabRealtimeService.removeConnection(noteId, clientID);
    }
}

export const otService = new OTService();
