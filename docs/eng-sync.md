# Engineering: Sync & Offline

Just Maple uses CRDTs (Automerge and Yjs) for offline-first synchronization. This document covers the implementation.

## Architecture

```mermaid
graph TB
    subgraph Client
        App[Application]
        Local[(IndexedDB)]
        Queue[Offline Queue]
        SyncService[Sync Service]
    end

    subgraph Server
        WS[WebSocket]
        API[REST API]
        DB[(MongoDB)]
    end

    App --> Local
    App --> Queue
    SyncService --> Local
    SyncService --> Queue
    SyncService --> WS
    SyncService --> API
    WS --> DB
    API --> DB
```

## CRDT Strategy

### Automerge for Documents

- Rich text content stored as Automerge documents
- Character-level CRDT for text operations
- Automatic merge resolution

### Yjs for Real-time

- Y.js provides awareness (cursors, selections)
- WebSocket provider for live updates
- Compatible with TipTap

## Offline Queue

### Queue Service

```typescript
// apps/web/src/app/services/offline-queue.service.ts
interface QueuedAction {
    id: string;
    type: 'create' | 'update' | 'delete';
    collection: string;
    documentId: string;
    payload: any;
    createdAt: number;
    retryCount: number;
}

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
    private queue = signal<QueuedAction[]>([]);
    private isProcessing = signal(false);
    private isOnline = signal(navigator.onLine);

    readonly pendingCount = computed(() => this.queue().length);
    readonly status = computed(() => {
        if (!this.isOnline()) return 'offline';
        if (this.isProcessing()) return 'syncing';
        if (this.queue().length > 0) return 'pending';
        return 'synced';
    });

    constructor(private idb: IndexedDBService) {
        // Listen for online/offline events
        window.addEventListener('online', () => this.onOnline());
        window.addEventListener('offline', () => this.isOnline.set(false));

        // Load queue from IndexedDB on startup
        this.loadQueue();
    }

    async enqueue(action: Omit<QueuedAction, 'id' | 'createdAt' | 'retryCount'>): Promise<void> {
        const queuedAction: QueuedAction = {
            ...action,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            retryCount: 0,
        };

        // Add to memory queue
        this.queue.update((q) => [...q, queuedAction]);

        // Persist to IndexedDB
        await this.idb.put('offlineQueue', queuedAction);

        // Try to process if online
        if (this.isOnline()) {
            this.processQueue();
        }
    }

    private async onOnline(): Promise<void> {
        this.isOnline.set(true);
        await this.processQueue();
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing() || this.queue().length === 0) {
            return;
        }

        this.isProcessing.set(true);

        try {
            const queue = [...this.queue()];

            for (const action of queue) {
                try {
                    await this.executeAction(action);

                    // Remove from queue on success
                    this.queue.update((q) => q.filter((a) => a.id !== action.id));
                    await this.idb.delete('offlineQueue', action.id);
                } catch (error) {
                    // Retry with exponential backoff
                    if (action.retryCount < 5) {
                        const delay = Math.pow(2, action.retryCount) * 1000;
                        action.retryCount++;
                        await this.idb.put('offlineQueue', action);
                        await this.delay(delay);
                    } else {
                        // Move to failed queue
                        await this.moveToFailed(action, error);
                    }
                }
            }
        } finally {
            this.isProcessing.set(false);
        }
    }

    private async executeAction(action: QueuedAction): Promise<void> {
        switch (action.type) {
            case 'create':
                await firstValueFrom(this.http.post(`/api/${action.collection}`, action.payload));
                break;
            case 'update':
                await firstValueFrom(
                    this.http.put(`/api/${action.collection}/${action.documentId}`, action.payload),
                );
                break;
            case 'delete':
                await firstValueFrom(
                    this.http.delete(`/api/${action.collection}/${action.documentId}`),
                );
                break;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async loadQueue(): Promise<void> {
        const stored = await this.idb.getAll('offlineQueue');
        this.queue.set(stored);
    }
}
```

## Document Sync Service

### Automerge Sync

```typescript
// apps/web/src/app/services/memo-sync.service.ts
import * as Automerge from '@automerge/automerge';

@Injectable()
export class MemoSyncService {
    private syncStates = new Map<string, Automerge.SyncState>();
    private documents = new Map<string, Automerge.Doc<any>>();

    constructor(
        private idb: IndexedDBService,
        private ws: WebSocketService,
    ) {
        this.ws.onMessage('sync').subscribe((msg) => this.handleSyncMessage(msg));
    }

    async initDocument(noteId: string): Promise<Automerge.Doc<any>> {
        // Load from local storage first
        const localBinary = await this.idb.get('memos', noteId);

        let doc: Automerge.Doc<any>;
        if (localBinary) {
            doc = Automerge.load(localBinary);
        } else {
            doc = Automerge.init();
        }

        this.documents.set(noteId, doc);
        this.syncStates.set(noteId, Automerge.initSyncState());

        // Start sync with server
        this.requestSync(noteId);

        return doc;
    }

    applyLocalChange(noteId: string, changeFn: (doc: any) => void): void {
        const doc = this.documents.get(noteId);
        if (!doc) return;

        const newDoc = Automerge.change(doc, changeFn);
        this.documents.set(noteId, newDoc);

        // Persist locally
        this.persistLocally(noteId, newDoc);

        // Sync to server
        this.sendChanges(noteId);
    }

    private async persistLocally(noteId: string, doc: Automerge.Doc<any>): Promise<void> {
        const binary = Automerge.save(doc);
        await this.idb.put('memos', binary, noteId);
    }

    private sendChanges(noteId: string): void {
        const doc = this.documents.get(noteId)!;
        const syncState = this.syncStates.get(noteId)!;

        const [newSyncState, message] = Automerge.generateSyncMessage(doc, syncState);
        this.syncStates.set(noteId, newSyncState);

        if (message) {
            this.ws.send({
                type: 'sync',
                noteId,
                message: this.encodeMessage(message),
            });
        }
    }

    private handleSyncMessage(msg: { noteId: string; message: string }): void {
        const doc = this.documents.get(msg.noteId);
        const syncState = this.syncStates.get(msg.noteId);
        if (!doc || !syncState) return;

        const decoded = this.decodeMessage(msg.message);
        const [newDoc, newSyncState] = Automerge.receiveSyncMessage(doc, syncState, decoded);

        this.documents.set(msg.noteId, newDoc);
        this.syncStates.set(msg.noteId, newSyncState);

        // Persist updated document
        this.persistLocally(msg.noteId, newDoc);

        // Continue sync if needed
        this.sendChanges(msg.noteId);
    }

    private requestSync(noteId: string): void {
        this.ws.send({
            type: 'requestSync',
            noteId,
        });
    }

    private encodeMessage(message: Uint8Array): string {
        return btoa(String.fromCharCode(...message));
    }

    private decodeMessage(encoded: string): Uint8Array {
        return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    }
}
```

## Conflict Resolution

### Version Tracking

```typescript
// apps/api/src/repositories/memo.repo.ts
export async function applyChangesWithConflictCheck(
    noteId: string,
    changes: Uint8Array[],
    clientHeads: string[],
): Promise<{ success: boolean; merged: boolean; newHeads: string[] }> {
    const memo = await db.collection('memos').findOne({ noteId });

    if (!memo) {
        // New document
        const doc = Automerge.init();
        const [merged] = Automerge.applyChanges(doc, changes);
        await saveMemo(noteId, merged);
        return { success: true, merged: false, newHeads: Automerge.getHeads(merged) };
    }

    const serverDoc = Automerge.load(memo.state.buffer);
    const serverHeads = Automerge.getHeads(serverDoc);

    // Check if client is in sync
    const isInSync = clientHeads.every((h) => serverHeads.includes(h));

    if (isInSync) {
        // Fast-forward merge
        const [merged] = Automerge.applyChanges(serverDoc, changes);
        await saveMemo(noteId, merged);
        return { success: true, merged: false, newHeads: Automerge.getHeads(merged) };
    }

    // Concurrent changes - merge
    const [merged] = Automerge.applyChanges(serverDoc, changes);
    await saveMemo(noteId, merged);
    return { success: true, merged: true, newHeads: Automerge.getHeads(merged) };
}
```

### Client-Side Merge

```typescript
// apps/web/src/app/services/conflict-resolution.service.ts
@Injectable()
export class ConflictResolutionService {
    async resolveConflict<T>(
        localDoc: Automerge.Doc<T>,
        serverDoc: Automerge.Doc<T>,
    ): Promise<Automerge.Doc<T>> {
        // Automerge handles most conflicts automatically
        const merged = Automerge.merge(localDoc, serverDoc);
        return merged;
    }

    detectConflicts<T>(doc: Automerge.Doc<T>): ConflictInfo[] {
        const conflicts: ConflictInfo[] = [];

        // Check for conflicting heads
        const heads = Automerge.getHeads(doc);
        if (heads.length > 1) {
            // Multiple heads indicate divergent history
            conflicts.push({
                type: 'divergent-history',
                heads,
            });
        }

        return conflicts;
    }
}
```

## IndexedDB Storage

### Database Schema

```typescript
// apps/web/src/app/services/indexed-db.service.ts
const DB_SCHEMA = {
    name: 'justmaple',
    version: 1,
    stores: [
        {
            name: 'memos',
            keyPath: 'noteId',
        },
        {
            name: 'pages',
            keyPath: 'id',
            indexes: [
                { name: 'notebookId', keyPath: 'notebookId' },
                { name: 'updatedAt', keyPath: 'updatedAt' },
            ],
        },
        {
            name: 'offlineQueue',
            keyPath: 'id',
            indexes: [{ name: 'createdAt', keyPath: 'createdAt' }],
        },
        {
            name: 'syncState',
            keyPath: 'noteId',
        },
    ],
};

@Injectable({ providedIn: 'root' })
export class IndexedDBService {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_SCHEMA.name, DB_SCHEMA.version);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                for (const store of DB_SCHEMA.stores) {
                    if (!db.objectStoreNames.contains(store.name)) {
                        const objectStore = db.createObjectStore(store.name, {
                            keyPath: store.keyPath,
                        });

                        for (const index of store.indexes || []) {
                            objectStore.createIndex(index.name, index.keyPath);
                        }
                    }
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    async put<T>(store: string, value: T, key?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readwrite');
            const objectStore = tx.objectStore(store);
            const request = key ? objectStore.put(value, key) : objectStore.put(value);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async get<T>(store: string, key: string): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readonly');
            const request = tx.objectStore(store).get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll<T>(store: string): Promise<T[]> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readonly');
            const request = tx.objectStore(store).getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(store: string, key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readwrite');
            const request = tx.objectStore(store).delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}
```

## Sync Status Component

```typescript
// apps/web/src/app/components/atoms/sync-status/sync-status.component.ts
@Component({
    selector: 'app-sync-status',
    template: `
        <div class="sync-status" [class]="status()">
            @switch (status()) {
                @case ('synced') {
                    <app-icon name="check-circle" />
                    <span>Synced</span>
                }
                @case ('syncing') {
                    <app-icon name="refresh" class="animate-spin" />
                    <span>Syncing...</span>
                }
                @case ('pending') {
                    <app-icon name="clock" />
                    <span>{{ pendingCount() }} pending</span>
                }
                @case ('offline') {
                    <app-icon name="wifi-off" />
                    <span>Offline</span>
                }
                @case ('conflict') {
                    <app-icon name="alert-triangle" />
                    <span>Conflict</span>
                }
                @case ('error') {
                    <app-icon name="x-circle" />
                    <span>Sync failed</span>
                }
            }
        </div>
    `,
})
export class SyncStatusComponent {
    private offlineQueue = inject(OfflineQueueService);

    readonly status = this.offlineQueue.status;
    readonly pendingCount = this.offlineQueue.pendingCount;
}
```

## Server-Side Sync Handler

```typescript
// apps/api/src/routes/ws.routes.ts
export function handleWebSocket(ws: ServerWebSocket<WsData>) {
    ws.subscribe(`user:${ws.data.userId}`);

    return {
        message: async (ws: ServerWebSocket<WsData>, message: string) => {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'joinRoom':
                    ws.subscribe(`memo:${data.noteId}`);
                    break;

                case 'leaveRoom':
                    ws.unsubscribe(`memo:${data.noteId}`);
                    break;

                case 'sync':
                    const result = await applyChangesWithConflictCheck(
                        data.noteId,
                        decodeChanges(data.changes),
                        data.heads,
                    );

                    // Broadcast to other clients
                    server.publish(
                        `memo:${data.noteId}`,
                        JSON.stringify({
                            type: 'sync',
                            noteId: data.noteId,
                            changes: data.changes,
                            sender: ws.data.userId,
                        }),
                        true,
                    );

                    // Send ack to sender
                    ws.send(
                        JSON.stringify({
                            type: 'syncAck',
                            noteId: data.noteId,
                            success: result.success,
                            merged: result.merged,
                            newHeads: result.newHeads,
                        }),
                    );
                    break;

                case 'requestSync':
                    const memo = await getMemoState(data.noteId);
                    ws.send(
                        JSON.stringify({
                            type: 'fullSync',
                            noteId: data.noteId,
                            state: encodeState(memo),
                        }),
                    );
                    break;
            }
        },
    };
}
```

## Related Documentation

- [Feature: Offline Support](./feature-offline.md) - User documentation
- [Engineering: Realtime](./eng-realtime.md) - WebSocket implementation
- [Architecture](./architecture.md) - System overview
