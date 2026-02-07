import { ObjectId, Collection, Binary } from 'mongodb';
import { getDb } from '../db/client';
import type { Memo, CreateMemoInput } from '@maple/shared';

interface MemoDocument {
    _id: ObjectId;
    id: string; // Unique memo identifier (UUID v4)
    pageId: string; // Parent page ID (non-unique for kanban card memos)
    state: Binary; // Y.Doc encoded state
    version: number;
    updatedAt: Date;
}

function getCollection(): Collection<MemoDocument> {
    return getDb().collection<MemoDocument>('memos');
}

function toMemoResponse(doc: MemoDocument): Memo {
    return {
        _id: doc._id.toString(),
        id: doc.id,
        pageId: doc.pageId,
        state: doc.state.buffer, // Convert Binary to Buffer/Uint8Array
        version: doc.version,
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Create a new memo document
 * Called when syncing an offline-created memo to server
 */
export async function createMemo(input: CreateMemoInput): Promise<Memo> {
    const now = new Date();

    // Convert state to Binary for MongoDB storage
    const stateBuffer =
        input.state instanceof Uint8Array ? input.state : new Uint8Array(input.state as any);

    const doc: Omit<MemoDocument, '_id'> = {
        id: input.id,
        pageId: input.pageId,
        state: new Binary(Buffer.from(stateBuffer)),
        version: 1,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as MemoDocument);

    return {
        _id: result.insertedId.toString(),
        id: doc.id,
        pageId: doc.pageId,
        state: stateBuffer,
        version: doc.version,
        updatedAt: now.toISOString(),
    };
}

/**
 * Find memo by its unique id
 */
export async function findMemoById(id: string): Promise<Memo | null> {
    try {
        const doc = await getCollection().findOne({ id });
        if (!doc) return null;
        return toMemoResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Find memo by pageId (parent page ID)
 * For regular memos (1:1 with page), this returns the single memo.
 */
export async function findMemoByPageId(pageId: string): Promise<Memo | null> {
    try {
        const doc = await getCollection().findOne({ pageId });
        if (!doc) return null;
        return toMemoResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Update memo Y.Doc state
 * Called on each sync from client
 */
export async function updateMemoState(
    id: string,
    state: Uint8Array,
    version: number,
): Promise<Memo | null> {
    try {
        const result = await getCollection().findOneAndUpdate(
            { id },
            {
                $set: {
                    state: new Binary(Buffer.from(state)),
                    version,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );

        return result ? toMemoResponse(result) : null;
    } catch (e) {
        console.error('Error updating memo state:', e);
        return null;
    }
}

/**
 * Upsert memo - create if doesn't exist, update if exists
 * Useful for initial sync of offline-created memos
 */
export async function upsertMemo(
    id: string,
    pageId: string,
    state: Uint8Array,
    version?: number,
): Promise<Memo> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id },
        {
            $set: {
                state: new Binary(Buffer.from(state)),
                updatedAt: now,
            },
            $inc: { version: 1 },
            $setOnInsert: {
                id,
                pageId,
            },
        },
        {
            upsert: true,
            returnDocument: 'after',
        },
    );

    if (!result) {
        throw new Error('Failed to upsert memo');
    }

    return toMemoResponse(result);
}

/**
 * Get only the version number (for cache validation)
 */
export async function getMemoVersion(id: string): Promise<number | null> {
    try {
        const doc = await getCollection().findOne({ id }, { projection: { version: 1 } });
        return doc?.version ?? null;
    } catch {
        return null;
    }
}

/**
 * Delete memo by its unique id
 */
export async function deleteMemo(id: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ id });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Find all memos with a given pageId (parent page ID)
 * Used to find all card memos for a kanban page
 */
export async function findMemosByPageId(pageId: string): Promise<Memo[]> {
    try {
        const docs = await getCollection().find({ pageId }).toArray();
        return docs.map(toMemoResponse);
    } catch {
        return [];
    }
}

/**
 * Find all memos with pageIds in the given list (batch query)
 * Used to find card memos for multiple kanban pages without N+1
 */
export async function findMemosByPageIds(pageIds: string[]): Promise<Memo[]> {
    try {
        const docs = await getCollection()
            .find({ pageId: { $in: pageIds } })
            .toArray();
        return docs.map(toMemoResponse);
    } catch {
        return [];
    }
}

/**
 * Delete all memos with a given pageId (parent page ID)
 * Used for cascade delete when a kanban page is deleted
 */
export async function deleteMemosByPageId(pageId: string): Promise<number> {
    try {
        const result = await getCollection().deleteMany({ pageId });
        return result.deletedCount;
    } catch {
        return 0;
    }
}

/**
 * Check if memo exists for a given id
 */
export async function memoExists(id: string): Promise<boolean> {
    try {
        const count = await getCollection().countDocuments({ id }, { limit: 1 });
        return count > 0;
    } catch {
        return false;
    }
}

/**
 * Get memo state as Uint8Array (convenience method)
 */
export async function getMemoState(id: string): Promise<Uint8Array | null> {
    try {
        const doc = await getCollection().findOne({ id }, { projection: { state: 1 } });
        if (!doc) return null;

        // Convert Binary back to Uint8Array
        const buffer = doc.state.buffer;
        return new Uint8Array(buffer);
    } catch {
        return null;
    }
}

// Internal function for YJS document service (bypasses some checks)
const INTERNAL_CAPABILITY = Symbol('memo.repo.internal');
const ALLOWED_INTERNAL_CALLERS = new Set(['YJSDocumentService']);

/**
 * Update memo state without version checks (for internal YJS service)
 */
export async function updateMemoStateInternal(
    id: string,
    state: Uint8Array,
    capability: symbol,
    caller: string,
): Promise<Memo | null> {
    if (capability !== INTERNAL_CAPABILITY) {
        console.error(`[SECURITY] Unauthorized call to updateMemoStateInternal from ${caller}`);
        throw new Error('Unauthorized: Invalid capability token');
    }

    if (!ALLOWED_INTERNAL_CALLERS.has(caller)) {
        console.warn(`[SECURITY] Unexpected caller "${caller}" for updateMemoStateInternal`);
    }

    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id },
        {
            $set: {
                state: new Binary(Buffer.from(state)),
                updatedAt: now,
            },
            $inc: { version: 1 },
        },
        { returnDocument: 'after', upsert: true },
    );

    return result ? toMemoResponse(result) : null;
}

/**
 * Wrapper for YJS Document Service
 */
export async function updateMemoForYJS(id: string, state: Uint8Array): Promise<Memo | null> {
    return updateMemoStateInternal(id, state, INTERNAL_CAPABILITY, 'YJSDocumentService');
}
