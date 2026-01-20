import * as Y from 'yjs';
import {
    getWhiteboardState,
    updateWhiteboardState,
    whiteboardExists,
} from '../repositories/whiteboard.repo';
import { realtimeWSService } from './realtime-ws.service';

/**
 * YJS Whiteboard Document Manager Service
 * Manages Y.Doc instances in memory for real-time collaboration on whiteboards
 * Persists to MongoDB whiteboards collection (separate from memos)
 */
class YJSWhiteboardService {
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

    // Cleanup interval
    private cleanupInterval: Timer;

    constructor() {
        // Start idle document cleanup
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleDocuments();
        }, 60000); // Check every minute
    }

    /**
     * Get or load Y.Doc for a whiteboard
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
        const state = await getWhiteboardState(documentId);
        if (state) {
            Y.applyUpdate(ydoc, state);
            console.log(`[YJS-Whiteboard] Loaded document from database: ${documentId}`);
        } else {
            console.log(`[YJS-Whiteboard] Created new empty document: ${documentId}`);
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
     * Initialize a new whiteboard (for first sync of offline-created whiteboard)
     */
    async initializeWhiteboard(documentId: string, initialState: Uint8Array): Promise<Uint8Array> {
        const exists = await whiteboardExists(documentId);

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
     * Handle document update (from local Y.Doc change)
     */
    private handleDocUpdate(documentId: string, update: Uint8Array, origin: any): void {
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
            console.log(`[YJS-Whiteboard] Saved document to database: ${documentId}`);
        } catch (error) {
            console.error(`[YJS-Whiteboard] Failed to save document ${documentId}:`, error);
        } finally {
            this.saveTimers.delete(documentId);
        }
    }

    /**
     * Persist document state to MongoDB whiteboards collection
     */
    private async persistDocument(documentId: string, ydoc: Y.Doc): Promise<void> {
        const state = Y.encodeStateAsUpdate(ydoc);
        await updateWhiteboardState(documentId, state);
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
        console.log(`[YJS-Whiteboard] Flushed all pending saves`);
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

        console.log(`[YJS-Whiteboard] Unloaded document from memory: ${documentId}`);
    }

    /**
     * Clean up idle documents
     */
    private cleanupIdleDocuments(): void {
        const now = Date.now();

        for (const [documentId, lastActive] of this.lastActivity) {
            if (now - lastActive > this.IDLE_TIMEOUT) {
                const clientCount = realtimeWSService.getWhiteboardClientCount(documentId);
                if (clientCount === 0) {
                    console.log(`[YJS-Whiteboard] Unloading idle document: ${documentId}`);
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
        console.log('[YJS-Whiteboard] Document service shutdown');
    }
}

export const yjsWhiteboardService = new YJSWhiteboardService();
