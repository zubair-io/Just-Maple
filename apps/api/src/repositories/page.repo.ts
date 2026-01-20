import { ObjectId, Collection } from 'mongodb';
import * as Automerge from '@automerge/automerge';
import { getDb } from '../db/client';
import type { Page, PageContent, PageType, CreatePageInput, UpdatePageInput } from '@maple/shared';
import { findNotebooksByUserId, findNotebookByIdWithAccess } from './notebook.repo';
import { deleteMemo } from './memo.repo';
import { deleteWhiteboard } from './whiteboard.repo';
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

interface PageDocument {
    _id: ObjectId;
    userId: ObjectId;
    type: PageType;
    title: string;
    // DUAL STORAGE: content for search, automergeDoc as source of truth
    content: PageContent;
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

function getCollection(): Collection<PageDocument> {
    return getDb().collection<PageDocument>('pages');
}

function toPageResponse(doc: PageDocument): Page {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        type: doc.type || 'write', // Default for legacy pages
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

const defaultContent: PageContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [] }],
};

export async function findPagesByUserId(
    userId: string,
    options?: {
        tagId?: string;
        isFavorite?: boolean;
        isTrashed?: boolean;
        isArchived?: boolean;
    },
): Promise<Page[]> {
    // If specific tagId is provided, verify access first
    if (options?.tagId) {
        const notebook = await findNotebookByIdWithAccess(options.tagId, userId, 'read');
        if (!notebook) {
            return []; // No access to this notebook
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
        return docs.map(toPageResponse);
    }

    // No specific notebook - get all pages user has access to
    // 1. Get all notebooks the user has access to
    const accessibleNotebooks = await findNotebooksByUserId(userId);
    const notebookIds = accessibleNotebooks.map((t) => new ObjectId(t._id));

    // 2. Find pages that:
    //    - Have a tagId the user has access to, OR
    //    - Have no tagId AND belong to the user (userId)
    const query: Record<string, unknown> = {
        isTrashed: { $ne: true },
        $or: [
            { tagId: { $in: notebookIds } }, // Pages in accessible notebooks
            { tagId: { $exists: false }, userId: new ObjectId(userId) }, // User's untagged pages
            { tagId: null, userId: new ObjectId(userId) }, // User's pages with null tagId
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

    return docs.map(toPageResponse);
}

export async function findPageById(id: string, userId: string): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check access based on notebook or ownership
        if (doc.tagId) {
            // Page has a notebook - check notebook access
            const notebook = await findNotebookByIdWithAccess(doc.tagId.toString(), userId, 'read');
            if (!notebook) return null; // No access to the notebook
        } else {
            // Page has no notebook - only owner can access
            if (doc.userId.toString() !== userId) return null;
        }

        return toPageResponse(doc);
    } catch {
        return null;
    }
}

export async function findPageByDocumentId(
    documentId: string,
    userId: string,
): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({ documentId });
        if (!doc) return null;

        // Check access based on notebook or ownership
        if (doc.tagId) {
            // Page has a notebook - check notebook access
            const notebook = await findNotebookByIdWithAccess(doc.tagId.toString(), userId, 'read');
            if (!notebook) return null; // No access to the notebook
        } else {
            // Page has no notebook - only owner can access
            if (doc.userId.toString() !== userId) return null;
        }

        return toPageResponse(doc);
    } catch {
        return null;
    }
}

export async function createPage(userId: string, data: CreatePageInput): Promise<Page> {
    console.log('Creating page with data:', data);
    const now = new Date();
    const pageType = data.type || 'write';
    const title = data.title || 'Untitled';
    const doc: Omit<PageDocument, '_id'> = {
        userId: new ObjectId(userId),
        type: pageType,
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

    const result = await getCollection().insertOne(doc as PageDocument);

    return {
        _id: result.insertedId.toString(),
        userId: userId,
        type: pageType,
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

export async function updatePage(
    id: string,
    userId: string,
    data: UpdatePageInput,
): Promise<Page | null> {
    try {
        // First, find the page to check access
        const doc = await getCollection().findOne({ documentId: id });
        if (!doc) return null;

        // Check write access based on notebook or ownership
        if (doc.tagId) {
            // Page has a notebook - check notebook write access
            const notebook = await findNotebookByIdWithAccess(
                doc.tagId.toString(),
                userId,
                'write',
            );
            if (!notebook) return null; // No write access to the notebook
        } else {
            // Page has no notebook - only owner can update
            if (doc.userId.toString() !== userId) return null;
        }

        // If moving to a new notebook, verify write access to the new notebook
        if (data.tagId !== undefined && data.tagId && data.tagId !== doc.tagId?.toString()) {
            const newNotebook = await findNotebookByIdWithAccess(data.tagId, userId, 'write');
            if (!newNotebook) return null; // No write access to the new notebook
        }

        const updateData: Partial<PageDocument> = {
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

        return result ? toPageResponse(result) : null;
    } catch (e) {
        console.error('Error updating page:', e);
        return null;
    }
}

export async function deletePage(id: string, userId: string): Promise<boolean> {
    try {
        // First, find the page to check access
        const doc = await getCollection().findOne({ documentId: id });
        if (!doc) return false;

        // Check write access based on notebook or ownership
        if (doc.tagId) {
            // Page has a notebook - check notebook write access
            const notebook = await findNotebookByIdWithAccess(
                doc.tagId.toString(),
                userId,
                'write',
            );
            if (!notebook) return false; // No write access to the notebook
        } else {
            // Page has no notebook - only owner can delete
            if (doc.userId.toString() !== userId) return false;
        }

        // Cascade delete: Remove associated data based on page type
        if (doc.type === 'memo') {
            await deleteMemo(doc.documentId);
        } else if (doc.type === 'whiteboard') {
            await deleteWhiteboard(doc.documentId);
        }

        const result = await getCollection().deleteOne({ documentId: id });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

export async function movePageToTrash(id: string, userId: string): Promise<Page | null> {
    return updatePage(id, userId, { isTrashed: true });
}

export async function restorePageFromTrash(id: string, userId: string): Promise<Page | null> {
    return updatePage(id, userId, { isTrashed: false });
}

export async function emptyTrash(userId: string): Promise<number> {
    try {
        // Get all notebooks the user has write access to
        const accessibleNotebooks = await findNotebooksByUserId(userId);
        const writeableNotebooks = accessibleNotebooks.filter((t) => {
            const entry = t.sharing.sharedWith.find((e) => e.userId === userId);
            return entry && (entry.accessLevel === 'write' || entry.accessLevel === 'owner');
        });
        const notebookIds = writeableNotebooks.map((t) => new ObjectId(t._id));

        // Delete trashed pages that:
        // 1. Are in notebooks user has write access to, OR
        // 2. Have no notebook and user is the owner
        const result = await getCollection().deleteMany({
            isTrashed: true,
            $or: [
                { tagId: { $in: notebookIds } },
                { tagId: { $exists: false }, userId: new ObjectId(userId) },
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
const INTERNAL_CAPABILITY = Symbol('page.repo.internal');

// Allowed callers registry for audit logging
const ALLOWED_INTERNAL_CALLERS = new Set(['OTService', 'MigrationService', 'AutomergeService']);

/**
 * Find page by ID without permission checks
 * WARNING: Only callable from trusted internal services
 * @param id - Page ID
 * @param capability - Internal capability token (prevents accidental usage)
 * @param caller - Name of calling service (for audit logging)
 */
export async function findPageByIdInternal(
    id: string,
    capability: symbol,
    caller: string,
): Promise<Page | null> {
    // Runtime guard: Verify capability token
    if (capability !== INTERNAL_CAPABILITY) {
        console.error(
            `[SECURITY] Unauthorized call to findPageByIdInternal from ${caller} - capability token invalid`,
        );
        throw new Error('Unauthorized: Invalid capability token for internal function');
    }

    // Audit log
    if (!ALLOWED_INTERNAL_CALLERS.has(caller)) {
        console.warn(
            `[SECURITY] Unexpected caller "${caller}" for findPageByIdInternal on page ${id}`,
        );
    } else {
        console.log(`[AUDIT] findPageByIdInternal called by ${caller} for page ${id}`);
    }

    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;
        return toPageResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Update page without permission checks
 * WARNING: Only callable from trusted internal services
 * @param id - Page ID
 * @param data - Update data
 * @param capability - Internal capability token (prevents accidental usage)
 * @param caller - Name of calling service (for audit logging)
 */
export async function updatePageInternal(
    id: string,
    data: Partial<UpdatePageInput>,
    capability: symbol,
    caller: string,
): Promise<Page | null> {
    // Runtime guard: Verify capability token
    if (capability !== INTERNAL_CAPABILITY) {
        console.error(
            `[SECURITY] Unauthorized call to updatePageInternal from ${caller} - capability token invalid`,
        );
        throw new Error('Unauthorized: Invalid capability token for internal function');
    }

    // Audit log
    if (!ALLOWED_INTERNAL_CALLERS.has(caller)) {
        console.warn(
            `[SECURITY] Unexpected caller "${caller}" for updatePageInternal on page ${id}`,
        );
    } else {
        console.log(`[AUDIT] updatePageInternal called by ${caller} for page ${id}`);
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
        return toPageResponse(result);
    } catch {
        return null;
    }
}

// Wrapper functions for trusted OT/collaboration services
// These wrappers keep INTERNAL_CAPABILITY private while providing controlled access

/**
 * Find page by ID for collaboration services (bypasses permission checks)
 * Only use from OTService or AutomergeService
 */
export async function findPageByIdForCollab(
    id: string,
    caller: 'OTService' | 'MigrationService' | 'AutomergeService',
): Promise<Page | null> {
    return findPageByIdInternal(id, INTERNAL_CAPABILITY, caller);
}

/**
 * Update page for OT service (bypasses permission checks)
 * Only use from OTService
 */
export async function updatePageForCollab(
    id: string,
    data: Partial<UpdatePageInput>,
    caller: 'OTService' | 'MigrationService' | 'AutomergeService',
): Promise<Page | null> {
    return updatePageInternal(id, data, INTERNAL_CAPABILITY, caller);
}
