import { updateNoteInternal, findNoteByIdInternal } from '../repositories/note.repo';
import { collabRealtimeService } from './collab-realtime.service';

// Store document version + steps in memory (clear after 30 min idle)
interface DocumentAuthority {
    version: number;
    steps: { step: any; clientID: string }[]; // Store step + author
    lastActivity: Date;
    clientIds: Set<string>; // Track connected clients
    currentDoc: any; // Current document state (ProseMirror JSON)
}

class OTService {
    private documents = new Map<string, DocumentAuthority>();

    // Debug helper
    private debug(msg: string, ...args: any[]) {
        console.log(`[OT Service] ${msg}`, ...args);
    }

    // Load document from MongoDB
    async getDocument(noteId: string): Promise<DocumentAuthority> {
        let doc = this.documents.get(noteId);

        if (!doc) {
            const note = await findNoteByIdInternal(noteId);
            if (!note) throw new Error('Note not found');

            // Start fresh at version 0 for each collaboration session
            doc = {
                version: 0,
                steps: [],
                lastActivity: new Date(),
                clientIds: new Set(),
                currentDoc: note.content, // Store current document state
            };
            this.documents.set(noteId, doc);
            console.log(`[OT Service] Starting new session for note ${noteId} at version 0`);
        } else if (doc.clientIds.size === 0 && doc.version > 0) {
            // Stale session - reset to version 0
            const note = await findNoteByIdInternal(noteId);
            console.log(
                `[OT Service] Resetting stale session for note ${noteId} from version ${doc.version} to 0`,
            );
            doc.version = 0;
            doc.steps = [];
            doc.currentDoc = note?.content;
        }

        doc.lastActivity = new Date();
        return doc;
    }

    // Apply new steps from a client
    async receiveSteps(
        noteId: string,
        clientSteps: any[], // Steps as JSON
        clientVersion: number,
        clientID: string,
        clientDoc?: any, // Optional: client's current document state after applying their steps
    ): Promise<{ version: number; steps: any[]; clientIDs: string[]; resync?: boolean } | null> {
        const doc = await this.getDocument(noteId);

        this.debug(
            `Received ${clientSteps.length} steps from ${clientID} at version ${clientVersion} (server at ${doc.version})`,
        );

        // Client is behind - they need to catch up first
        if (clientVersion < doc.version) {
            const missedStepsData = doc.steps.slice(
                clientVersion - (doc.version - doc.steps.length),
            );
            const missedSteps = missedStepsData.map((s) => s.step);
            const missedClientIDs = missedStepsData.map((s) => s.clientID);
            console.log(`[OT Service] Client behind, sending ${missedSteps.length} missed steps`);
            return {
                version: doc.version,
                steps: missedSteps,
                clientIDs: missedClientIDs,
            };
        }

        // Client is up to date - apply their steps
        if (clientVersion === doc.version) {
            // Store steps with author
            const newSteps = clientSteps.map((step) => ({ step, clientID }));
            doc.steps.push(...newSteps);
            doc.version += clientSteps.length;

            // Update current document state if client sent it
            if (clientDoc) {
                doc.currentDoc = clientDoc;
                console.log(`[OT Service] Updated currentDoc from client ${clientID}`);
            }

            console.log(
                `[OT Service] Applied steps, new version: ${doc.version}, broadcasting to other clients`,
            );

            // Persist to MongoDB (async, don't block)
            this.persistSteps(noteId, clientSteps, doc.version).catch(console.error);

            // Broadcast to other clients using abstract service
            this.broadcastSteps(noteId, clientSteps, doc.version, clientID);

            // Return success ACK so the sender knows their steps were accepted
            return {
                version: doc.version,
                steps: clientSteps,
                clientIDs: Array(clientSteps.length).fill(clientID),
                resync: false,
            };
        }

        // Client is ahead - something went wrong (server lost state?)
        this.debug(
            `Client ${clientID} is ahead of authority for note ${noteId} (C:${clientVersion} > S:${doc.version})`,
        );
        return {
            version: doc.version,
            steps: [],
            clientIDs: [],
            resync: true, // Tell client to resync
        };
    }

    private async persistSteps(noteId: string, steps: any[], version: number): Promise<void> {
        // Apply steps to ProseMirror document to get updated content
        const note = await findNoteByIdInternal(noteId);
        if (!note || !note.content) return;

        // TODO: Apply steps to note.content (ProseMirror JSON)
        // For now, just update version
        await updateNoteInternal(noteId, { version });
    }

    private broadcastSteps(noteId: string, steps: any[], version: number, sender: string): void {
        const message = {
            type: 'steps',
            version,
            steps, // Included for broadcast
            clientIDs: Array(steps.length).fill(sender),
        };

        console.log(
            `[OT Service] Broadcasting ${steps.length} steps at version ${version} to note ${noteId}`,
        );
        console.log(`[OT Service] Sender clientID: "${sender}"`);
        console.log(
            `[OT Service] Connected clients for this note:`,
            collabRealtimeService.getConnectedClients(noteId),
        );

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

            // Cleanup when last client disconnects
            if (doc.clientIds.size === 0) {
                // In development: clear immediately
                // In production: wait 30 min to allow quick reconnects
                const isDev = process.env.NODE_ENV !== 'production';
                const delay = isDev ? 0 : 30 * 60 * 1000;

                setTimeout(() => {
                    const d = this.documents.get(noteId);
                    if (d && d.clientIds.size === 0) {
                        this.documents.delete(noteId);
                        console.log(
                            `[OT Service] Cleaned up session for note ${noteId} after last client disconnected`,
                        );
                    }
                }, delay);
            }
        }

        // Unregister from realtime service
        collabRealtimeService.removeConnection(noteId, clientID);
    }
}

export const otService = new OTService();
