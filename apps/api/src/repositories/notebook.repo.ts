import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Notebook,
    CreateNotebookInput,
    UpdateNotebookInput,
    AccessLevel,
    NotebookSharing,
    ShareNotebookInput,
    NotebookValue,
    NotebookMember,
    UpdatePublicConfigInput,
} from '@maple/shared';
import { isDevMode, isDocNotebook, getDocNotebook } from '../services/docs.service';

interface SharedWithEntryDocument {
    userId: string;
    accessLevel: AccessLevel;
}

interface SharedBotEntryDocument {
    userBotId: string;
}

interface NotebookSharingDocument {
    sharedWith: SharedWithEntryDocument[];
    isPublic?: boolean;
    sharedBots?: SharedBotEntryDocument[];
}

interface PublicConfigDocument {
    displayName?: string;
    description?: string;
    faviconUrl?: string;
    logoUrl?: string;
    landingPageId?: string;
    showPageList?: boolean;
}

interface NotebookDocument {
    _id: ObjectId;
    type: 'folder';
    value: NotebookValue;
    label: string;
    sharing: NotebookSharingDocument;
    slug?: string;
    publicConfig?: PublicConfigDocument;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<NotebookDocument> {
    return getDb().collection<NotebookDocument>('notebooks');
}

// Legacy document type (with userId instead of sharing, and deprecated fields)
interface LegacyNotebookDocument {
    _id: ObjectId;
    userId?: ObjectId;
    type: 'folder';
    value: string;
    label: string;
    color?: string;
    parentId?: ObjectId;
    order?: number;
    sharing?: NotebookSharingDocument;
    slug?: string;
    publicConfig?: PublicConfigDocument;
    createdAt: Date;
    updatedAt: Date;
}

function toNotebookResponse(doc: LegacyNotebookDocument): Notebook {
    // Handle migration from userId to sharing
    let sharing: NotebookSharing;
    if (doc.sharing) {
        sharing = {
            sharedWith: doc.sharing.sharedWith,
            isPublic: doc.sharing.isPublic,
            sharedBots: doc.sharing.sharedBots,
        };
    } else if (doc.userId) {
        // Migrate legacy userId to sharing format
        sharing = {
            sharedWith: [{ userId: doc.userId.toString(), accessLevel: 'owner' }],
            isPublic: false,
        };
    } else {
        // Fallback (shouldn't happen)
        sharing = { sharedWith: [], isPublic: false };
    }

    // Normalize value - default to 'mixed' for legacy docs
    const value = (
        ['mixed', 'recordings', 'notes'].includes(doc.value) ? doc.value : 'mixed'
    ) as NotebookValue;

    return {
        _id: doc._id.toString(),
        type: doc.type,
        value,
        label: doc.label,
        sharing,
        slug: doc.slug,
        publicConfig: doc.publicConfig,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Check if a user has access to a notebook
 */
export function hasAccess(
    notebook: Notebook,
    userId: string,
    requiredLevel?: AccessLevel,
): boolean {
    if (notebook.sharing.isPublic && (!requiredLevel || requiredLevel === 'read')) {
        return true;
    }
    const entry = notebook.sharing.sharedWith.find((e) => e.userId === userId);
    if (!entry) return false;
    if (!requiredLevel) return true;
    if (requiredLevel === 'read') return true;
    if (requiredLevel === 'write')
        return entry.accessLevel === 'write' || entry.accessLevel === 'owner';
    if (requiredLevel === 'owner') return entry.accessLevel === 'owner';
    return false;
}

/**
 * Get the user's access level for a notebook
 */
export function getAccessLevel(notebook: Notebook, userId: string): AccessLevel | null {
    const entry = notebook.sharing.sharedWith.find((e) => e.userId === userId);
    if (entry) return entry.accessLevel;
    if (notebook.sharing.isPublic) return 'read';
    return null;
}

/**
 * Find all notebooks that a user has access to
 * Handles both new sharing format and legacy userId format
 */
export async function findNotebooksByUserId(userId: string): Promise<Notebook[]> {
    const docs = await getCollection()
        .find({
            $or: [
                { 'sharing.sharedWith.userId': userId },
                { 'sharing.isPublic': true },
                { userId: new ObjectId(userId) }, // Legacy format
            ],
        })
        .sort({ label: 1 })
        .toArray();
    const notebooks = docs.map(toNotebookResponse);

    // Inject virtual Documentation notebook in dev mode
    if (isDevMode()) {
        notebooks.push(getDocNotebook());
    }

    return notebooks;
}

/**
 * Find a notebook by ID if the user has access
 * Handles both new sharing format and legacy userId format
 */
export async function findNotebookById(id: string, userId: string): Promise<Notebook | null> {
    // Handle virtual Documentation notebook in dev mode
    if (isDevMode() && isDocNotebook(id)) {
        return getDocNotebook();
    }

    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(id),
            $or: [
                { 'sharing.sharedWith.userId': userId },
                { 'sharing.isPublic': true },
                { userId: new ObjectId(userId) }, // Legacy format
            ],
        });
        return doc ? toNotebookResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a notebook by ID without access check (for internal use like broadcasting)
 */
export async function findNotebookByIdUnsafe(id: string): Promise<Notebook | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toNotebookResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a notebook by ID with specific access level required
 */
export async function findNotebookByIdWithAccess(
    id: string,
    userId: string,
    requiredAccess: AccessLevel,
): Promise<Notebook | null> {
    const notebook = await findNotebookById(id, userId);
    if (!notebook) return null;
    if (!hasAccess(notebook, userId, requiredAccess)) return null;
    return notebook;
}

/**
 * Get all user IDs who have access to a notebook (for event broadcasting)
 * Returns all users in the sharedWith list (owner + collaborators)
 */
export async function getUsersWithNotebookAccess(notebookId: string): Promise<string[]> {
    const notebook = await findNotebookByIdUnsafe(notebookId);
    if (!notebook) return [];

    // Return all users in the sharing list
    return notebook.sharing.sharedWith.map((entry) => entry.userId);
}

/**
 * Create a new notebook with the user as owner
 */
export async function createNotebook(userId: string, data: CreateNotebookInput): Promise<Notebook> {
    const now = new Date();
    const value = data.value || 'mixed';
    const doc: Omit<NotebookDocument, '_id'> = {
        type: 'folder',
        value,
        label: data.label,
        sharing: {
            sharedWith: [{ userId, accessLevel: 'owner' }],
            isPublic: false,
        },
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as NotebookDocument);

    return {
        _id: result.insertedId.toString(),
        type: 'folder',
        value,
        label: doc.label,
        sharing: doc.sharing,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Update a notebook (requires write access)
 */
export async function updateNotebook(
    id: string,
    userId: string,
    data: UpdateNotebookInput,
): Promise<Notebook | null> {
    // First check if user has write access
    const notebook = await findNotebookByIdWithAccess(id, userId, 'write');
    if (!notebook) return null;

    const updateData: Partial<NotebookDocument> = {
        updatedAt: new Date(),
    };

    if (data.label !== undefined) {
        updateData.label = data.label;
    }
    if (data.value !== undefined) {
        updateData.value = data.value;
    }

    try {
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateData },
            { returnDocument: 'after' },
        );

        return result ? toNotebookResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Delete a notebook (requires owner access)
 */
export async function deleteNotebook(id: string, userId: string): Promise<boolean> {
    // First check if user is owner
    const notebook = await findNotebookByIdWithAccess(id, userId, 'owner');
    if (!notebook) return false;

    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(id),
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Share a notebook with another user (requires owner access)
 */
export async function shareNotebook(
    notebookId: string,
    ownerId: string,
    data: ShareNotebookInput,
): Promise<Notebook | null> {
    // Check if requesting user is owner
    const notebook = await findNotebookByIdWithAccess(notebookId, ownerId, 'owner');
    if (!notebook) return null;

    // Check if user is already shared with
    const existingEntry = notebook.sharing.sharedWith.find((e) => e.userId === data.userId);
    if (existingEntry) {
        // Update access level
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(notebookId), 'sharing.sharedWith.userId': data.userId },
            {
                $set: {
                    'sharing.sharedWith.$.accessLevel': data.accessLevel,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
        return result ? toNotebookResponse(result) : null;
    } else {
        // Add new entry
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(notebookId) },
            {
                $push: {
                    'sharing.sharedWith': { userId: data.userId, accessLevel: data.accessLevel },
                },
                $set: { updatedAt: new Date() },
            },
            { returnDocument: 'after' },
        );
        return result ? toNotebookResponse(result) : null;
    }
}

/**
 * Remove a user's access to a notebook (requires owner access)
 * Also removes all bots owned by the user
 */
export async function unshareNotebook(
    notebookId: string,
    ownerId: string,
    targetUserId: string,
): Promise<Notebook | null> {
    // Check if requesting user is owner
    const notebook = await findNotebookByIdWithAccess(notebookId, ownerId, 'owner');
    if (!notebook) return null;

    // Cannot remove owner
    if (targetUserId === ownerId) return null;

    // Find all bots owned by the user being removed
    const { findUserBotsByUserId } = await import('./user-bot.repo');
    const userBots = await findUserBotsByUserId(targetUserId);
    const userBotIds = userBots.map((b) => b._id);

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(notebookId) },
        {
            $pull: {
                'sharing.sharedWith': { userId: targetUserId },
                'sharing.sharedBots': { userBotId: { $in: userBotIds } },
            },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after' },
    );
    return result ? toNotebookResponse(result) : null;
}

/**
 * Update notebook's public status (requires owner access)
 */
export async function updateNotebookPublicStatus(
    notebookId: string,
    ownerId: string,
    isPublic: boolean,
): Promise<Notebook | null> {
    // Check if requesting user is owner
    const notebook = await findNotebookByIdWithAccess(notebookId, ownerId, 'owner');
    if (!notebook) return null;

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(notebookId) },
        {
            $set: { 'sharing.isPublic': isPublic, updatedAt: new Date() },
        },
        { returnDocument: 'after' },
    );
    return result ? toNotebookResponse(result) : null;
}

/**
 * Update notebook's public configuration (requires owner access)
 * Handles isPublic, slug, and publicConfig in one operation
 */
export async function updateNotebookPublicConfig(
    notebookId: string,
    ownerId: string,
    data: UpdatePublicConfigInput,
): Promise<Notebook | null> {
    const notebook = await findNotebookByIdWithAccess(notebookId, ownerId, 'owner');
    if (!notebook) return null;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.isPublic !== undefined) {
        updateFields['sharing.isPublic'] = data.isPublic;
    }
    if (data.slug !== undefined) {
        const normalizedSlug = data.slug.trim().toLowerCase();
        // Validate slug uniqueness
        const existing = await findNotebookBySlugAny(normalizedSlug);
        if (existing && existing._id !== notebookId) {
            return null; // Slug already taken
        }
        updateFields.slug = normalizedSlug;
    }
    if (data.publicConfig !== undefined) {
        updateFields.publicConfig = data.publicConfig;
    }

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(notebookId) },
        { $set: updateFields },
        { returnDocument: 'after' },
    );
    return result ? toNotebookResponse(result) : null;
}

/**
 * Find a public notebook by its slug (no auth required)
 */
export async function findNotebookBySlug(slug: string): Promise<Notebook | null> {
    try {
        const doc = await getCollection().findOne({
            slug,
            'sharing.isPublic': true,
        });
        return doc ? toNotebookResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a notebook by slug without requiring it to be public (for slug uniqueness checks)
 */
async function findNotebookBySlugAny(slug: string): Promise<Notebook | null> {
    try {
        const doc = await getCollection().findOne({ slug });
        return doc ? toNotebookResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Get all users with access to a notebook
 */
export async function getNotebookMembers(
    notebookId: string,
    userId: string,
): Promise<Notebook['sharing']['sharedWith'] | null> {
    const notebook = await findNotebookById(notebookId, userId);
    if (!notebook) return null;
    return notebook.sharing.sharedWith;
}

/**
 * Get all users with access to a notebook, including full user data
 */
export async function getNotebookMembersWithUserData(
    notebookId: string,
    userId: string,
): Promise<NotebookMember[] | null> {
    const notebook = await findNotebookById(notebookId, userId);
    if (!notebook) return null;

    // Get the users collection
    const usersCollection = getDb().collection('users');

    // Fetch full user data for each member
    const members: NotebookMember[] = [];
    for (const member of notebook.sharing.sharedWith) {
        // Validate that userId is a valid ObjectId before querying
        if (!ObjectId.isValid(member.userId)) {
            console.warn(
                `[NotebookRepo] Invalid userId in sharedWith: ${member.userId} for notebook ${notebookId}`,
            );
            continue;
        }

        try {
            const user = await usersCollection.findOne({ _id: new ObjectId(member.userId) });
            if (user) {
                members.push({
                    userId: member.userId,
                    email: user.email,
                    displayName: user.displayName,
                    profilePictureUrl: user.profilePictureUrl,
                    accessLevel: member.accessLevel,
                });
            }
        } catch (error) {
            console.error(
                `[NotebookRepo] Failed to fetch user ${member.userId} for notebook ${notebookId}:`,
                error,
            );
            // Continue to next member
        }
    }

    return members;
}

/**
 * Share a bot with a notebook (requires owner access)
 */
export async function shareBotToNotebook(
    notebookId: string,
    ownerId: string,
    userBotId: string,
): Promise<Notebook | null> {
    // Verify user is notebook owner
    const notebook = await findNotebookByIdWithAccess(notebookId, ownerId, 'owner');
    if (!notebook) return null;

    // Verify bot exists and is owned by a notebook member (or the owner)
    const { findUserBotById } = await import('./user-bot.repo');
    const bot = await findUserBotById(userBotId);
    if (!bot) return null;

    // Check if bot owner is the notebook owner or a member
    const memberIds = notebook.sharing.sharedWith.map((m) => m.userId);
    const isOwner = bot.userId === ownerId;
    const isMember = memberIds.includes(bot.userId);
    if (!isOwner && !isMember) {
        return null; // Bot owner must be notebook owner or member
    }

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(notebookId) },
        {
            $addToSet: { 'sharing.sharedBots': { userBotId } },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after' },
    );
    return result ? toNotebookResponse(result) : null;
}

/**
 * Remove a bot from a notebook (requires owner access)
 */
export async function unshareBotFromNotebook(
    notebookId: string,
    ownerId: string,
    userBotId: string,
): Promise<Notebook | null> {
    const notebook = await findNotebookByIdWithAccess(notebookId, ownerId, 'owner');
    if (!notebook) return null;

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(notebookId) },
        {
            $pull: { 'sharing.sharedBots': { userBotId } },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after' },
    );
    return result ? toNotebookResponse(result) : null;
}

/**
 * Get bots shared with a notebook
 * Returns array of bot IDs
 */
export async function getNotebookBots(notebookId: string): Promise<string[]> {
    const notebookDoc = await getCollection().findOne({ _id: new ObjectId(notebookId) });
    if (!notebookDoc) return [];
    return notebookDoc.sharing?.sharedBots?.map((b) => b.userBotId) || [];
}
