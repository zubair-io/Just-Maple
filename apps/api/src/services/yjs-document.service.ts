import * as Y from 'yjs';
import {
    findNotebookByNoteId,
    updateNotebookForYJS,
    getNotebookState,
    notebookExists,
} from '../repositories/notebook.repo';
import { yjsSSEService } from './yjs-sse.service';

/**
 * YJS Document Manager Service
 * Manages Y.Doc instances in memory for real-time collaboration
 * Persists to MongoDB notebooks collection
 */
class YJSDocumentService {
    // In-memory Y.Doc instances per noteId
    private documents = new Map<string, Y.Doc>();

    // Debounced save timers per noteId
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
     * Get or load Y.Doc for a notebook
     * Loads from MongoDB if not in memory
     */
    async getOrCreateDoc(noteId: string): Promise<Y.Doc> {
        // Update activity timestamp
        this.lastActivity.set(noteId, Date.now());

        // Check in-memory cache first
        let ydoc = this.documents.get(noteId);
        if (ydoc) {
            return ydoc;
        }

        // Create new Y.Doc
        ydoc = new Y.Doc();

        // Try to load from database
        const state = await getNotebookState(noteId);
        if (state) {
            Y.applyUpdate(ydoc, state);
            console.log(`[YJS] Loaded document from database: ${noteId}`);
        } else {
            console.log(`[YJS] Created new empty document: ${noteId}`);
        }

        // Setup update listener for persistence
        ydoc.on('update', (update: Uint8Array, origin: any) => {
            this.handleDocUpdate(noteId, update, origin);
        });

        // Cache in memory
        this.documents.set(noteId, ydoc);

        return ydoc;
    }

    /**
     * Apply an update from a client
     * @param noteId - Document ID
     * @param update - Y.Doc update binary
     * @param clientId - Origin client ID
     */
    async applyUpdate(noteId: string, update: Uint8Array, clientId: string): Promise<void> {
        const ydoc = await this.getOrCreateDoc(noteId);

        // Apply update with client ID as origin
        Y.applyUpdate(ydoc, update, clientId);

        // Broadcast to other clients (SSE service handles this)
        yjsSSEService.broadcastUpdate(noteId, update, clientId);
    }

    /**
     * Get the full state of a document
     * Used for initial sync when client connects
     */
    async getStateAsUpdate(noteId: string): Promise<Uint8Array> {
        const ydoc = await this.getOrCreateDoc(noteId);
        return Y.encodeStateAsUpdate(ydoc);
    }

    /**
     * Get state vector for incremental sync
     */
    async getStateVector(noteId: string): Promise<Uint8Array> {
        const ydoc = await this.getOrCreateDoc(noteId);
        return Y.encodeStateVector(ydoc);
    }

    /**
     * Compute diff between client state and server state
     * Used for catching up clients
     */
    async computeDiff(noteId: string, clientStateVector: Uint8Array): Promise<Uint8Array> {
        const ydoc = await this.getOrCreateDoc(noteId);
        return Y.encodeStateAsUpdate(ydoc, clientStateVector);
    }

    /**
     * Initialize a new notebook (for first sync of offline-created notebook)
     * If notebook already exists, merges states
     */
    async initializeNotebook(noteId: string, initialState: Uint8Array): Promise<Uint8Array> {
        const exists = await notebookExists(noteId);

        if (exists) {
            // Document exists - merge states
            const ydoc = await this.getOrCreateDoc(noteId);
            Y.applyUpdate(ydoc, initialState, 'init');

            // Return merged state
            return Y.encodeStateAsUpdate(ydoc);
        } else {
            // New document - create with initial state
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, initialState);

            // Setup update listener
            ydoc.on('update', (update: Uint8Array, origin: any) => {
                this.handleDocUpdate(noteId, update, origin);
            });

            // Cache and persist
            this.documents.set(noteId, ydoc);
            this.lastActivity.set(noteId, Date.now());

            // Persist immediately for new documents
            await this.persistDocument(noteId, ydoc);

            return initialState;
        }
    }

    /**
     * Handle document update (from local Y.Doc change)
     */
    private handleDocUpdate(noteId: string, update: Uint8Array, origin: any): void {
        // Update activity timestamp
        this.lastActivity.set(noteId, Date.now());

        // Schedule debounced save
        this.scheduleSave(noteId);
    }

    /**
     * Schedule debounced save to database
     */
    private scheduleSave(noteId: string): void {
        // Clear existing timer
        const existingTimer = this.saveTimers.get(noteId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            this.saveDocument(noteId);
        }, this.SAVE_DELAY);

        this.saveTimers.set(noteId, timer);
    }

    /**
     * Save document to database
     */
    private async saveDocument(noteId: string): Promise<void> {
        const ydoc = this.documents.get(noteId);
        if (!ydoc) return;

        try {
            await this.persistDocument(noteId, ydoc);
            console.log(`[YJS] Saved document to database: ${noteId}`);
        } catch (error) {
            console.error(`[YJS] Failed to save document ${noteId}:`, error);
        } finally {
            this.saveTimers.delete(noteId);
        }
    }

    /**
     * Persist document state to MongoDB
     */
    private async persistDocument(noteId: string, ydoc: Y.Doc): Promise<void> {
        const state = Y.encodeStateAsUpdate(ydoc);
        await updateNotebookForYJS(noteId, state);
    }

    /**
     * Force save all pending documents
     * Used during graceful shutdown
     */
    async flushAll(): Promise<void> {
        const savePromises: Promise<void>[] = [];

        for (const [noteId, timer] of this.saveTimers) {
            clearTimeout(timer);
            savePromises.push(this.saveDocument(noteId));
        }

        await Promise.all(savePromises);
        console.log(`[YJS] Flushed all pending saves`);
    }

    /**
     * Unload document from memory
     * Saves to database first
     */
    async unloadDocument(noteId: string): Promise<void> {
        // Cancel pending save timer
        const timer = this.saveTimers.get(noteId);
        if (timer) {
            clearTimeout(timer);
            this.saveTimers.delete(noteId);
        }

        // Save to database
        await this.saveDocument(noteId);

        // Destroy Y.Doc
        const ydoc = this.documents.get(noteId);
        if (ydoc) {
            ydoc.destroy();
        }

        // Remove from memory
        this.documents.delete(noteId);
        this.lastActivity.delete(noteId);

        console.log(`[YJS] Unloaded document from memory: ${noteId}`);
    }

    /**
     * Clean up idle documents
     */
    private cleanupIdleDocuments(): void {
        const now = Date.now();

        for (const [noteId, lastActive] of this.lastActivity) {
            // Check if document is idle and has no connected clients
            if (now - lastActive > this.IDLE_TIMEOUT) {
                const clientCount = yjsSSEService.getClientCount(noteId);
                if (clientCount === 0) {
                    console.log(`[YJS] Unloading idle document: ${noteId}`);
                    this.unloadDocument(noteId).catch(console.error);
                }
            }
        }
    }

    /**
     * Check if document is loaded in memory
     */
    isLoaded(noteId: string): boolean {
        return this.documents.has(noteId);
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
        console.log('[YJS] Document service shutdown');
    }
}

export const yjsDocumentService = new YJSDocumentService();
