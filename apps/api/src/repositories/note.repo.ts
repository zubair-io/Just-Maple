import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Note,
    NoteContent,
    NoteType,
    CreateNoteInput,
    UpdateNoteInput,
    DEFAULT_NOTE_CONTENT,
} from '@maple/shared';
import { findTagsByUserId, findTagByIdWithAccess } from './tag.repo';

interface NoteDocument {
    _id: ObjectId;
    userId: ObjectId;
    type: NoteType;
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
        type: doc.type || 'write', // Default for legacy notes
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
    // If specific tagId is provided, verify access first
    if (options?.tagId) {
        const tag = await findTagByIdWithAccess(options.tagId, userId, 'read');
        if (!tag) {
            return []; // No access to this tag
        }

        const query: Record<string, unknown> = {
            tagId: new ObjectId(options.tagId),
            isTrashed: { $ne: true },
        };

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

    // No specific tag - get all notes user has access to
    // 1. Get all tags the user has access to
    const accessibleTags = await findTagsByUserId(userId);
    const tagIds = accessibleTags.map((t) => new ObjectId(t._id));

    // 2. Find notes that:
    //    - Have a tagId the user has access to, OR
    //    - Have no tagId AND belong to the user (userId)
    const query: Record<string, unknown> = {
        isTrashed: { $ne: true },
        $or: [
            { tagId: { $in: tagIds } }, // Notes in accessible tags
            { tagId: { $exists: false }, userId: new ObjectId(userId) }, // User's untagged notes
            { tagId: null, userId: new ObjectId(userId) }, // User's notes with null tagId
        ],
    };

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
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check access based on tag or ownership
        if (doc.tagId) {
            // Note has a tag - check tag access
            const tag = await findTagByIdWithAccess(doc.tagId.toString(), userId, 'read');
            if (!tag) return null; // No access to the tag
        } else {
            // Note has no tag - only owner can access
            if (doc.userId.toString() !== userId) return null;
        }

        return toNoteResponse(doc);
    } catch {
        return null;
    }
}

export async function createNote(userId: string, data: CreateNoteInput): Promise<Note> {
    const now = new Date();
    const noteType = data.type || 'write';
    const doc: Omit<NoteDocument, '_id'> = {
        userId: new ObjectId(userId),
        type: noteType,
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
        type: noteType,
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
    try {
        // First, find the note to check access
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check write access based on tag or ownership
        if (doc.tagId) {
            // Note has a tag - check tag write access
            const tag = await findTagByIdWithAccess(doc.tagId.toString(), userId, 'write');
            if (!tag) return null; // No write access to the tag
        } else {
            // Note has no tag - only owner can update
            if (doc.userId.toString() !== userId) return null;
        }

        // If moving to a new tag, verify write access to the new tag
        if (data.tagId !== undefined && data.tagId && data.tagId !== doc.tagId?.toString()) {
            const newTag = await findTagByIdWithAccess(data.tagId, userId, 'write');
            if (!newTag) return null; // No write access to the new tag
        }

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

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id) },
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
        // First, find the note to check access
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return false;

        // Check write access based on tag or ownership
        if (doc.tagId) {
            // Note has a tag - check tag write access
            const tag = await findTagByIdWithAccess(doc.tagId.toString(), userId, 'write');
            if (!tag) return false; // No write access to the tag
        } else {
            // Note has no tag - only owner can delete
            if (doc.userId.toString() !== userId) return false;
        }

        const result = await getCollection().deleteOne({ _id: new ObjectId(id) });
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
        // Get all tags the user has write access to
        const accessibleTags = await findTagsByUserId(userId);
        const writeableTags = accessibleTags.filter((t) => {
            const entry = t.sharing.sharedWith.find((e) => e.userId === userId);
            return entry && (entry.accessLevel === 'write' || entry.accessLevel === 'owner');
        });
        const tagIds = writeableTags.map((t) => new ObjectId(t._id));

        // Delete trashed notes that:
        // 1. Are in tags user has write access to, OR
        // 2. Have no tag and user is the owner
        const result = await getCollection().deleteMany({
            isTrashed: true,
            $or: [
                { tagId: { $in: tagIds } },
                { tagId: { $exists: false }, userId: new ObjectId(userId) },
                { tagId: null, userId: new ObjectId(userId) },
            ],
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}
