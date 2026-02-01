import { ObjectId, Collection, Binary } from 'mongodb';
import { getDb } from '../db/client';
import type { KanbanSettings } from '@maple/shared';

interface KanbanBoardDocument {
    _id: ObjectId;
    id: string; // Same as page.id - UUID for routing
    pageId: string; // Links to pages collection
    notebookId: string; // Denormalized for queries

    state: Binary; // Y.Doc encoded state
    version: number;
    settings: KanbanSettings;

    createdAt: Date;
    updatedAt: Date;
}

export interface KanbanBoardResponse {
    _id: string;
    id: string;
    pageId: string;
    notebookId: string;
    state: Uint8Array;
    version: number;
    settings: KanbanSettings;
    createdAt: string;
    updatedAt: string;
}

function getCollection(): Collection<KanbanBoardDocument> {
    return getDb().collection<KanbanBoardDocument>('kanban_boards');
}

function toKanbanBoardResponse(doc: KanbanBoardDocument): KanbanBoardResponse {
    return {
        _id: doc._id.toString(),
        id: doc.id,
        pageId: doc.pageId,
        notebookId: doc.notebookId,
        state: new Uint8Array(doc.state.buffer),
        version: doc.version,
        settings: doc.settings,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

// Default settings imported from shared
const defaultSettings: KanbanSettings = {
    defaultLaneId: undefined,
    cardDisplay: {
        showDueDate: true,
        showPriority: true,
        showCoverColor: false,
    },
    doneReset: {
        period: 'weekly',
        dayOfWeek: 1,
    },
};

/**
 * Create a new kanban board document
 */
export async function createKanbanBoard(
    id: string,
    pageId: string,
    notebookId: string,
    state: Uint8Array,
    settings?: Partial<KanbanSettings>,
): Promise<KanbanBoardResponse> {
    const now = new Date();

    const doc: Omit<KanbanBoardDocument, '_id'> = {
        id,
        pageId,
        notebookId,
        state: new Binary(Buffer.from(state)),
        version: 1,
        settings: { ...defaultSettings, ...settings },
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as KanbanBoardDocument);

    return {
        _id: result.insertedId.toString(),
        id,
        pageId,
        notebookId,
        state,
        version: 1,
        settings: doc.settings,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Find kanban board by its id (same as page.id UUID)
 */
export async function findKanbanBoard(id: string): Promise<KanbanBoardResponse | null> {
    try {
        const doc = await getCollection().findOne({ id });
        if (!doc) return null;
        return toKanbanBoardResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Find kanban board by pageId
 */
export async function findKanbanBoardByPageId(pageId: string): Promise<KanbanBoardResponse | null> {
    try {
        const doc = await getCollection().findOne({ pageId });
        if (!doc) return null;
        return toKanbanBoardResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Check if kanban board exists for a given id
 */
export async function kanbanBoardExists(id: string): Promise<boolean> {
    try {
        const count = await getCollection().countDocuments({ id }, { limit: 1 });
        return count > 0;
    } catch {
        return false;
    }
}

/**
 * Get kanban board state as Uint8Array
 */
export async function getKanbanBoardState(id: string): Promise<Uint8Array | null> {
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
 * Update kanban board Y.Doc state (for internal YJS service)
 */
export async function updateKanbanBoardState(
    id: string,
    state: Uint8Array,
): Promise<KanbanBoardResponse | null> {
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
        { returnDocument: 'after' },
    );

    return result ? toKanbanBoardResponse(result) : null;
}

/**
 * Upsert kanban board - create if doesn't exist, update if exists
 * Useful for initial sync of offline-created boards
 */
export async function upsertKanbanBoard(
    id: string,
    pageId: string,
    notebookId: string,
    state: Uint8Array,
    settings?: Partial<KanbanSettings>,
): Promise<KanbanBoardResponse> {
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
                notebookId,
                settings: { ...defaultSettings, ...settings },
                createdAt: now,
            },
        },
        {
            upsert: true,
            returnDocument: 'after',
        },
    );

    if (!result) {
        throw new Error('Failed to upsert kanban board');
    }

    return toKanbanBoardResponse(result);
}

/**
 * Update kanban board settings
 */
export async function updateKanbanBoardSettings(
    id: string,
    settings: Partial<KanbanSettings>,
): Promise<KanbanBoardResponse | null> {
    const now = new Date();

    // Build update object for nested settings
    const updateFields: Record<string, unknown> = {
        updatedAt: now,
    };

    if (settings.defaultLaneId !== undefined) {
        updateFields['settings.defaultLaneId'] = settings.defaultLaneId;
    }
    if (settings.cardDisplay) {
        if (settings.cardDisplay.showDueDate !== undefined) {
            updateFields['settings.cardDisplay.showDueDate'] = settings.cardDisplay.showDueDate;
        }
        if (settings.cardDisplay.showPriority !== undefined) {
            updateFields['settings.cardDisplay.showPriority'] = settings.cardDisplay.showPriority;
        }
        if (settings.cardDisplay.showCoverColor !== undefined) {
            updateFields['settings.cardDisplay.showCoverColor'] =
                settings.cardDisplay.showCoverColor;
        }
    }
    if (settings.doneReset) {
        if (settings.doneReset.period !== undefined) {
            updateFields['settings.doneReset.period'] = settings.doneReset.period;
        }
        if (settings.doneReset.dayOfWeek !== undefined) {
            updateFields['settings.doneReset.dayOfWeek'] = settings.doneReset.dayOfWeek;
        }
        if (settings.doneReset.dayOfMonth !== undefined) {
            updateFields['settings.doneReset.dayOfMonth'] = settings.doneReset.dayOfMonth;
        }
    }

    const result = await getCollection().findOneAndUpdate(
        { id },
        { $set: updateFields },
        { returnDocument: 'after' },
    );

    return result ? toKanbanBoardResponse(result) : null;
}

/**
 * Delete kanban board (cascade from page deletion)
 */
export async function deleteKanbanBoard(id: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ id });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Delete kanban board by pageId
 */
export async function deleteKanbanBoardByPageId(pageId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ pageId });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Get only the version number (for cache validation)
 */
export async function getKanbanBoardVersion(id: string): Promise<number | null> {
    try {
        const doc = await getCollection().findOne({ id }, { projection: { version: 1 } });
        return doc?.version ?? null;
    } catch {
        return null;
    }
}

/**
 * Find all kanban boards in a notebook
 */
export async function findKanbanBoardsByNotebook(
    notebookId: string,
): Promise<KanbanBoardResponse[]> {
    try {
        const docs = await getCollection().find({ notebookId }).toArray();
        return docs.map(toKanbanBoardResponse);
    } catch {
        return [];
    }
}
