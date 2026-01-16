import { ObjectId, Collection, Binary } from 'mongodb';
import { getDb } from '../db/client';
import type { Notebook, CreateNotebookInput } from '@maple/shared';

interface NotebookDocument {
    _id: ObjectId;
    noteId: string; // documentId of the parent note
    state: Binary; // Y.Doc encoded state
    version: number;
    updatedAt: Date;
}

function getCollection(): Collection<NotebookDocument> {
    return getDb().collection<NotebookDocument>('notebooks');
}

function toNotebookResponse(doc: NotebookDocument): Notebook {
    return {
        _id: doc._id.toString(),
        noteId: doc.noteId,
        state: doc.state.buffer, // Convert Binary to Buffer/Uint8Array
        version: doc.version,
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Create a new notebook document
 * Called when syncing an offline-created notebook to server
 */
export async function createNotebook(input: CreateNotebookInput): Promise<Notebook> {
    const now = new Date();

    // Convert state to Binary for MongoDB storage
    const stateBuffer =
        input.state instanceof Uint8Array ? input.state : new Uint8Array(input.state as any);

    const doc: Omit<NotebookDocument, '_id'> = {
        noteId: input.noteId,
        state: new Binary(Buffer.from(stateBuffer)),
        version: 1,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as NotebookDocument);

    return {
        _id: result.insertedId.toString(),
        noteId: doc.noteId,
        state: stateBuffer,
        version: doc.version,
        updatedAt: now.toISOString(),
    };
}

/**
 * Find notebook by the parent note's documentId
 */
export async function findNotebookByNoteId(noteId: string): Promise<Notebook | null> {
    try {
        const doc = await getCollection().findOne({ noteId });
        if (!doc) return null;
        return toNotebookResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Update notebook Y.Doc state
 * Called on each sync from client
 */
export async function updateNotebookState(
    noteId: string,
    state: Uint8Array,
    version: number,
): Promise<Notebook | null> {
    try {
        const result = await getCollection().findOneAndUpdate(
            { noteId },
            {
                $set: {
                    state: new Binary(Buffer.from(state)),
                    version,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );

        return result ? toNotebookResponse(result) : null;
    } catch (e) {
        console.error('Error updating notebook state:', e);
        return null;
    }
}

/**
 * Upsert notebook - create if doesn't exist, update if exists
 * Useful for initial sync of offline-created notebooks
 */
export async function upsertNotebook(
    noteId: string,
    state: Uint8Array,
    version?: number,
): Promise<Notebook> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { noteId },
        {
            $set: {
                state: new Binary(Buffer.from(state)),
                updatedAt: now,
            },
            $inc: { version: 1 },
            $setOnInsert: {
                noteId,
            },
        },
        {
            upsert: true,
            returnDocument: 'after',
        },
    );

    if (!result) {
        throw new Error('Failed to upsert notebook');
    }

    return toNotebookResponse(result);
}

/**
 * Get only the version number (for cache validation)
 */
export async function getNotebookVersion(noteId: string): Promise<number | null> {
    try {
        const doc = await getCollection().findOne({ noteId }, { projection: { version: 1 } });
        return doc?.version ?? null;
    } catch {
        return null;
    }
}

/**
 * Delete notebook (cascade from note deletion)
 */
export async function deleteNotebook(noteId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ noteId });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Check if notebook exists for a given noteId
 */
export async function notebookExists(noteId: string): Promise<boolean> {
    try {
        const count = await getCollection().countDocuments({ noteId }, { limit: 1 });
        return count > 0;
    } catch {
        return false;
    }
}

/**
 * Get notebook state as Uint8Array (convenience method)
 */
export async function getNotebookState(noteId: string): Promise<Uint8Array | null> {
    try {
        const doc = await getCollection().findOne({ noteId }, { projection: { state: 1 } });
        if (!doc) return null;

        // Convert Binary back to Uint8Array
        const buffer = doc.state.buffer;
        return new Uint8Array(buffer);
    } catch {
        return null;
    }
}

// Internal function for YJS document service (bypasses some checks)
const INTERNAL_CAPABILITY = Symbol('notebook.repo.internal');
const ALLOWED_INTERNAL_CALLERS = new Set(['YJSDocumentService']);

/**
 * Update notebook state without version checks (for internal YJS service)
 */
export async function updateNotebookStateInternal(
    noteId: string,
    state: Uint8Array,
    capability: symbol,
    caller: string,
): Promise<Notebook | null> {
    if (capability !== INTERNAL_CAPABILITY) {
        console.error(`[SECURITY] Unauthorized call to updateNotebookStateInternal from ${caller}`);
        throw new Error('Unauthorized: Invalid capability token');
    }

    if (!ALLOWED_INTERNAL_CALLERS.has(caller)) {
        console.warn(`[SECURITY] Unexpected caller "${caller}" for updateNotebookStateInternal`);
    }

    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { noteId },
        {
            $set: {
                state: new Binary(Buffer.from(state)),
                updatedAt: now,
            },
            $inc: { version: 1 },
        },
        { returnDocument: 'after', upsert: true },
    );

    return result ? toNotebookResponse(result) : null;
}

/**
 * Wrapper for YJS Document Service
 */
export async function updateNotebookForYJS(
    noteId: string,
    state: Uint8Array,
): Promise<Notebook | null> {
    return updateNotebookStateInternal(noteId, state, INTERNAL_CAPABILITY, 'YJSDocumentService');
}
