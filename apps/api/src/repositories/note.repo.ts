import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Note,
    NoteContent,
    CreateNoteInput,
    UpdateNoteInput,
    DEFAULT_NOTE_CONTENT,
} from '@maple/shared';

interface NoteDocument {
    _id: ObjectId;
    userId: ObjectId;
    title: string;
    content: NoteContent;
    version: number;
    tagId?: ObjectId;
    isFavorite?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    trashedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<NoteDocument> {
    return getDb().collection<NoteDocument>('notes');
}

function toNoteResponse(doc: NoteDocument): Note {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        title: doc.title,
        content: doc.content,
        version: doc.version,
        tagId: doc.tagId?.toString(),
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        trashedAt: doc.trashedAt?.toISOString(),
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

const defaultContent: NoteContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [] }],
};

export async function findNotesByUserId(
    userId: string,
    options?: {
        tagId?: string;
        isFavorite?: boolean;
        isTrashed?: boolean;
        isArchived?: boolean;
    },
): Promise<Note[]> {
    const query: Record<string, unknown> = {
        userId: new ObjectId(userId),
        isTrashed: { $ne: true },
    };

    if (options?.tagId) {
        query.tagId = new ObjectId(options.tagId);
    }
    if (options?.isFavorite !== undefined) {
        query.isFavorite = options.isFavorite;
    }
    if (options?.isTrashed !== undefined) {
        query.isTrashed = options.isTrashed;
    }
    if (options?.isArchived !== undefined) {
        query.isArchived = options.isArchived;
    }

    const docs = await getCollection().find(query).sort({ updatedAt: -1 }).toArray();

    return docs.map(toNoteResponse);
}

export async function findNoteById(id: string, userId: string): Promise<Note | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });
        return doc ? toNoteResponse(doc) : null;
    } catch {
        return null;
    }
}

export async function createNote(userId: string, data: CreateNoteInput): Promise<Note> {
    const now = new Date();
    const doc: Omit<NoteDocument, '_id'> = {
        userId: new ObjectId(userId),
        title: data.title || 'Untitled',
        content: data.content || defaultContent,
        version: 1,
        tagId: data.tagId ? new ObjectId(data.tagId) : undefined,
        isFavorite: false,
        isArchived: false,
        isTrashed: false,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as NoteDocument);

    return {
        _id: result.insertedId.toString(),
        userId: userId,
        title: doc.title,
        content: doc.content,
        version: doc.version,
        tagId: data.tagId,
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export async function updateNote(
    id: string,
    userId: string,
    data: UpdateNoteInput,
): Promise<Note | null> {
    const updateData: Partial<NoteDocument> = {
        updatedAt: new Date(),
    };

    if (data.title !== undefined) {
        updateData.title = data.title;
    }
    if (data.content !== undefined) {
        updateData.content = data.content;
    }
    if (data.tagId !== undefined) {
        updateData.tagId = data.tagId ? new ObjectId(data.tagId) : undefined;
    }
    if (data.isFavorite !== undefined) {
        updateData.isFavorite = data.isFavorite;
    }
    if (data.isArchived !== undefined) {
        updateData.isArchived = data.isArchived;
    }
    if (data.isTrashed !== undefined) {
        updateData.isTrashed = data.isTrashed;
        if (data.isTrashed) {
            updateData.trashedAt = new Date();
        } else {
            updateData.trashedAt = undefined;
        }
    }

    try {
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updateData, $inc: { version: 1 } },
            { returnDocument: 'after' },
        );

        return result ? toNoteResponse(result) : null;
    } catch {
        return null;
    }
}

export async function deleteNote(id: string, userId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

export async function moveNoteToTrash(id: string, userId: string): Promise<Note | null> {
    return updateNote(id, userId, { isTrashed: true });
}

export async function restoreNoteFromTrash(id: string, userId: string): Promise<Note | null> {
    return updateNote(id, userId, { isTrashed: false });
}

export async function emptyTrash(userId: string): Promise<number> {
    try {
        const result = await getCollection().deleteMany({
            userId: new ObjectId(userId),
            isTrashed: true,
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}
