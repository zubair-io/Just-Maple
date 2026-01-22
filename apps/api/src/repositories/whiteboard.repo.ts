import { ObjectId, Collection, Binary } from 'mongodb';
import { getDb } from '../db/client';

interface WhiteboardDocument {
    _id: ObjectId;
    id: string; // id of the parent page
    state: Binary; // Y.Doc encoded state
    version: number;
    updatedAt: Date;
}

export interface Whiteboard {
    _id: string;
    id: string;
    state: Uint8Array;
    version: number;
    updatedAt: string;
}

function getCollection(): Collection<WhiteboardDocument> {
    return getDb().collection<WhiteboardDocument>('whiteboards');
}

function toWhiteboardResponse(doc: WhiteboardDocument): Whiteboard {
    return {
        _id: doc._id.toString(),
        id: doc.id,
        state: new Uint8Array(doc.state.buffer),
        version: doc.version,
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Create a new whiteboard document
 */
export async function createWhiteboard(id: string, state: Uint8Array): Promise<Whiteboard> {
    const now = new Date();

    const doc: Omit<WhiteboardDocument, '_id'> = {
        id,
        state: new Binary(Buffer.from(state)),
        version: 1,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as WhiteboardDocument);

    return {
        _id: result.insertedId.toString(),
        id,
        state,
        version: 1,
        updatedAt: now.toISOString(),
    };
}

/**
 * Find whiteboard by its id (client-generated UUID)
 */
export async function findWhiteboard(id: string): Promise<Whiteboard | null> {
    try {
        const doc = await getCollection().findOne({ id });
        if (!doc) return null;
        return toWhiteboardResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Check if whiteboard exists for a given id
 */
export async function whiteboardExists(id: string): Promise<boolean> {
    try {
        const count = await getCollection().countDocuments({ id }, { limit: 1 });
        return count > 0;
    } catch {
        return false;
    }
}

/**
 * Get whiteboard state as Uint8Array
 */
export async function getWhiteboardState(id: string): Promise<Uint8Array | null> {
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

/**
 * Update whiteboard Y.Doc state (for internal YJS service)
 */
export async function updateWhiteboardState(
    id: string,
    state: Uint8Array,
): Promise<Whiteboard | null> {
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
            },
        },
        { returnDocument: 'after', upsert: true },
    );

    return result ? toWhiteboardResponse(result) : null;
}

/**
 * Delete whiteboard (cascade from page deletion)
 */
export async function deleteWhiteboard(id: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ id });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Get only the version number (for cache validation)
 */
export async function getWhiteboardVersion(id: string): Promise<number | null> {
    try {
        const doc = await getCollection().findOne({ id }, { projection: { version: 1 } });
        return doc?.version ?? null;
    } catch {
        return null;
    }
}
