import { ObjectId, Collection } from 'mongodb';
import * as Automerge from '@automerge/automerge';
import { getDb } from '../db/client';
import type { Note, NoteContent, NoteType, CreateNoteInput, UpdateNoteInput } from '@maple/shared';
import { findTagsByUserId, findTagByIdWithAccess } from './tag.repo';
import { customAlphabet } from 'nanoid';

/**
 * Generate a unique documentId for routing
 * Uses base58 alphabet (compatible with Automerge URLs)
 * Excludes: 0, O, I, l (to avoid confusion)
 */
const nanoidBase58 = customAlphabet(
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
    32,
);

interface NoteDocument {
    _id: ObjectId;
    userId: ObjectId;
    type: NoteType;
    title: string;
    // DUAL STORAGE: content for search, automergeDoc as source of truth
    content: NoteContent;
    automergeDoc?: Buffer; // Binary CRDT (source of truth)
    documentId: string; // Document ID for routing and Automerge identification
    // Automerge metadata
    version?: number; // Hash of Automerge heads (for cache validation)
    lastSyncedHeads?: string[]; // Automerge heads (for sync optimization)
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
    // Normalize automergeDoc to plain array for JSON serialization
    // let automergeDoc = doc.automergeDoc;
    // if (automergeDoc && Buffer.isBuffer(automergeDoc)) {
    //     // Convert Buffer to plain array for consistent JSON serialization
    //     automergeDoc = Array.from(automergeDoc) as any;
    // }

    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        type: doc.type || 'write', // Default for legacy notes
        title: doc.title,
        content: doc.content,
        automergeDoc: doc.automergeDoc, // Binary CRDT (normalized to array)
        version: doc.version, // Hash of Automerge heads
        lastSyncedHeads: doc.lastSyncedHeads, // Automerge heads
        tagId: doc.tagId?.toString(),
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        trashedAt: doc.trashedAt?.toISOString(),
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        documentId: doc.documentId,
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

export async function findNoteByDocumentId(
    documentId: string,
    userId: string,
): Promise<Note | null> {
    try {
        const doc = await getCollection().findOne({ documentId });
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
    console.log('🤢Creating note with data:', data);
    const now = new Date();
    const noteType = data.type || 'write';
    const title = data.title || 'Untitled';
    const doc: Omit<NoteDocument, '_id'> = {
        userId: new ObjectId(userId),
        type: noteType,
        title: title,
        content: data.content || defaultContent,
        documentId: data.documentId || nanoidBase58(),
        version: undefined,
        lastSyncedHeads: undefined,
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
        automergeDoc: undefined,
        version: undefined,
        lastSyncedHeads: undefined,
        tagId: data.tagId,
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        documentId: doc.documentId,
    };
}

export async function updateNote(
    id: string,
    userId: string,
    data: UpdateNoteInput,
): Promise<Note | null> {
    try {
        // First, find the note to check access
        const doc = await getCollection().findOne({ documentId: id });
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
        if (data.automergeDoc !== undefined) {
            updateData.automergeDoc = data.automergeDoc;
        }

        // // Automerge Merge Logic
        // if (data.automergeDoc !== undefined) {
        //     let incomingBinary: Uint8Array;
        //     if (typeof data.automergeDoc === 'string') {
        //         incomingBinary = Buffer.from(data.automergeDoc, 'base64');
        //     } else {
        //         incomingBinary = data.automergeDoc as unknown as Uint8Array;
        //     }

        //     const incomingDoc = Automerge.load(incomingBinary);
        //     let finalDoc = incomingDoc;

        //     if (doc.automergeDoc) {
        //         let existingBinary: Uint8Array;
        //         if (Buffer.isBuffer(doc.automergeDoc)) {
        //             existingBinary = doc.automergeDoc;
        //         } else if (Array.isArray(doc.automergeDoc)) {
        //             // Handle case where it might be stored as an array (e.g. from a past save)
        //             existingBinary = new Uint8Array(doc.automergeDoc);
        //         } else if ((doc.automergeDoc as any).buffer) {
        //             // Handle binary object from Mongo driver sometimes
        //             existingBinary = new Uint8Array((doc.automergeDoc as any).buffer);
        //         } else {
        //             existingBinary = new Uint8Array(doc.automergeDoc as any);
        //         }

        //         const existingDoc = Automerge.load(existingBinary);
        //         finalDoc = Automerge.merge(existingDoc, incomingDoc);
        //     }

        //     updateData.automergeDoc = Buffer.from(Automerge.save(finalDoc));
        // }

        if (data.version !== undefined) {
            updateData.version = data.version;
        }
        if (data.lastSyncedHeads !== undefined) {
            updateData.lastSyncedHeads = data.lastSyncedHeads;
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
            { _id: new ObjectId(doc._id) },
            { $set: updateData },
            { returnDocument: 'after' },
        );

        return result ? toNoteResponse(result) : null;
    } catch (e) {
        console.error('Error updating note:', e);
        return null;
    }
}

export async function deleteNote(id: string, userId: string): Promise<boolean> {
    try {
        // First, find the note to check access
        const doc = await getCollection().findOne({ documentId: id });
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

        const result = await getCollection().deleteOne({ documentId: id });
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
                // Use $or for tagId null check if needed, or rely on $exists: false which covers undefined/missing.
                // Using explicit null comparison if field exists but is null:
                { tagId: null as any, userId: new ObjectId(userId) },
            ],
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}

// Internal functions for trusted services (bypasses permission checks)
// Only use these from internal services like OT collaboration

// Internal capability token - prevents accidental misuse of internal functions
const INTERNAL_CAPABILITY = Symbol('note.repo.internal');

// Allowed callers registry for audit logging
const ALLOWED_INTERNAL_CALLERS = new Set(['OTService', 'MigrationService', 'AutomergeService']);

/**
 * Find note by ID without permission checks
 * WARNING: Only callable from trusted internal services
 * @param id - Note ID
 * @param capability - Internal capability token (prevents accidental usage)
 * @param caller - Name of calling service (for audit logging)
 */
export async function findNoteByIdInternal(
    id: string,
    capability: symbol,
    caller: string,
): Promise<Note | null> {
    // Runtime guard: Verify capability token
    if (capability !== INTERNAL_CAPABILITY) {
        console.error(
            `[SECURITY] Unauthorized call to findNoteByIdInternal from ${caller} - capability token invalid`,
        );
        throw new Error('Unauthorized: Invalid capability token for internal function');
    }

    // Audit log
    if (!ALLOWED_INTERNAL_CALLERS.has(caller)) {
        console.warn(
            `[SECURITY] Unexpected caller "${caller}" for findNoteByIdInternal on note ${id}`,
        );
    } else {
        console.log(`[AUDIT] findNoteByIdInternal called by ${caller} for note ${id}`);
    }

    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;
        return toNoteResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Update note without permission checks
 * WARNING: Only callable from trusted internal services
 * @param id - Note ID
 * @param data - Update data
 * @param capability - Internal capability token (prevents accidental usage)
 * @param caller - Name of calling service (for audit logging)
 */
export async function updateNoteInternal(
    id: string,
    data: Partial<UpdateNoteInput>,
    capability: symbol,
    caller: string,
): Promise<Note | null> {
    // Runtime guard: Verify capability token
    if (capability !== INTERNAL_CAPABILITY) {
        console.error(
            `[SECURITY] Unauthorized call to updateNoteInternal from ${caller} - capability token invalid`,
        );
        throw new Error('Unauthorized: Invalid capability token for internal function');
    }

    // Audit log
    if (!ALLOWED_INTERNAL_CALLERS.has(caller)) {
        console.warn(
            `[SECURITY] Unexpected caller "${caller}" for updateNoteInternal on note ${id}`,
        );
    } else {
        console.log(`[AUDIT] updateNoteInternal called by ${caller} for note ${id}`);
    }

    try {
        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (data.title !== undefined) updateData.title = data.title;
        if (data.content !== undefined) updateData.content = data.content;
        if (data.automergeDoc !== undefined) updateData.automergeDoc = data.automergeDoc;
        if (data.version !== undefined) updateData.version = data.version;
        if (data.lastSyncedHeads !== undefined) updateData.lastSyncedHeads = data.lastSyncedHeads;
        if (data.tagId !== undefined) {
            updateData.tagId = data.tagId ? new ObjectId(data.tagId) : null;
        }
        if (data.isFavorite !== undefined) updateData.isFavorite = data.isFavorite;
        if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateData },
            { returnDocument: 'after' },
        );

        if (!result) return null;
        return toNoteResponse(result);
    } catch {
        return null;
    }
}

// Wrapper functions for trusted OT/collaboration services
// These wrappers keep INTERNAL_CAPABILITY private while providing controlled access

/**
 * Find note by ID for collaboration services (bypasses permission checks)
 * Only use from OTService or AutomergeService
 */
export async function findNoteByIdForCollab(
    id: string,
    caller: 'OTService' | 'MigrationService' | 'AutomergeService',
): Promise<Note | null> {
    return findNoteByIdInternal(id, INTERNAL_CAPABILITY, caller);
}

/**
 * Update note for OT service (bypasses permission checks)
 * Only use from OTService
 */
export async function updateNoteForCollab(
    id: string,
    data: Partial<UpdateNoteInput>,
    caller: 'OTService' | 'MigrationService' | 'AutomergeService',
): Promise<Note | null> {
    return updateNoteInternal(id, data, INTERNAL_CAPABILITY, caller);
}
