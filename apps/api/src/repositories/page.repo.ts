import { ObjectId, Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { customAlphabet } from 'nanoid';
import { getDb } from '../db/client';
import {
    isNotebookMember,
    isNotebookShared,
    type DeviceDataFilter,
    type MacDataSource,
    type Notebook,
    type ProactiveBotSettings,
} from '@maple/shared';
import type {
    Page,
    PageContent,
    PageType,
    CreatePageInput,
    UpdatePageInput,
    PageTodoMeta,
    PublishPageInput,
} from '@maple/shared';
import { extractSlugId } from '@maple/shared/utils/slug';
import { findNotebooksByUserId, findNotebookByIdWithAccess } from './notebook.repo';
import { deleteMemo, deleteMemosByPageId, getMemoState, findMemosByPageIds } from './memo.repo';
import { deleteWhiteboard } from './whiteboard.repo';
import { deleteKanbanBoard } from './kanban-board.repo';
import { deleteJsonDocument } from './json-document.repo';
import { isDevMode, isDocPage, getDocPage, pageIdToSlug } from '../services/docs.service';
import * as Y from 'yjs';
import { createSnapshotFromState } from '../services/memo-version.service';

/**
 * Generate a UUID v4 for page routing
 */
function generatePageId(): string {
    return randomUUID();
}

interface PageDocument {
    _id: ObjectId;
    id: string; // UUID v4 for routing (was documentId)
    userId: ObjectId;
    type: PageType;
    title: string;
    content: PageContent;
    notebookId?: ObjectId;
    isFavorite?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    trashedAt?: Date;
    // Todo metadata for efficient querying
    todoMeta?: PageTodoMeta;
    // Tags extracted from content (e.g., #work, #ideas)
    tags?: string[];
    // Messages pages only: proactive bot settings
    proactive?: Omit<ProactiveBotSettings, 'updatedAt'> & { updatedAt: Date };
    // Device data pages only: which of the owner's sources the page shows
    deviceSource?: MacDataSource;
    deviceFilter?: DeviceDataFilter;
    description?: string;
    // Public publishing fields
    isPublished?: boolean;
    publishedSlug?: string;
    publishedAt?: Date;
    publishedOrder?: number;
    publishedContent?: PageContent;
    publishedTitle?: string;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<PageDocument> {
    return getDb().collection<PageDocument>('pages');
}

function toPageResponse(doc: PageDocument): Page {
    return {
        _id: doc._id.toString(),
        id: doc.id,
        userId: doc.userId.toString(),
        type: doc.type || 'memo', // Default for legacy pages
        title: doc.title,
        content: doc.content,
        notebookId: doc.notebookId?.toString(),
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        trashedAt: doc.trashedAt?.toISOString(),
        todoMeta: doc.todoMeta, // Todo metadata
        tags: doc.tags, // Tags extracted from content
        ...(doc.deviceSource ? { deviceSource: doc.deviceSource } : {}),
        ...(doc.deviceFilter ? { deviceFilter: doc.deviceFilter } : {}),
        ...(doc.description ? { description: doc.description } : {}),
        proactive: doc.proactive
            ? { ...doc.proactive, updatedAt: doc.proactive.updatedAt.toISOString() }
            : undefined,
        isPublished: doc.isPublished,
        publishedSlug: doc.publishedSlug,
        publishedAt: doc.publishedAt?.toISOString(),
        publishedOrder: doc.publishedOrder,
        publishedContent: doc.publishedContent,
        publishedTitle: doc.publishedTitle,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

const defaultContent: PageContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [] }],
};

export async function findPagesByUserId(
    userId: string,
    options?: {
        notebookId?: string;
        isFavorite?: boolean;
        isTrashed?: boolean;
        isArchived?: boolean;
    },
): Promise<Page[]> {
    // If specific notebookId is provided, verify access first
    if (options?.notebookId) {
        const notebook = await findNotebookByIdWithAccess(options.notebookId, userId, 'read');
        if (!notebook) {
            return []; // No access to this notebook
        }

        const query: Record<string, unknown> = {
            notebookId: new ObjectId(options.notebookId),
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
        return docs.filter((doc) => !isHiddenDataPage(doc, notebook, userId)).map(toPageResponse);
    }

    // No specific notebook - get all pages user has access to
    // 1. Get all notebooks the user has access to
    const accessibleNotebooks = await findNotebooksByUserId(userId);
    // Filter out virtual notebooks (like doc-notebook) that don't have valid ObjectIds
    const notebookIds = accessibleNotebooks
        .filter((t) => ObjectId.isValid(t._id))
        .map((t) => new ObjectId(t._id));

    // 2. Find pages that:
    //    - Have a notebookId the user has access to, OR
    //    - Have no notebookId AND belong to the user (userId)
    const query: Record<string, unknown> = {
        isTrashed: { $ne: true },
        $or: [
            { notebookId: { $in: notebookIds } }, // Pages in accessible notebooks
            { notebookId: { $exists: false }, userId: new ObjectId(userId) }, // User's untagged pages
            { notebookId: null, userId: new ObjectId(userId) }, // User's pages with null notebookId
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

    const notebooksById = new Map(accessibleNotebooks.map((n) => [n._id, n]));
    const docs = (await getCollection().find(query).sort({ updatedAt: -1 }).toArray()).filter(
        (doc) =>
            !doc.notebookId ||
            !isHiddenDataPage(doc, notebooksById.get(doc.notebookId.toString()) ?? null, userId),
    );
    console.log(`[findPagesByUserId] Found ${docs.length} pages`);
    if (docs.length > 0) {
        console.log(`[findPagesByUserId] First page has id:`, docs[0].id, 'type:', docs[0].type);
    }

    return docs.map(toPageResponse);
}

export async function findPageByMongoId(mongoId: string, userId: string): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(mongoId) });
        if (!doc) return null;

        // Check access based on notebook or ownership
        if (doc.notebookId) {
            // Page has a notebook - check notebook access
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
                userId,
                'read',
            );
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

export async function findPageById(id: string, userId: string): Promise<Page | null> {
    // Handle virtual doc pages in dev mode
    if (isDevMode() && isDocPage(id)) {
        const slug = pageIdToSlug(id);
        return getDocPage(slug);
    }

    try {
        console.log(`[findPageById] Looking for page with id: ${id}`);
        const doc = await getCollection().findOne({ id });
        console.log(`[findPageById] Found doc:`, doc ? `yes (type: ${doc.type})` : 'no');
        if (!doc) return null;

        // Check access based on notebook or ownership
        if (doc.notebookId) {
            // Page has a notebook - check notebook access
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
                userId,
                'read',
            );
            if (!notebook) return null; // No access to the notebook
            if (isHiddenDataPage(doc, notebook, userId)) return null;
        } else {
            // Page has no notebook - only owner can access
            if (doc.userId.toString() !== userId) return null;
        }

        return toPageResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Someone else's data page whose creator left the notebook: it stays (only they can
 * delete it), but nobody else sees it.
 */
function isHiddenDataPage(
    doc: Pick<PageDocument, 'type' | 'userId'>,
    notebook: Pick<Notebook, 'sharing'> | null,
    userId: string,
): boolean {
    const creator = doc.userId.toString();
    return doc.type === 'devicedata' && creator !== userId && !isNotebookMember(notebook, creator);
}

/** The user's own data page, wherever it is: they can always trash or delete it. */
export async function findOwnDataPage(id: string, userId: string): Promise<Page | null> {
    if (!ObjectId.isValid(userId)) return null;
    const doc = await getCollection().findOne({
        id,
        type: 'devicedata',
        userId: new ObjectId(userId),
    });
    return doc ? toPageResponse(doc) : null;
}

export async function createPage(userId: string, data: CreatePageInput): Promise<Page> {
    console.log('Creating page with data:', data);
    const now = new Date();
    const pageType = data.type || 'memo';
    const title = data.title || 'Untitled';
    const pageId = data.id || generatePageId();
    const doc: Omit<PageDocument, '_id'> = {
        id: pageId,
        userId: new ObjectId(userId),
        type: pageType,
        title: title,
        content: data.content || defaultContent,
        notebookId: data.notebookId ? new ObjectId(data.notebookId) : undefined,
        ...(pageType === 'devicedata' && data.deviceSource
            ? { deviceSource: data.deviceSource }
            : {}),
        ...(pageType === 'devicedata' && data.deviceFilter
            ? { deviceFilter: data.deviceFilter }
            : {}),
        isFavorite: false,
        isArchived: false,
        isTrashed: false,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as PageDocument);

    return {
        _id: result.insertedId.toString(),
        id: pageId,
        userId: userId,
        type: pageType,
        title: doc.title,
        content: doc.content,
        notebookId: data.notebookId,
        ...(doc.deviceSource ? { deviceSource: doc.deviceSource } : {}),
        ...(doc.deviceFilter ? { deviceFilter: doc.deviceFilter } : {}),
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export async function updatePage(
    id: string,
    userId: string,
    data: UpdatePageInput,
): Promise<Page | null> {
    try {
        // First, find the page to check access
        const doc = await getCollection().findOne({ id });
        if (!doc) return null;

        // A data page shows its creator's data: only they change it, even after leaving
        // its notebook (so they can still trash it).
        const isDataPage = doc.type === 'devicedata';
        if (isDataPage && doc.userId.toString() !== userId) return null;

        // Check write access based on notebook or ownership
        if (doc.notebookId && !isDataPage) {
            // Page has a notebook - check notebook write access
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
                userId,
                'write',
            );
            if (!notebook) return null; // No write access to the notebook
        } else if (!doc.notebookId) {
            // Page has no notebook - only owner can update
            if (doc.userId.toString() !== userId) return null;
        }

        const updateData: Partial<PageDocument> = {
            updatedAt: new Date(),
        };

        // If moving to a new notebook, verify write access to the new notebook
        if (
            data.notebookId !== undefined &&
            data.notebookId &&
            data.notebookId !== doc.notebookId?.toString()
        ) {
            const newNotebook = await findNotebookByIdWithAccess(data.notebookId, userId, 'write');
            if (!newNotebook) return null; // No write access to the new notebook
            // A data page moved into a shared notebook shares nothing until its creator picks.
            if (isDataPage && isNotebookShared(newNotebook)) updateData.deviceFilter = {};
        }

        if (data.title !== undefined) {
            updateData.title = data.title;
        }
        if (data.content !== undefined) {
            updateData.content = data.content;
        }
        if (data.notebookId !== undefined) {
            updateData.notebookId = data.notebookId ? new ObjectId(data.notebookId) : undefined;
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
        if (data.todoMeta !== undefined) {
            updateData.todoMeta = data.todoMeta;
        }
        if (data.tags !== undefined) {
            updateData.tags = data.tags;
        }
        if (isDataPage) {
            if (data.description !== undefined) updateData.description = data.description;
            if (data.deviceFilter !== undefined && updateData.deviceFilter === undefined) {
                updateData.deviceFilter = data.deviceFilter;
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
        const doc = await getCollection().findOne({ id });
        if (!doc) return false;

        // Data pages: only their creator, even after leaving the notebook.
        const isDataPage = doc.type === 'devicedata';
        if (isDataPage && doc.userId.toString() !== userId) return false;

        // Check write access based on notebook or ownership
        if (doc.notebookId && !isDataPage) {
            // Page has a notebook - check notebook write access
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
                userId,
                'write',
            );
            if (!notebook) return false; // No write access to the notebook
        } else if (!doc.notebookId) {
            // Page has no notebook - only owner can delete
            if (doc.userId.toString() !== userId) return false;
        }

        // Cascade delete: Remove associated data based on page type
        if (doc.type === 'memo') {
            await deleteMemo(doc.id);
        } else if (doc.type === 'whiteboard') {
            await deleteWhiteboard(doc.id);
        } else if (doc.type === 'kanban') {
            await deleteKanbanBoard(doc.id);
            // Also delete all card memos that reference this kanban page
            await deleteMemosByPageId(doc.id);
        } else if (doc.type === 'json') {
            await deleteJsonDocument(doc.id);
        }

        const result = await getCollection().deleteOne({ id });
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
        // Filter out virtual notebooks that don't have valid ObjectIds
        const notebookIds = writeableNotebooks
            .filter((t) => ObjectId.isValid(t._id))
            .map((t) => new ObjectId(t._id));

        // Delete trashed pages that:
        // 1. Are in notebooks user has write access to, OR
        // 2. Have no notebook and user is the owner
        // Data pages only ever go with their creator's own trash.
        const me = new ObjectId(userId);
        const result = await getCollection().deleteMany({
            isTrashed: true,
            $and: [
                {
                    $or: [
                        { notebookId: { $in: notebookIds } },
                        { notebookId: { $exists: false }, userId: me },
                        { notebookId: null as any, userId: me },
                        { type: 'devicedata', userId: me },
                    ],
                },
                { $or: [{ type: { $ne: 'devicedata' } }, { userId: me }] },
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
const ALLOWED_INTERNAL_CALLERS = new Set(['OTService', 'MigrationService']);

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
        const doc = await getCollection().findOne({ id });
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
        if (data.notebookId !== undefined) {
            updateData.notebookId = data.notebookId ? new ObjectId(data.notebookId) : null;
        }
        if (data.isFavorite !== undefined) updateData.isFavorite = data.isFavorite;
        if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;

        const result = await getCollection().findOneAndUpdate(
            { id },
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
 * Only use from OTService
 */
export async function findPageByIdForCollab(
    id: string,
    caller: 'OTService' | 'MigrationService',
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
    caller: 'OTService' | 'MigrationService',
): Promise<Page | null> {
    return updatePageInternal(id, data, INTERNAL_CAPABILITY, caller);
}

// ============================================
// Bot Access Functions
// ============================================

/**
 * Find page by ID for bot access (bypasses user permission checks)
 * Bot permission is verified separately via checkBotNotebookAccess
 */
export async function findPageByIdForBot(id: string): Promise<Page | null> {
    try {
        console.log(`[findPageByIdForBot] Looking for page with id: ${id}`);
        const doc = await getCollection().findOne({ id });
        console.log(`[findPageByIdForBot] Found doc:`, doc ? `yes (type: ${doc.type})` : 'no');
        if (!doc) return null;
        return toPageResponse(doc);
    } catch {
        return null;
    }
}

// ============================================
// Messages Page Functions
// ============================================

/**
 * Find the messages page for a notebook
 */
export async function findMessagesPageByNotebookId(notebookId: string): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({
            notebookId: new ObjectId(notebookId),
            type: 'message',
            isTrashed: { $ne: true },
        });
        return doc ? toPageResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find or create a messages page for a notebook
 * This is used when sending messages to ensure a messages page exists
 */
export async function findOrCreateMessagesPage(notebookId: string, userId: string): Promise<Page> {
    if (!ObjectId.isValid(notebookId)) {
        const now = new Date();
        return {
            _id: 'virtual-messages',
            id: 'virtual-messages',
            userId: userId,
            type: 'message',
            title: 'Messages',
            content: { type: 'doc', content: [] },
            notebookId: notebookId,
            isFavorite: false,
            isArchived: false,
            isTrashed: false,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }

    // Try to find existing messages page
    const existing = await findMessagesPageByNotebookId(notebookId);
    if (existing) {
        return existing;
    }

    // Create a new messages page
    const now = new Date();
    const pageId = generatePageId();
    const doc: Omit<PageDocument, '_id'> = {
        id: pageId,
        userId: new ObjectId(userId),
        type: 'message',
        title: 'Messages',
        content: { type: 'doc', content: [] },
        notebookId: new ObjectId(notebookId),
        isFavorite: false,
        isArchived: false,
        isTrashed: false,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as PageDocument);

    return {
        _id: result.insertedId.toString(),
        id: pageId,
        userId: userId,
        type: 'message',
        title: 'Messages',
        content: doc.content,
        notebookId: notebookId,
        isFavorite: false,
        isArchived: false,
        isTrashed: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Count pages by type for a notebook (for summary)
 */
export async function countPagesByTypeForNotebook(
    notebookId: string,
): Promise<Record<string, number>> {
    try {
        const pipeline = [
            {
                $match: {
                    notebookId: new ObjectId(notebookId),
                    isTrashed: { $ne: true },
                },
            },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                },
            },
        ];

        const results = await getCollection().aggregate(pipeline).toArray();
        const counts: Record<string, number> = {};
        for (const result of results) {
            counts[result._id as string] = result.count;
        }
        return counts;
    } catch {
        return {};
    }
}

/**
 * Get aggregated todo stats for a notebook
 */
export async function getTodoStatsForNotebook(notebookId: string): Promise<{
    todoCount: number;
    completedCount: number;
    overdueCount: number;
}> {
    try {
        const pipeline = [
            {
                $match: {
                    notebookId: new ObjectId(notebookId),
                    isTrashed: { $ne: true },
                    'todoMeta.hasTodos': true,
                },
            },
            {
                $group: {
                    _id: null,
                    todoCount: { $sum: '$todoMeta.todoCount' },
                    completedCount: { $sum: '$todoMeta.completedCount' },
                    overdueCount: { $sum: '$todoMeta.overdueCount' },
                },
            },
        ];

        const results = await getCollection().aggregate(pipeline).toArray();
        if (results.length === 0) {
            return { todoCount: 0, completedCount: 0, overdueCount: 0 };
        }

        return {
            todoCount: results[0].todoCount || 0,
            completedCount: results[0].completedCount || 0,
            overdueCount: results[0].overdueCount || 0,
        };
    } catch {
        return { todoCount: 0, completedCount: 0, overdueCount: 0 };
    }
}

// ============================================
// Tag Functions
// ============================================

/**
 * Get all unique tags for pages accessible to a user
 */
export async function getAllTagsForUser(userId: string): Promise<string[]> {
    try {
        // Get all notebooks the user has access to
        const accessibleNotebooks = await findNotebooksByUserId(userId);
        const notebookIds = accessibleNotebooks
            .filter((t) => ObjectId.isValid(t._id))
            .map((t) => new ObjectId(t._id));

        // Aggregate unique tags from accessible pages
        const pipeline = [
            {
                $match: {
                    isTrashed: { $ne: true },
                    tags: { $exists: true, $ne: [] },
                    $or: [
                        { notebookId: { $in: notebookIds } },
                        { notebookId: { $exists: false }, userId: new ObjectId(userId) },
                        { notebookId: null, userId: new ObjectId(userId) },
                    ],
                },
            },
            { $unwind: '$tags' },
            { $group: { _id: '$tags' } },
            { $sort: { _id: 1 } },
        ];

        const results = await getCollection().aggregate(pipeline).toArray();
        return results.map((r) => r._id as string);
    } catch {
        return [];
    }
}

/**
 * Find pages by tag for a user
 */
export async function findPagesByTag(
    userId: string,
    tag: string,
    options?: {
        notebookId?: string;
        limit?: number;
        offset?: number;
    },
): Promise<Page[]> {
    try {
        // Get all notebooks the user has access to
        const accessibleNotebooks = await findNotebooksByUserId(userId);
        const notebookIds = accessibleNotebooks
            .filter((t) => ObjectId.isValid(t._id))
            .map((t) => new ObjectId(t._id));

        const query: Record<string, unknown> = {
            isTrashed: { $ne: true },
            tags: tag,
            $or: [
                { notebookId: { $in: notebookIds } },
                { notebookId: { $exists: false }, userId: new ObjectId(userId) },
                { notebookId: null, userId: new ObjectId(userId) },
            ],
        };

        // Optional: filter by specific notebook
        if (options?.notebookId) {
            query.notebookId = new ObjectId(options.notebookId);
        }

        let cursor = getCollection().find(query).sort({ updatedAt: -1 });

        if (options?.offset) {
            cursor = cursor.skip(options.offset);
        }
        if (options?.limit) {
            cursor = cursor.limit(options.limit);
        }

        const docs = await cursor.toArray();
        return docs.map(toPageResponse);
    } catch {
        return [];
    }
}

/**
 * Get tag counts for a user (how many pages have each tag)
 */
export async function getTagCountsForUser(
    userId: string,
): Promise<Array<{ tag: string; count: number }>> {
    try {
        // Get all notebooks the user has access to
        const accessibleNotebooks = await findNotebooksByUserId(userId);
        const notebookIds = accessibleNotebooks
            .filter((t) => ObjectId.isValid(t._id))
            .map((t) => new ObjectId(t._id));

        const pipeline = [
            {
                $match: {
                    isTrashed: { $ne: true },
                    tags: { $exists: true, $ne: [] },
                    $or: [
                        { notebookId: { $in: notebookIds } },
                        { notebookId: { $exists: false }, userId: new ObjectId(userId) },
                        { notebookId: null, userId: new ObjectId(userId) },
                    ],
                },
            },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
        ];

        const results = await getCollection().aggregate(pipeline).toArray();
        return results.map((r) => ({ tag: r._id as string, count: r.count as number }));
    } catch {
        return [];
    }
}

// ============================================
// Public Page Functions
// ============================================

/**
 * Generate a unique slug for a page (shortId only).
 * The title prefix is added at display time so title changes don't affect the stored slug.
 */
const generatePageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

async function generateUniquePageSlug(notebookId: ObjectId | undefined): Promise<string> {
    for (let i = 0; i < 10; i++) {
        const slug = generatePageSlugId();
        const query: Record<string, unknown> = { publishedSlug: slug };
        if (notebookId) {
            query.notebookId = notebookId;
        }
        const existing = await getCollection().findOne(query);
        if (!existing) return slug;
    }
    // Fallback: longer slug to avoid collision
    return customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)();
}

/** Reserve candidates in memory and check collisions once per batch, not per page. */
async function generatePageSlugs(notebookId: ObjectId, count: number): Promise<string[]> {
    const reserved = new Set<string>();
    for (let attempt = 0; attempt < 20 && reserved.size < count; attempt++) {
        const candidates = new Set<string>();
        const generate =
            attempt < 10
                ? generatePageSlugId
                : customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);
        // Bound the query size and also reserve distinct IDs within this publish batch.
        for (
            let draw = 0;
            draw < (count - reserved.size) * 4 &&
            candidates.size < Math.min(500, count - reserved.size);
            draw++
        ) {
            const slug = generate();
            if (!reserved.has(slug)) candidates.add(slug);
        }
        if (candidates.size === 0) continue;
        const query: Record<string, unknown> = {
            notebookId: { $in: [notebookId, notebookId.toString()] },
            publishedSlug: { $in: [...candidates] },
        };
        const collisions = await getCollection()
            .find(query)
            .project({ publishedSlug: 1 })
            .toArray();
        const occupied = new Set(collisions.map((page) => page.publishedSlug));
        for (const candidate of candidates) {
            if (!occupied.has(candidate)) reserved.add(candidate);
        }
        // Completing a collision-free chunk is progress, not a failed retry.
        if (occupied.size === 0 && reserved.size < count) attempt--;
    }
    if (reserved.size !== count) throw new Error('Unable to reserve unique page slugs');
    return [...reserved];
}

/**
 * Convert Y.js binary state to ProseMirror JSON.
 */
function yDocStateToJSON(state: Uint8Array): PageContent | null {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    const fragment = ydoc.getXmlFragment('prosemirror');
    if (fragment.length === 0) {
        ydoc.destroy();
        return null;
    }

    const content: PageContent['content'] = [];
    for (let i = 0; i < fragment.length; i++) {
        const child = fragment.get(i);
        if (child instanceof Y.XmlElement) {
            content.push(yXmlElementToJSON(child));
        } else if (child instanceof Y.XmlText) {
            content.push(...yXmlTextToNodes(child));
        }
    }
    ydoc.destroy();
    return { type: 'doc', content };
}

function yXmlElementToJSON(element: Y.XmlElement): Record<string, unknown> {
    const result: Record<string, unknown> = { type: element.nodeName };
    const attrs = element.getAttributes();
    if (Object.keys(attrs).length > 0) result.attrs = attrs;

    const content: Record<string, unknown>[] = [];
    for (let i = 0; i < element.length; i++) {
        const child = element.get(i);
        if (child instanceof Y.XmlElement) {
            content.push(yXmlElementToJSON(child));
        } else if (child instanceof Y.XmlText) {
            // A single Y.XmlText can produce multiple ProseMirror text nodes
            content.push(...yXmlTextToNodes(child));
        }
    }
    if (content.length > 0) result.content = content;
    return result;
}

/**
 * Convert a Y.XmlText to one or more ProseMirror text nodes.
 * Each delta segment becomes a separate node with its own marks.
 * Empty text nodes are filtered out (ProseMirror rejects them).
 */
function yXmlTextToNodes(textNode: Y.XmlText): Record<string, unknown>[] {
    const delta = textNode.toDelta();
    const nodes: Record<string, unknown>[] = [];

    for (const segment of delta) {
        const text = typeof segment.insert === 'string' ? segment.insert : '';
        if (!text) continue; // Skip empty text nodes

        const node: Record<string, unknown> = { type: 'text', text };

        if (segment.attributes) {
            const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
            for (const [key, value] of Object.entries(segment.attributes)) {
                if (value === null || value === false) continue;
                if (
                    value === true ||
                    (typeof value === 'object' && Object.keys(value as object).length === 0)
                ) {
                    marks.push({ type: key });
                } else {
                    marks.push({ type: key, attrs: value as Record<string, unknown> });
                }
            }
            if (marks.length > 0) node.marks = marks;
        }

        nodes.push(node);
    }

    return nodes;
}

/**
 * Update a page's publish state (slug, order, visibility)
 * Requires write access to the page's notebook.
 * Message-type pages cannot be published.
 */
export async function publishPage(
    pageId: string,
    userId: string,
    data: PublishPageInput,
): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({ id: pageId });
        if (!doc) return null;

        // Message pages cannot be published, nor data pages (someone's device data).
        if (doc.type === 'message' || doc.type === 'devicedata') return null;

        // Check write access
        if (doc.notebookId) {
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
                userId,
                'write',
            );
            if (!notebook) return null;
        } else {
            if (doc.userId.toString() !== userId) return null;
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (data.isPublished !== undefined) {
            updateData.isPublished = data.isPublished;
            if (data.isPublished) {
                // Snapshot current Y.js content and title for public readers
                const memoState = await getMemoState(pageId);
                const yContent = memoState ? yDocStateToJSON(memoState) : null;
                updateData.publishedContent = yContent || doc.content;
                updateData.publishedTitle = doc.title;
                updateData.publishedAt = new Date();

                // Create a version history snapshot
                if (memoState) {
                    createSnapshotFromState(pageId, memoState, 'manual', 'Published').catch((err) =>
                        console.error('[publishPage] Failed to create version snapshot:', err),
                    );
                }
            }
        }
        if (data.isPublished && !doc.publishedSlug) {
            // Auto-generate slug when publishing and no slug exists
            updateData.publishedSlug = await generateUniquePageSlug(doc.notebookId);
        }
        if (data.publishedOrder !== undefined) {
            updateData.publishedOrder = data.publishedOrder;
        }

        const result = await getCollection().findOneAndUpdate(
            { id: pageId },
            { $set: updateData },
            { returnDocument: 'after' },
        );

        return result ? toPageResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Find all published pages for a notebook (no auth - for public access)
 */
export async function findPublishedPagesByNotebookId(notebookId: string): Promise<Page[]> {
    try {
        const oid = new ObjectId(notebookId);
        // Try both ObjectId and string notebookId (some pages may have string format)
        const docs = await getCollection()
            .find({
                $or: [{ notebookId: oid }, { notebookId: notebookId }],
                isPublished: true,
                isTrashed: { $ne: true },
                type: { $ne: 'message' }, // Never publish message pages
            })
            .toArray();
        // Sort in application code (Cosmos DB doesn't support $or with .sort())
        docs.sort(
            (a, b) =>
                (a.publishedOrder ?? 0) - (b.publishedOrder ?? 0) ||
                (a.title || '').localeCompare(b.title || ''),
        );
        return docs.map(toPageResponse);
    } catch (err) {
        console.error('[findPublishedPagesByNotebookId] Error:', err);
        return [];
    }
}

/**
 * Find a single published page by slug within a notebook (no auth - for public access)
 */
export async function findPublishedPageBySlug(
    notebookId: string,
    displaySlug: string,
): Promise<Page | null> {
    try {
        const pageSlug = extractSlugId(displaySlug);
        const oid = new ObjectId(notebookId);
        const doc = await getCollection().findOne({
            $or: [{ notebookId: oid }, { notebookId: notebookId }],
            publishedSlug: pageSlug,
            isPublished: true,
            isTrashed: { $ne: true },
            type: { $ne: 'message' },
        });
        return doc ? toPageResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Bulk publish all pages in a notebook (when notebook is made public)
 * Sets isPublished=true, auto-generates slugs, and snapshots content for all non-message pages
 */
export async function bulkPublishPagesForNotebook(notebookId: string): Promise<number> {
    try {
        const oid = new ObjectId(notebookId);
        const docs = await getCollection()
            .find({
                $or: [{ notebookId: oid }, { notebookId: notebookId }],
                isTrashed: { $ne: true },
                type: { $nin: ['message', 'devicedata'] },
                isPublished: { $ne: true },
            })
            .toArray();

        if (docs.length === 0) return 0;

        const pageIds = docs.map((d) => d.id);
        const memos = await findMemosByPageIds(pageIds);
        const memoMap = new Map(memos.map((m) => [m.pageId, m.state]));

        const now = new Date();
        const bulkOps = [];
        const slugs = await generatePageSlugs(oid, docs.length);

        for (const [index, doc] of docs.entries()) {
            const slug = slugs[index]!;
            const state = memoMap.get(doc.id);
            const stateBytes = state
                ? state instanceof Uint8Array
                    ? state
                    : new Uint8Array(state as ArrayBuffer)
                : null;
            const yContent = stateBytes ? yDocStateToJSON(stateBytes) : null;

            bulkOps.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: {
                        $set: {
                            isPublished: true,
                            publishedSlug: slug,
                            publishedContent: yContent || doc.content,
                            publishedTitle: doc.title,
                            publishedAt: now,
                            updatedAt: now,
                        },
                    },
                },
            });
        }

        if (bulkOps.length > 0) {
            await getCollection().bulkWrite(bulkOps);
        }
        return bulkOps.length;
    } catch {
        return 0;
    }
}

// ============================================
// Proactive Bot Functions
// ============================================

/**
 * Set or clear a messages page's proactive bot. Access is checked by the caller.
 */
export async function setPageProactive(
    id: string,
    settings: ProactiveBotSettings | null,
): Promise<Page | null> {
    const update = settings
        ? { $set: { proactive: { ...settings, updatedAt: new Date(settings.updatedAt) } } }
        : { $unset: { proactive: '' as const } };
    const result = await getCollection().findOneAndUpdate({ id, type: 'message' }, update, {
        returnDocument: 'after',
    });
    return result ? toPageResponse(result) : null;
}

/** Every enabled proactive page (for the scheduler: daily briefs and leave-now reminders). */
export async function findAllProactivePages(): Promise<Page[]> {
    const docs = await getCollection()
        .find({ type: 'message', 'proactive.enabled': true, isTrashed: { $ne: true } })
        .limit(2000)
        .toArray();
    return docs.map(toPageResponse);
}

/**
 * Messages pages with an enabled proactive bot whose Mac data belongs to `ownerUserId`.
 * Optionally limited to one notebook.
 */
export async function findProactivePages(
    ownerUserId: string,
    notebookId?: string,
): Promise<Page[]> {
    const filter: Record<string, unknown> = {
        type: 'message',
        'proactive.enabled': true,
        'proactive.ownerUserId': ownerUserId,
        isTrashed: { $ne: true },
    };
    if (notebookId) {
        if (!ObjectId.isValid(notebookId)) return [];
        filter.notebookId = new ObjectId(notebookId);
    }
    const docs = await getCollection().find(filter).limit(200).toArray();
    return docs.map(toPageResponse);
}

/**
 * A user's device data pages (Messages, Mail…), optionally in one notebook. Each page
 * opens its owner's data only, so only pages the user created count.
 */
export async function findDeviceDataPages(
    ownerUserId: string,
    notebookId?: string,
): Promise<Page[]> {
    if (!ObjectId.isValid(ownerUserId)) return [];
    const filter: Record<string, unknown> = {
        type: 'devicedata',
        userId: new ObjectId(ownerUserId),
        isTrashed: { $ne: true },
    };
    if (notebookId) {
        if (!ObjectId.isValid(notebookId)) return [];
        filter.notebookId = new ObjectId(notebookId);
    }
    const docs = await getCollection().find(filter).limit(500).toArray();
    return docs.map(toPageResponse);
}

/** The notebook's About me page, if it has one (there is at most one per notebook). */
export async function findAboutMePage(notebookId: string): Promise<Page | null> {
    if (!ObjectId.isValid(notebookId)) return null;
    const doc = await getCollection().findOne({
        type: 'aboutme',
        notebookId: new ObjectId(notebookId),
        isTrashed: { $ne: true },
    });
    return doc ? toPageResponse(doc) : null;
}

/** Every device data page in a notebook, whoever created it. */
export async function findDeviceDataPagesInNotebook(notebookId: string): Promise<Page[]> {
    if (!ObjectId.isValid(notebookId)) return [];
    const docs = await getCollection()
        .find({
            type: 'devicedata',
            notebookId: new ObjectId(notebookId),
            isTrashed: { $ne: true },
        })
        .limit(500)
        .toArray();
    return docs.map(toPageResponse);
}
