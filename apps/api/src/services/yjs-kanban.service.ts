import * as Y from 'yjs';
import {
    getKanbanBoardState,
    upsertKanbanBoard,
    kanbanBoardExists,
} from '../repositories/kanban-board.repo';
import { realtimeWSService } from './realtime-ws.service';
import { DEFAULT_KANBAN_LANES, DEFAULT_KANBAN_SETTINGS, DEFAULT_LANE_IDS } from '@maple/shared';

/**
 * YJS Kanban Document Manager Service
 * Manages Y.Doc instances in memory for real-time collaboration on kanban boards
 * Persists to MongoDB kanban_boards collection
 */
class YJSKanbanService {
    // In-memory Y.Doc instances per documentId
    private documents = new Map<string, Y.Doc>();

    // Debounced save timers per documentId
    private saveTimers = new Map<string, Timer>();

    // Save debounce delay (ms)
    private readonly SAVE_DELAY = 1000;

    // Idle timeout before unloading doc from memory (ms)
    private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    // Last activity timestamp per document
    private lastActivity = new Map<string, number>();

    // Document metadata for upsert (notebookId needed to create kanban_boards entry)
    private documentMeta = new Map<string, { notebookId: string }>();

    // Cleanup interval
    private cleanupInterval: Timer;

    constructor() {
        // Start idle document cleanup
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleDocuments();
        }, 60000); // Check every minute
    }

    /**
     * Register metadata for a document (needed for DB upsert on first save)
     */
    registerMeta(documentId: string, notebookId: string): void {
        if (!this.documentMeta.has(documentId)) {
            this.documentMeta.set(documentId, { notebookId });
        }
    }

    /**
     * Get or load Y.Doc for a kanban board
     * Loads from MongoDB if not in memory
     */
    async getOrCreateDoc(documentId: string): Promise<Y.Doc> {
        // Update activity timestamp
        this.lastActivity.set(documentId, Date.now());

        // Check in-memory cache first
        let ydoc = this.documents.get(documentId);
        if (ydoc) {
            return ydoc;
        }

        // Create new Y.Doc
        ydoc = new Y.Doc();

        // Try to load from database
        const state = await getKanbanBoardState(documentId);
        if (state) {
            Y.applyUpdate(ydoc, state);
            console.log(`[YJS-Kanban] Loaded document from database: ${documentId}`);
        } else {
            // For new documents, keep the Y.Doc empty - let the client initialize
            console.log(`[YJS-Kanban] Created new empty document: ${documentId}`);
        }

        // Setup update listener for persistence
        ydoc.on('update', (update: Uint8Array, origin: any) => {
            this.handleDocUpdate(documentId, update, origin);
        });

        // Cache in memory
        this.documents.set(documentId, ydoc);

        return ydoc;
    }

    /**
     * Apply an update from a client
     */
    async applyUpdate(documentId: string, update: Uint8Array, clientId: string): Promise<void> {
        const ydoc = await this.getOrCreateDoc(documentId);

        // Apply update with client ID as origin
        Y.applyUpdate(ydoc, update, clientId);
    }

    /**
     * Get the full state of a document
     * Used for initial sync when client connects
     */
    async getStateAsUpdate(documentId: string): Promise<Uint8Array> {
        const ydoc = await this.getOrCreateDoc(documentId);
        return Y.encodeStateAsUpdate(ydoc);
    }

    /**
     * Get state vector for incremental sync
     */
    async getStateVector(documentId: string): Promise<Uint8Array> {
        const ydoc = await this.getOrCreateDoc(documentId);
        return Y.encodeStateVector(ydoc);
    }

    /**
     * Compute diff between client state and server state
     */
    async computeDiff(documentId: string, clientStateVector: Uint8Array): Promise<Uint8Array> {
        const ydoc = await this.getOrCreateDoc(documentId);
        return Y.encodeStateAsUpdate(ydoc, clientStateVector);
    }

    /**
     * Initialize a new kanban board (for first sync of offline-created board)
     */
    async initializeKanban(documentId: string, initialState: Uint8Array): Promise<Uint8Array> {
        const exists = await kanbanBoardExists(documentId);

        if (exists) {
            // Document exists - merge states
            const ydoc = await this.getOrCreateDoc(documentId);
            Y.applyUpdate(ydoc, initialState, 'init');

            // Return merged state
            return Y.encodeStateAsUpdate(ydoc);
        } else {
            // New document - create with initial state
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, initialState);

            // Setup update listener
            ydoc.on('update', (update: Uint8Array, origin: any) => {
                this.handleDocUpdate(documentId, update, origin);
            });

            // Cache and persist
            this.documents.set(documentId, ydoc);
            this.lastActivity.set(documentId, Date.now());

            // Persist immediately for new documents
            await this.persistDocument(documentId, ydoc);

            return initialState;
        }
    }

    /**
     * Initialize empty kanban board with default structure
     * Creates default lanes (To Do, In Progress, Done)
     */
    initializeEmptyKanban(ydoc: Y.Doc): void {
        const lanes = ydoc.getArray<Y.Map<unknown>>('lanes');
        // Initialize structures - these exist as side-effect references
        ydoc.getMap<Y.Map<unknown>>('cards');
        ydoc.getArray<Y.Map<unknown>>('archived');
        const settings = ydoc.getMap<unknown>('settings');

        // Create default lanes if empty
        if (lanes.length === 0) {
            for (const lane of DEFAULT_KANBAN_LANES) {
                const yLane = new Y.Map<unknown>();
                yLane.set('id', lane.id);
                yLane.set('title', lane.title);
                yLane.set('position', lane.position);
                yLane.set('isDefault', lane.isDefault ?? false);
                yLane.set('isDoneLane', lane.isDoneLane ?? false);
                yLane.set('cardIds', new Y.Array<string>());
                lanes.push([yLane]);
            }
        }

        // Set default settings if not set
        if (!settings.has('defaultLaneId')) {
            settings.set('defaultLaneId', DEFAULT_LANE_IDS.TODO);
        }
        if (!settings.has('cardDisplay')) {
            settings.set('cardDisplay', DEFAULT_KANBAN_SETTINGS.cardDisplay);
        }
        if (!settings.has('doneReset')) {
            settings.set('doneReset', DEFAULT_KANBAN_SETTINGS.doneReset);
        }
    }

    /**
     * Create a new card in a lane
     */
    createCard(
        ydoc: Y.Doc,
        cardId: string,
        laneId: string,
        memoPageId: string,
        title: string,
        memoId?: string,
    ): void {
        const cards = ydoc.getMap<Y.Map<unknown>>('cards');
        const lanes = ydoc.getArray<Y.Map<unknown>>('lanes');

        // Create card
        const card = new Y.Map<unknown>();
        card.set('id', cardId);
        card.set('memoPageId', memoPageId);
        if (memoId) {
            card.set('memoId', memoId);
        }
        card.set('title', title);
        cards.set(cardId, card);

        // Add card to lane
        for (let i = 0; i < lanes.length; i++) {
            const lane = lanes.get(i);
            if (lane.get('id') === laneId) {
                const cardIds = lane.get('cardIds') as Y.Array<string>;
                cardIds.push([cardId]);
                break;
            }
        }
    }

    /**
     * Handle document update (from local Y.Doc change)
     */
    private handleDocUpdate(documentId: string, _update: Uint8Array, _origin: any): void {
        // Update activity timestamp
        this.lastActivity.set(documentId, Date.now());

        // Schedule debounced save
        this.scheduleSave(documentId);
    }

    /**
     * Schedule debounced save to database
     */
    private scheduleSave(documentId: string): void {
        // Clear existing timer
        const existingTimer = this.saveTimers.get(documentId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            this.saveDocument(documentId);
        }, this.SAVE_DELAY);

        this.saveTimers.set(documentId, timer);
    }

    /**
     * Save document to database
     */
    private async saveDocument(documentId: string): Promise<void> {
        const ydoc = this.documents.get(documentId);
        if (!ydoc) return;

        try {
            await this.persistDocument(documentId, ydoc);
            console.log(`[YJS-Kanban] Saved document to database: ${documentId}`);
        } catch (error) {
            console.error(`[YJS-Kanban] Failed to save document ${documentId}:`, error);
        } finally {
            this.saveTimers.delete(documentId);
        }
    }

    /**
     * Persist document state to MongoDB kanban_boards collection
     */
    private async persistDocument(documentId: string, ydoc: Y.Doc): Promise<void> {
        const state = Y.encodeStateAsUpdate(ydoc);
        const meta = this.documentMeta.get(documentId);
        const notebookId = meta?.notebookId ?? '';
        await upsertKanbanBoard(documentId, documentId, notebookId, state);
    }

    /**
     * Force save all pending documents
     */
    async flushAll(): Promise<void> {
        const savePromises: Promise<void>[] = [];

        for (const [documentId, timer] of this.saveTimers) {
            clearTimeout(timer);
            savePromises.push(this.saveDocument(documentId));
        }

        await Promise.all(savePromises);
        console.log(`[YJS-Kanban] Flushed all pending saves`);
    }

    /**
     * Unload document from memory
     */
    async unloadDocument(documentId: string): Promise<void> {
        // Cancel pending save timer
        const timer = this.saveTimers.get(documentId);
        if (timer) {
            clearTimeout(timer);
            this.saveTimers.delete(documentId);
        }

        // Save to database
        await this.saveDocument(documentId);

        // Destroy Y.Doc
        const ydoc = this.documents.get(documentId);
        if (ydoc) {
            ydoc.destroy();
        }

        // Remove from memory
        this.documents.delete(documentId);
        this.lastActivity.delete(documentId);
        this.documentMeta.delete(documentId);

        console.log(`[YJS-Kanban] Unloaded document from memory: ${documentId}`);
    }

    /**
     * Clean up idle documents
     */
    private cleanupIdleDocuments(): void {
        const now = Date.now();

        for (const [documentId, lastActive] of this.lastActivity) {
            if (now - lastActive > this.IDLE_TIMEOUT) {
                const clientCount = realtimeWSService.getKanbanClientCount(documentId);
                if (clientCount === 0) {
                    console.log(`[YJS-Kanban] Unloading idle document: ${documentId}`);
                    this.unloadDocument(documentId).catch(console.error);
                }
            }
        }
    }

    /**
     * Check if document is loaded in memory
     */
    isLoaded(documentId: string): boolean {
        return this.documents.has(documentId);
    }

    /**
     * Get stats about loaded documents
     */
    getStats(): {
        loadedDocuments: number;
        pendingSaves: number;
    } {
        return {
            loadedDocuments: this.documents.size,
            pendingSaves: this.saveTimers.size,
        };
    }

    /**
     * Shutdown service
     */
    async shutdown(): Promise<void> {
        clearInterval(this.cleanupInterval);
        await this.flushAll();

        // Destroy all Y.Docs
        for (const ydoc of this.documents.values()) {
            ydoc.destroy();
        }

        this.documents.clear();
        this.lastActivity.clear();
        console.log('[YJS-Kanban] Document service shutdown');
    }
}

export const yjsKanbanService = new YJSKanbanService();
