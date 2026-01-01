import {
    updateNoteInternal,
    findNoteByIdInternal,
    findNoteById,
    INTERNAL_CAPABILITY,
} from '../repositories/note.repo';
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

    // Debug helper
    private debug(msg: string, ...args: any[]) {
        console.log(`[OT Service] ${msg}`, ...args);
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
        const note = await findNoteById(noteId, userId);
        const hasAccess = note !== null;

        // Cache result
        this.permissionCache.set(cacheKey, {
            hasAccess,
            expiresAt: Date.now() + PERMISSION_CACHE_TTL,
        });

        console.log(
            `[OT Service] Permission check for user ${userId} on note ${noteId}: ${hasAccess ? 'granted' : 'denied'} (cached for ${PERMISSION_CACHE_TTL / 1000}s)`,
        );

        return hasAccess;
    }

    // Invalidate permission cache for a specific note (call this when permissions change)
    invalidatePermissions(noteId: string): void {
        let invalidated = 0;
        for (const key of this.permissionCache.keys()) {
            if (key.endsWith(`:${noteId}`)) {
                this.permissionCache.delete(key);
                invalidated++;
            }
        }
        if (invalidated > 0) {
            console.log(
                `[OT Service] Invalidated ${invalidated} permission cache entries for note ${noteId}`,
            );
        }
    }

    // Periodic cleanup of expired cache entries
    private cleanupExpiredPermissions(): void {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.permissionCache.entries()) {
            if (entry.expiresAt <= now) {
                this.permissionCache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[OT Service] Cleaned up ${cleaned} expired permission cache entries`);
        }
    }

    // Load document from MongoDB
    async getDocument(noteId: string): Promise<DocumentAuthority> {
        let doc = this.documents.get(noteId);

        if (!doc) {
            const note = await findNoteByIdInternal(noteId, INTERNAL_CAPABILITY, 'OTService');
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
            console.log(
                `[OT Service] Starting new session for note ${noteId} at version ${doc.version}`,
            );
        } else if (doc.clientIds.size === 0 && doc.version > 0) {
            // Stale session - reload from database to avoid divergence
            const note = await findNoteByIdInternal(noteId, INTERNAL_CAPABILITY, 'OTService');
            const dbVersion = note?.version || 0;

            // Only reset if database version differs (indicates persistence happened)
            if (dbVersion !== doc.version) {
                console.log(
                    `[OT Service] Reloading stale session for note ${noteId} from DB (memory: ${doc.version}, DB: ${dbVersion})`,
                );
                doc.version = dbVersion;
                doc.steps = [];
                doc.currentDoc = note?.content;
            } else {
                console.log(
                    `[OT Service] Resuming stale session for note ${noteId} at version ${doc.version}`,
                );
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
            console.error(`[OT Service] No connection info for clientID: ${clientID}`);
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
            console.error(
                `[OT Service] Permission denied for user ${connInfo.userId} on note ${noteId}`,
            );
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

            // Implement sliding window to prevent unbounded growth
            if (doc.steps.length > MAX_STEPS_IN_MEMORY) {
                const excess = doc.steps.length - MAX_STEPS_IN_MEMORY;
                doc.steps.splice(0, excess);
                console.log(
                    `[OT Service] Trimmed ${excess} old steps for note ${noteId} (keeping last ${MAX_STEPS_IN_MEMORY})`,
                );
            }

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
        try {
            const doc = this.documents.get(noteId);
            if (!doc || !doc.currentDoc) {
                console.error(
                    `[OT Service] Cannot persist steps - no document state for ${noteId}`,
                );
                return;
            }

            // The currentDoc is already up-to-date because clients send their doc state
            // along with steps. We just need to persist it to MongoDB.
            await updateNoteInternal(
                noteId,
                {
                    version,
                    content: doc.currentDoc,
                },
                INTERNAL_CAPABILITY,
                'OTService',
            );

            console.log(`[OT Service] Persisted version ${version} for note ${noteId}`);
        } catch (error) {
            console.error(`[OT Service] Failed to persist steps for note ${noteId}:`, error);
            // Don't throw - let collaboration continue even if persistence fails
            // TODO: Queue for retry
        }
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

            // Clear cleanup timeout when new client connects
            if (doc.cleanupTimeout) {
                clearTimeout(doc.cleanupTimeout);
                doc.cleanupTimeout = undefined;
                doc.generation++; // Increment generation to invalidate any pending cleanups
                console.log(
                    `[OT Service] Cancelled cleanup for note ${noteId} - client reconnected (gen ${doc.generation})`,
                );
            }
        }

        // Store userId for permission validation
        if (connection?.userId) {
            this.connections.set(clientID, { userId: connection.userId });
            console.log(
                `[OT Service] Registered connection ${clientID} for user ${connection.userId}`,
            );
        } else {
            console.warn(
                `[OT Service] Connection ${clientID} missing userId - permission checks will fail`,
            );
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
                        console.log(
                            `[OT Service] Cleaned up session for note ${noteId} after last client disconnected (gen ${currentGeneration})`,
                        );
                    } else if (d && d.generation !== currentGeneration) {
                        console.log(
                            `[OT Service] Skipped cleanup for note ${noteId} - generation changed (stale cleanup from gen ${currentGeneration}, current gen ${d.generation})`,
                        );
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
        console.log(`[OT Service] Removed connection ${clientID}`);

        // Unregister from realtime service
        collabRealtimeService.removeConnection(noteId, clientID);
    }
}

export const otService = new OTService();
