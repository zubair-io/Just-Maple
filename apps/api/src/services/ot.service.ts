import {
    updatePageForCollab,
    findPageByIdForCollab,
    findPageById,
} from '../repositories/page.repo';
import { collabRealtimeService } from './collab-realtime.service';

// Store document version + steps in memory (clear after 30 min idle)
interface DocumentAuthority {
    version: number;
    steps: { step: any; clientID: string }[]; // Store step + author
    lastActivity: Date;
    clientIds: Set<string>; // Track connected clients
    currentDoc: any; // Current document state (ProseMirror JSON)
    cleanupTimeout?: NodeJS.Timeout; // Track cleanup timeout to prevent memory leaks
    generation: number; // Generation counter to detect stale cleanups
}

// Configuration constants
const MAX_STEPS_IN_MEMORY = 100; // Keep last 100 steps for catchup
const CLEANUP_DELAY_DEV = 0; // Immediate cleanup in dev
const CLEANUP_DELAY_PROD = 30 * 60 * 1000; // 30 minutes in production

// Track userId per clientID for permission validation
interface ConnectionInfo {
    userId: string;
}

// Permission cache entry
interface PermissionCacheEntry {
    hasAccess: boolean;
    expiresAt: number; // Timestamp
}

// Permission cache TTL (5 minutes)
const PERMISSION_CACHE_TTL = 5 * 60 * 1000;

class OTService {
    private documents = new Map<string, DocumentAuthority>();
    private connections = new Map<string, ConnectionInfo>(); // clientID -> ConnectionInfo
    private permissionCache = new Map<string, PermissionCacheEntry>(); // `${userId}:${noteId}` -> permission

    constructor() {
        // Periodic cleanup of expired permissions (every 10 minutes)
        setInterval(
            () => {
                this.cleanupExpiredPermissions();
            },
            10 * 60 * 1000,
        );
    }

    // Debug helper - no-op in production
    private debug(_msg: string, ..._args: any[]) {
        // Disabled for production
    }

    // Check permission with caching
    private async checkPermission(noteId: string, userId: string): Promise<boolean> {
        const cacheKey = `${userId}:${noteId}`;
        const cached = this.permissionCache.get(cacheKey);

        // Return cached result if still valid
        if (cached && cached.expiresAt > Date.now()) {
            return cached.hasAccess;
        }

        // Check actual permission
        const note = await findPageById(noteId, userId);
        const hasAccess = note !== null;

        // Cache result
        this.permissionCache.set(cacheKey, {
            hasAccess,
            expiresAt: Date.now() + PERMISSION_CACHE_TTL,
        });

        return hasAccess;
    }

    // Invalidate permission cache for a specific note (call this when permissions change)
    invalidatePermissions(noteId: string): void {
        for (const key of this.permissionCache.keys()) {
            if (key.endsWith(`:${noteId}`)) {
                this.permissionCache.delete(key);
            }
        }
    }

    // Periodic cleanup of expired cache entries
    private cleanupExpiredPermissions(): void {
        const now = Date.now();
        for (const [key, entry] of this.permissionCache.entries()) {
            if (entry.expiresAt <= now) {
                this.permissionCache.delete(key);
            }
        }
    }

    // Load document from MongoDB
    async getDocument(noteId: string): Promise<DocumentAuthority> {
        let doc = this.documents.get(noteId);

        if (!doc) {
            const note = await findPageByIdForCollab(noteId, 'OTService');
            if (!note) throw new Error('Note not found');

            // Start fresh session from persisted version
            doc = {
                version: note.version || 0,
                steps: [],
                lastActivity: new Date(),
                clientIds: new Set(),
                currentDoc: note.content,
                generation: 0,
            };
            this.documents.set(noteId, doc);
        } else if (doc.clientIds.size === 0 && doc.version > 0) {
            // Stale session - reload from database to avoid divergence
            const note = await findPageByIdForCollab(noteId, 'OTService');
            const dbVersion = note?.version || 0;

            // Only reset if database version differs (indicates persistence happened)
            if (dbVersion !== doc.version) {
                doc.version = dbVersion;
                doc.steps = [];
                doc.currentDoc = note?.content;
            }
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
        // SECURITY: Validate user still has access before processing steps
        const connInfo = this.connections.get(clientID);
        if (!connInfo) {
            return {
                version: 0,
                steps: [],
                clientIDs: [],
                resync: true,
            };
        }

        // Verify user still has permission to edit this note (with caching)
        const hasPermission = await this.checkPermission(noteId, connInfo.userId);
        if (!hasPermission) {
            // Remove from permission cache to force fresh check on reconnect
            this.permissionCache.delete(`${connInfo.userId}:${noteId}`);
            return {
                version: 0,
                steps: [],
                clientIDs: [],
                resync: true, // Force client to resync (will fail and disconnect)
            };
        }

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

            // Implement sliding window to prevent unbounded growth
            if (doc.steps.length > MAX_STEPS_IN_MEMORY) {
                const excess = doc.steps.length - MAX_STEPS_IN_MEMORY;
                doc.steps.splice(0, excess);
            }

            doc.version += clientSteps.length;

            // Update current document state if client sent it
            if (clientDoc) {
                doc.currentDoc = clientDoc;
            }

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

    private async persistSteps(noteId: string, _steps: any[], version: number): Promise<void> {
        try {
            const doc = this.documents.get(noteId);
            if (!doc || !doc.currentDoc) {
                return;
            }

            // The currentDoc is already up-to-date because clients send their doc state
            // along with steps. We just need to persist it to MongoDB.
            await updatePageForCollab(
                noteId,
                {
                    version,
                    content: doc.currentDoc,
                },
                'OTService',
            );
        } catch {
            // Don't throw - let collaboration continue even if persistence fails
        }
    }

    private broadcastSteps(noteId: string, steps: any[], version: number, sender: string): void {
        const message = {
            type: 'steps',
            version,
            steps, // Included for broadcast
            clientIDs: Array(steps.length).fill(sender),
        };

        // Use realtime service (WebSocket)
        collabRealtimeService.broadcast(noteId, message, sender);
    }

    // Broadcast new note creation to all clients in the tag
    async broadcastNoteCreated(notebookId: string, note: any): Promise<void> {
        const message = {
            type: 'note-created',
            notebookId,
            note,
        };

        // Broadcast to all clients viewing this tag
        collabRealtimeService.broadcast(notebookId, message);
    }

    addConnection(noteId: string, clientID: string, connection: any): void {
        const doc = this.documents.get(noteId);
        if (doc) {
            doc.clientIds.add(clientID);

            // Clear cleanup timeout when new client connects
            if (doc.cleanupTimeout) {
                clearTimeout(doc.cleanupTimeout);
                doc.cleanupTimeout = undefined;
                doc.generation++; // Increment generation to invalidate any pending cleanups
            }
        }

        // Store userId for permission validation
        if (connection?.userId) {
            this.connections.set(clientID, { userId: connection.userId });
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
                // Clear any existing timeout to prevent memory leak
                if (doc.cleanupTimeout) {
                    clearTimeout(doc.cleanupTimeout);
                }

                const isDev = process.env.NODE_ENV !== 'production';
                const delay = isDev ? CLEANUP_DELAY_DEV : CLEANUP_DELAY_PROD;

                // Capture current generation
                const currentGeneration = doc.generation;

                // Store timeout reference
                doc.cleanupTimeout = setTimeout(() => {
                    const d = this.documents.get(noteId);
                    // Only cleanup if:
                    // 1. Document still exists
                    // 2. No clients connected
                    // 3. Generation hasn't changed (no reconnections happened)
                    if (d && d.clientIds.size === 0 && d.generation === currentGeneration) {
                        this.documents.delete(noteId);
                    }
                }, delay);
            } else {
                // If someone else is still connected, clear the cleanup timeout
                if (doc.cleanupTimeout) {
                    clearTimeout(doc.cleanupTimeout);
                    doc.cleanupTimeout = undefined;
                }
            }
        }

        // Clean up connection info
        this.connections.delete(clientID);

        // Unregister from realtime service
        collabRealtimeService.removeConnection(noteId, clientID);
    }
}

export const otService = new OTService();
