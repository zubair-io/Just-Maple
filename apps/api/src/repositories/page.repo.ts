import { ObjectId, Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type {
    Page,
    PageContent,
    PageType,
    CreatePageInput,
    UpdatePageInput,
    PageTodoMeta,
    PublishPageInput,
} from '@maple/shared';
import { findNotebooksByUserId, findNotebookByIdWithAccess } from './notebook.repo';
import { deleteMemo, deleteMemosByPageId } from './memo.repo';
import { deleteWhiteboard } from './whiteboard.repo';
import { deleteKanbanBoard } from './kanban-board.repo';
import { isDevMode, isDocPage, getDocPage, pageIdToSlug } from '../services/docs.service';

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
    // Public publishing fields
    isPublished?: boolean;
    publishedSlug?: string;
    publishedAt?: Date;
    publishedOrder?: number;
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
        isPublished: doc.isPublished,
        publishedSlug: doc.publishedSlug,
        publishedAt: doc.publishedAt?.toISOString(),
        publishedOrder: doc.publishedOrder,
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
        return docs.map(toPageResponse);
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

    const docs = await getCollection().find(query).sort({ updatedAt: -1 }).toArray();
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

        // Check write access based on notebook or ownership
        if (doc.notebookId) {
            // Page has a notebook - check notebook write access
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
                userId,
                'write',
            );
            if (!notebook) return null; // No write access to the notebook
        } else {
            // Page has no notebook - only owner can update
            if (doc.userId.toString() !== userId) return null;
        }

        // If moving to a new notebook, verify write access to the new notebook
        if (
            data.notebookId !== undefined &&
            data.notebookId &&
            data.notebookId !== doc.notebookId?.toString()
        ) {
            const newNotebook = await findNotebookByIdWithAccess(data.notebookId, userId, 'write');
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

        // Check write access based on notebook or ownership
        if (doc.notebookId) {
            // Page has a notebook - check notebook write access
            const notebook = await findNotebookByIdWithAccess(
                doc.notebookId.toString(),
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
            await deleteMemo(doc.id);
        } else if (doc.type === 'whiteboard') {
            await deleteWhiteboard(doc.id);
        } else if (doc.type === 'kanban') {
            await deleteKanbanBoard(doc.id);
            // Also delete all card memos that reference this kanban page
            await deleteMemosByPageId(doc.id);
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
        const result = await getCollection().deleteMany({
            isTrashed: true,
            $or: [
                { notebookId: { $in: notebookIds } },
                { notebookId: { $exists: false }, userId: new ObjectId(userId) },
                { notebookId: null as any, userId: new ObjectId(userId) },
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
 * Generate a URL-friendly slug from a title
 */
function titleToSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 200);
}

/**
 * Update a page's publish state (slug, order, visibility)
 * Requires write access to the page's notebook
 */
export async function publishPage(
    pageId: string,
    userId: string,
    data: PublishPageInput,
): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({ id: pageId });
        if (!doc) return null;

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
            if (data.isPublished && !doc.publishedAt) {
                updateData.publishedAt = new Date();
            }
        }
        if (data.publishedSlug !== undefined) {
            updateData.publishedSlug = data.publishedSlug;
        } else if (data.isPublished && !doc.publishedSlug) {
            // Auto-generate slug from title if publishing and no slug set
            updateData.publishedSlug = titleToSlug(doc.title || 'untitled');
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
        const docs = await getCollection()
            .find({
                notebookId: new ObjectId(notebookId),
                isPublished: true,
                isTrashed: { $ne: true },
                type: { $ne: 'message' }, // Never publish message pages
            })
            .sort({ publishedOrder: 1, title: 1 })
            .toArray();
        return docs.map(toPageResponse);
    } catch {
        return [];
    }
}

/**
 * Find a single published page by slug within a notebook (no auth - for public access)
 */
export async function findPublishedPageBySlug(
    notebookId: string,
    pageSlug: string,
): Promise<Page | null> {
    try {
        const doc = await getCollection().findOne({
            notebookId: new ObjectId(notebookId),
            publishedSlug: pageSlug,
            isPublished: true,
            isTrashed: { $ne: true },
        });
        return doc ? toPageResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Bulk publish all pages in a notebook (when notebook is made public)
 * Sets isPublished=true and auto-generates slugs for all non-message pages
 */
export async function bulkPublishPagesForNotebook(notebookId: string): Promise<number> {
    try {
        const docs = await getCollection()
            .find({
                notebookId: new ObjectId(notebookId),
                isTrashed: { $ne: true },
                type: { $ne: 'message' },
                isPublished: { $ne: true },
            })
            .toArray();

        let count = 0;
        for (const doc of docs) {
            const slug = titleToSlug(doc.title || 'untitled');
            await getCollection().updateOne(
                { _id: doc._id },
                {
                    $set: {
                        isPublished: true,
                        publishedSlug: slug,
                        publishedAt: new Date(),
                        updatedAt: new Date(),
                    },
                },
            );
            count++;
        }
        return count;
    } catch {
        return 0;
    }
}
