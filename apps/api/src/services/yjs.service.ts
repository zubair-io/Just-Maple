import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { Schema } from 'prosemirror-model';
import type { ServerWebSocket } from 'bun';
import { findNoteByIdInternal, updateNoteInternal } from '../repositories/note.repo';
import type { Note, NoteContent } from '@maple/shared';

// Define ProseMirror schema that matches TipTap's StarterKit
const prosemirrorSchema = new Schema({
    nodes: {
        doc: {
            content: 'block+',
        },
        paragraph: {
            content: 'inline*',
            group: 'block',
            parseDOM: [{ tag: 'p' }],
            toDOM() {
                return ['p', 0];
            },
        },
        heading: {
            attrs: { level: { default: 1 } },
            content: 'inline*',
            group: 'block',
            parseDOM: [
                { tag: 'h1', attrs: { level: 1 } },
                { tag: 'h2', attrs: { level: 2 } },
                { tag: 'h3', attrs: { level: 3 } },
                { tag: 'h4', attrs: { level: 4 } },
                { tag: 'h5', attrs: { level: 5 } },
                { tag: 'h6', attrs: { level: 6 } },
            ],
            toDOM(node) {
                return ['h' + node.attrs.level, 0];
            },
        },
        text: {
            group: 'inline',
        },
    },
    marks: {},
});

/**
 * Y.js Collaboration Service - Data Flow Documentation
 *
 * LOADING FLOW (Server → Client):
 * 1. Client connects WebSocket → /ws/collab/:noteId?token=<jwt>
 * 2. Server authenticates user, verifies note access
 * 3. Server loads Y.Doc from MongoDB:
 *    a. Load yjsSnapshot (if exists) → full document state
 *    b. Apply yjsUpdates (if any) → incremental changes since snapshot
 *    c. OR convert from legacy content field (ProseMirror JSON) if no Y.js data
 * 4. Server sends Sync Step 1 (full Y.Doc state) to client via WebSocket
 * 5. Client applies update to local Y.Doc → TipTap Collaboration extension renders content
 *
 * SAVING FLOW (Client → Server):
 * 1. User types in TipTap editor
 * 2. Y.Doc generates update event (small binary patch)
 * 3. Client sends update via WebSocket
 * 4. Server applies update to in-memory Y.Doc
 * 5. Server broadcasts update to other connected clients (real-time sync)
 * 6. Server persists update to MongoDB (yjsUpdates array)
 * 7. Periodically (every 5 min): compact to snapshot, clear old updates
 *
 * OFFLINE FLOW:
 * 1. Client stores Y.Doc in browser IndexedDB
 * 2. Offline edits stored locally in Y.Doc and IndexedDB
 * 3. On reconnect: IndexedDB changes automatically sent to server
 * 4. Y.js CRDT automatically merges any conflicts
 *
 * MIGRATION FLOW (Legacy → Y.js):
 * 1. Note has only ProseMirror content (no yjsSnapshot/yjsUpdates)
 * 2. Server converts ProseMirror JSON → Y.XmlFragment
 * 3. Server creates initial yjsSnapshot
 * 4. Future edits use Y.js updates
 */

interface YjsDocument {
    doc: Y.Doc;
    connections: Set<ServerWebSocket<{ noteId: string; userId: string }>>;
    lastActivity: Date;
}

class YjsService {
    private docs = new Map<string, YjsDocument>();
    private compactionInterval: Timer | null = null;

    constructor() {
        // Start periodic compaction (every 5 minutes)
        this.startCompactionTimer();
    }

    /**
     * Get or create a Y.Doc for a note
     */
    async getOrCreateDoc(noteId: string): Promise<Y.Doc> {
        let yjsDoc = this.docs.get(noteId);

        if (!yjsDoc) {
            // Load from database
            const doc = await this.loadDoc(noteId);

            // Set up update listener to broadcast changes and persist
            doc.on('update', (update: Uint8Array, origin: any) => {
                // Broadcast to all connected clients (origin is the WebSocket that made the change)
                this.broadcastUpdate(noteId, update, origin);

                // CRITICAL: Only persist updates from WebSocket clients (new edits)
                // Do NOT persist updates from loading the database (origin = null/undefined)
                // This prevents duplicate updates from being re-saved
                if (origin) {
                    // Persist update to database (async, non-blocking)
                    this.persistUpdate(noteId, update).catch((error) => {
                        console.error(
                            `[YjsService] Failed to persist update for ${noteId}:`,
                            error,
                        );
                    });
                }
            });

            yjsDoc = {
                doc,
                connections: new Set(),
                lastActivity: new Date(),
            };
            this.docs.set(noteId, yjsDoc);
        }

        yjsDoc.lastActivity = new Date();
        return yjsDoc.doc;
    }

    /**
     * Load Y.Doc from MongoDB
     * Access control should already be verified before calling this
     */
    async loadDoc(noteId: string): Promise<Y.Doc> {
        const note = await findNoteByIdInternal(noteId);

        if (!note) {
            throw new Error('Note not found');
        }

        console.log(`[YjsService] Loading doc for note ${noteId}`);
        console.log(`[YjsService]   - Has yjsSnapshot: ${!!note.yjsSnapshot}`);
        console.log(`[YjsService]   - Has yjsUpdates: ${note.yjsUpdates?.length || 0}`);
        console.log(`[YjsService]   - Has content: ${!!note.content}`);
        if (note.content) {
            console.log(
                `[YjsService]   - Content preview: ${JSON.stringify(note.content).substring(0, 200)}`,
            );
        }

        // CRITICAL: Use noteId as the Y.Doc GUID to ensure consistency across reloads
        // This prevents duplication issues when the same note is loaded multiple times
        const ydoc = new Y.Doc({ guid: noteId });

        // Load from snapshot if exists
        if (note.yjsSnapshot) {
            const snapshot = new Uint8Array(note.yjsSnapshot);
            Y.applyUpdate(ydoc, snapshot);
            console.log(`[YjsService] Loaded from snapshot`);
        }

        // Apply incremental updates if any
        if (note.yjsUpdates && note.yjsUpdates.length > 0) {
            for (const update of note.yjsUpdates) {
                const updateArray = new Uint8Array(update);
                Y.applyUpdate(ydoc, updateArray);
            }
            console.log(`[YjsService] Applied ${note.yjsUpdates.length} incremental updates`);
        }

        // If no Y.js data exists, initialize from legacy ProseMirror content
        const hasYjsData = note.yjsSnapshot || (note.yjsUpdates && note.yjsUpdates.length > 0);
        if (!hasYjsData && note.content) {
            console.log(
                `[YjsService] No Y.js data found, initializing from ProseMirror content...`,
            );
            this.initializeFromContent(ydoc, note.content);

            // Persist the initialized state as a snapshot so we don't have to convert again
            const snapshot = Y.encodeStateAsUpdate(ydoc);
            console.log(
                `[YjsService] Created snapshot from content, size: ${snapshot.length} bytes`,
            );
            this.saveSnapshot(noteId, snapshot).catch((error) => {
                console.error(`[YjsService] Failed to save initial snapshot for ${noteId}:`, error);
            });
        } else if (!hasYjsData && !note.content) {
            console.warn(`[YjsService] WARNING: Note ${noteId} has NO Y.js data AND NO content!`);
        }

        // Debug: Check what's in the Y.Doc
        const xmlFragment = ydoc.getXmlFragment('content');
        console.log(`[YjsService] Y.Doc loaded, fragment length: ${xmlFragment.length}`);

        // Debug: Print out what's actually in the fragment
        for (let i = 0; i < xmlFragment.length; i++) {
            const node = xmlFragment.get(i);
            if (node instanceof Y.XmlElement) {
                console.log(
                    `[YjsService]   Node ${i}: XmlElement(${node.nodeName}), children: ${node.length}`,
                );
                // Print first child if any
                if (node.length > 0) {
                    const firstChild = node.get(0);
                    if (firstChild instanceof Y.XmlText) {
                        console.log(
                            `[YjsService]     First child: XmlText("${firstChild.toString().substring(0, 50)}")`,
                        );
                    } else if (firstChild instanceof Y.XmlElement) {
                        console.log(
                            `[YjsService]     First child: XmlElement(${firstChild.nodeName})`,
                        );
                    }
                }
            } else if (node instanceof Y.XmlText) {
                console.log(
                    `[YjsService]   Node ${i}: XmlText("${node.toString().substring(0, 50)}")`,
                );
            }
        }

        return ydoc;
    }

    /**
     * Initialize Y.Doc from ProseMirror content (legacy migration)
     * Uses y-prosemirror to properly convert ProseMirror JSON to Y.js format
     */
    private initializeFromContent(ydoc: Y.Doc, content: NoteContent): void {
        console.log('[YjsService] Converting ProseMirror JSON manually...');
        console.log('[YjsService] Content:', JSON.stringify(content).substring(0, 200));

        const xmlFragment = ydoc.getXmlFragment('content');

        // Convert ProseMirror nodes to Y.XmlElements recursively
        if (content && content.content && Array.isArray(content.content)) {
            const yNodes = content.content.map((node) => this.prosemirrorNodeToYjs(node));
            xmlFragment.insert(0, yNodes);
            console.log(
                '[YjsService] Manual conversion completed, inserted',
                yNodes.length,
                'nodes',
            );
        }
    }

    /**
     * Convert a ProseMirror node to Y.js XmlElement/XmlText
     */
    private prosemirrorNodeToYjs(node: any): Y.XmlElement | Y.XmlText {
        // Text nodes become Y.XmlText
        if (node.type === 'text') {
            const ytext = new Y.XmlText();
            ytext.insert(0, node.text || '');

            // Apply marks (bold, italic, etc.)
            if (node.marks && Array.isArray(node.marks)) {
                for (const mark of node.marks) {
                    ytext.setAttribute(mark.type, JSON.stringify(mark.attrs || {}));
                }
            }

            return ytext;
        }

        // Other nodes become Y.XmlElement
        const yelem = new Y.XmlElement(node.type);

        // Set attributes
        if (node.attrs) {
            for (const [key, value] of Object.entries(node.attrs)) {
                if (value !== null && value !== undefined) {
                    yelem.setAttribute(
                        key,
                        typeof value === 'string' ? value : JSON.stringify(value),
                    );
                }
            }
        }

        // Add marks as attributes
        if (node.marks && Array.isArray(node.marks)) {
            for (const mark of node.marks) {
                yelem.setAttribute(`mark_${mark.type}`, JSON.stringify(mark.attrs || {}));
            }
        }

        // Recursively add children
        if (node.content && Array.isArray(node.content)) {
            const children = node.content.map((child: any) => this.prosemirrorNodeToYjs(child));
            yelem.insert(0, children);
        }

        return yelem;
    }

    /**
     * Add a WebSocket connection to a document
     */
    addConnection(noteId: string, ws: ServerWebSocket<{ noteId: string; userId: string }>): void {
        const yjsDoc = this.docs.get(noteId);
        if (yjsDoc) {
            yjsDoc.connections.add(ws);
            yjsDoc.lastActivity = new Date();
        }
    }

    /**
     * Remove a WebSocket connection from a document
     */
    removeConnection(
        noteId: string,
        ws: ServerWebSocket<{ noteId: string; userId: string }>,
    ): void {
        const yjsDoc = this.docs.get(noteId);
        if (yjsDoc) {
            yjsDoc.connections.delete(ws);
            yjsDoc.lastActivity = new Date();

            // Clean up document if no more connections
            if (yjsDoc.connections.size === 0) {
                // Keep in memory for 5 minutes after last connection
                setTimeout(
                    () => {
                        const doc = this.docs.get(noteId);
                        if (doc && doc.connections.size === 0) {
                            this.docs.delete(noteId);
                            console.log(`[YjsService] Cleaned up document: ${noteId}`);
                        }
                    },
                    5 * 60 * 1000,
                );
            }
        }
    }

    /**
     * Broadcast Y.js update to all connected clients except sender
     * This wraps raw Y.js updates in the sync protocol format
     */
    broadcastUpdate(
        noteId: string,
        update: Uint8Array,
        sender?: ServerWebSocket<{ noteId: string; userId: string }>,
    ): void {
        const yjsDoc = this.docs.get(noteId);
        if (!yjsDoc) return;

        // Encode update in y-protocols binary format
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);

        console.log(`[YjsService] Broadcasting update to ${yjsDoc.connections.size} connections`);
        console.log(`[YjsService]   Update size: ${update.length} bytes`);
        console.log(`[YjsService]   Message size: ${message.length} bytes`);
        console.log(
            `[YjsService]   First 30 bytes: [${Array.from(message.slice(0, 30)).join(', ')}]`,
        );

        let broadcastCount = 0;
        // CRITICAL: Convert to Buffer for binary WebSocket transmission
        const buffer = Buffer.from(message);
        for (const connection of yjsDoc.connections) {
            if (connection !== sender && connection.readyState === 1) {
                connection.send(buffer);
                broadcastCount++;
            }
        }

        console.log(
            `[YjsService] Broadcast complete, sent to ${broadcastCount} clients (skipped sender: ${sender ? 'yes' : 'no'})`,
        );
    }

    /**
     * Broadcast a raw message to all connected clients except sender
     * Use this for awareness messages or other pre-encoded messages
     */
    broadcastRaw(
        noteId: string,
        message: Uint8Array,
        sender?: ServerWebSocket<{ noteId: string; userId: string }>,
    ): void {
        const yjsDoc = this.docs.get(noteId);
        if (!yjsDoc) return;

        // CRITICAL: Convert to Buffer for binary WebSocket transmission
        const buffer = Buffer.from(message);
        for (const connection of yjsDoc.connections) {
            if (connection !== sender && connection.readyState === 1) {
                connection.send(buffer);
            }
        }
    }

    /**
     * Persist Y.js updates to MongoDB (append to updates array)
     * Access control should already be verified before calling this
     */
    async persistUpdate(noteId: string, update: Uint8Array): Promise<void> {
        try {
            console.log(
                `[YjsService] Persisting update for note ${noteId}, size: ${update.length} bytes`,
            );

            const note = await findNoteByIdInternal(noteId);
            if (!note) {
                console.warn(`[YjsService] Note ${noteId} not found, cannot persist update`);
                return;
            }

            const updates = note.yjsUpdates || [];
            updates.push(Array.from(update));

            await updateNoteInternal(noteId, {
                yjsUpdates: updates,
            });

            console.log(
                `[YjsService] ✓ Successfully persisted update for ${noteId}, total updates: ${updates.length}`,
            );
        } catch (error) {
            console.error(`[YjsService] ✗ Failed to persist update for note ${noteId}:`, error);
            throw error;
        }
    }

    /**
     * Compact document - create snapshot and clear old updates
     */
    /**
     * Save a snapshot to MongoDB (for initial migration from ProseMirror content)
     */
    private async saveSnapshot(noteId: string, snapshot: Uint8Array): Promise<void> {
        try {
            await updateNoteInternal(noteId, {
                yjsSnapshot: Array.from(snapshot),
                yjsUpdates: [],
                lastCompactedAt: new Date().toISOString(),
            });
            console.log(`[YjsService] Saved initial snapshot for note: ${noteId}`);
        } catch (error) {
            console.error(`[YjsService] Failed to save snapshot for note ${noteId}:`, error);
            throw error;
        }
    }

    async compactDocument(noteId: string): Promise<void> {
        const yjsDoc = this.docs.get(noteId);
        if (!yjsDoc) return;

        try {
            // Create snapshot from current state
            const snapshot = Y.encodeStateAsUpdate(yjsDoc.doc);

            // Extract content for legacy field
            const content = this.extractContent(yjsDoc.doc);

            // Save to MongoDB
            await updateNoteInternal(noteId, {
                yjsSnapshot: Array.from(snapshot),
                yjsUpdates: [], // Clear old updates
                lastCompactedAt: new Date().toISOString(),
                content, // Sync to legacy field for mobile
            });

            console.log(`[YjsService] Compacted document: ${noteId}`);
        } catch (error) {
            console.error(`[YjsService] Failed to compact note ${noteId}:`, error);
        }
    }

    /**
     * Extract ProseMirror content from Y.Doc (for mobile compatibility)
     */
    private extractContent(ydoc: Y.Doc): NoteContent {
        const xmlFragment = ydoc.getXmlFragment('content');

        // This is a simplified extraction - you may need a more robust solution
        // For now, we'll just serialize the XML fragment
        const content = xmlFragment.toString();

        try {
            return JSON.parse(content);
        } catch {
            // Fallback to default content if parsing fails
            return {
                type: 'doc',
                content: [
                    { type: 'heading', attrs: { level: 1 }, content: [] },
                    { type: 'paragraph', content: [] },
                ],
            };
        }
    }

    /**
     * Start periodic compaction timer
     */
    private startCompactionTimer(): void {
        // Run every 5 minutes
        this.compactionInterval = setInterval(
            () => {
                this.runCompaction();
            },
            5 * 60 * 1000,
        );

        console.log('[YjsService] Started compaction timer');
    }

    /**
     * Run compaction on all active documents
     */
    private async runCompaction(): Promise<void> {
        console.log('[YjsService] Running periodic compaction...');

        for (const [noteId, yjsDoc] of this.docs.entries()) {
            // Only compact if there's been recent activity
            const timeSinceActivity = Date.now() - yjsDoc.lastActivity.getTime();
            if (timeSinceActivity < 10 * 60 * 1000) {
                // Less than 10 minutes
                await this.compactDocument(noteId);
            }
        }
    }

    /**
     * Stop compaction timer (cleanup)
     */
    stop(): void {
        if (this.compactionInterval) {
            clearInterval(this.compactionInterval);
            this.compactionInterval = null;
            console.log('[YjsService] Stopped compaction timer');
        }
    }

    /**
     * Get active users for a note
     */
    getActiveUsers(noteId: string): string[] {
        const yjsDoc = this.docs.get(noteId);
        if (!yjsDoc) return [];

        const userIds = new Set<string>();
        for (const connection of yjsDoc.connections) {
            if (connection.data.userId) {
                userIds.add(connection.data.userId);
            }
        }

        return Array.from(userIds);
    }
}

// Singleton instance
export const yjsService = new YjsService();
