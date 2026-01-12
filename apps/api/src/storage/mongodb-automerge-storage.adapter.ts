import { StorageAdapter, StorageKey, Chunk } from '@automerge/automerge-repo';
import { getDb } from '../db/client';
import { Collection, Document } from 'mongodb';

/**
 * MongoDB Storage Adapter for Automerge Repo
 *
 * Persists Automerge document chunks to MongoDB to prevent data loss on server restart.
 * Each chunk is stored separately for efficient incremental loading.
 */

interface AutomergeChunkDocument extends Document {
    documentId: string;
    storageKey: string; // Joined with '/' - Cosmos DB doesn't support arrays in unique keys
    data: Buffer;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date;
}

export class MongoDBAutomergeStorageAdapter extends StorageAdapter {
    private collection: Collection<AutomergeChunkDocument>;
    private ready: Promise<void>;

    constructor() {
        super();
        this.ready = this.initialize();
    }

    private async initialize(): Promise<void> {
        const db = getDb();
        this.collection = db.collection<AutomergeChunkDocument>('automerge_chunks');

        // Create indexes for efficient lookups
        await this.collection.createIndex(
            { documentId: 1, storageKey: 1 },
            { unique: true, name: 'documentId_storageKey_unique' },
        );

        // TTL index for automatic cleanup of orphaned chunks (30 days)
        await this.collection.createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0, name: 'expiresAt_ttl' },
        );

        console.log('[MongoDB Storage] Automerge storage adapter initialized');
    }

    /**
     * Load a single chunk from storage
     */
    async load(key: StorageKey): Promise<Uint8Array | undefined> {
        await this.ready;

        const [documentId, ...rest] = key;
        // Join the storage key path with '/' - Cosmos DB doesn't support arrays in unique keys
        const storageKey = rest.join('/');

        const doc = await this.collection.findOne({
            documentId: documentId as string,
            storageKey,
        });

        if (!doc) {
            return undefined;
        }

        return new Uint8Array(doc.data);
    }

    /**
     * Save a chunk to storage
     */
    async save(key: StorageKey, data: Uint8Array): Promise<void> {
        await this.ready;

        const [documentId, ...rest] = key;
        // Join the storage key path with '/' - Cosmos DB doesn't support arrays in unique keys
        const storageKey = rest.join('/');

        const now = new Date();

        try {
            await this.collection.updateOne(
                {
                    documentId: documentId as string,
                    storageKey,
                },
                {
                    $set: {
                        data: Buffer.from(data),
                        updatedAt: now,
                    },
                    $setOnInsert: {
                        createdAt: now,
                    },
                },
                { upsert: true },
            );
        } catch (error: any) {
            // Handle duplicate key errors gracefully (race condition on upsert)
            // If another process already saved this exact key, that's fine - the data is persisted
            if (error.code === 11000) {
                // Duplicate key - document already exists with this key, treat as success
                console.log(
                    `[MongoDB Storage] Duplicate key on save (race condition) - document already saved: ${documentId}/${storageKey}`,
                );
                return;
            }
            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Load all chunks matching a key prefix (for loading entire documents)
     */
    async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
        await this.ready;

        const documentId = keyPrefix[0] as string;

        const docs = await this.collection
            .find({
                documentId,
            })
            .toArray();

        return docs.map((doc) => {
            // Split storageKey back to array (it was joined with '/')
            const keyParts = doc.storageKey ? doc.storageKey.split('/') : [];
            return {
                key: [documentId, ...keyParts] as StorageKey,
                data: new Uint8Array(doc.data),
            };
        });
    }

    /**
     * Remove a single chunk from storage
     */
    async remove(key: StorageKey): Promise<void> {
        await this.ready;

        const [documentId, ...rest] = key;
        // Join the storage key path with '/' - Cosmos DB doesn't support arrays in unique keys
        const storageKey = rest.join('/');

        await this.collection.deleteOne({
            documentId: documentId as string,
            storageKey,
        });
    }

    /**
     * Remove all chunks matching a key prefix (for deleting entire documents)
     */
    async removeRange(keyPrefix: StorageKey): Promise<void> {
        await this.ready;

        const documentId = keyPrefix[0] as string;

        await this.collection.deleteMany({
            documentId,
        });
    }
}
