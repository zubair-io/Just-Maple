import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Tag,
    CreateTagInput,
    UpdateTagInput,
    AccessLevel,
    TagSharing,
    ShareTagInput,
    TagValue,
} from '@maple/shared';

interface SharedWithEntryDocument {
    userId: string;
    accessLevel: AccessLevel;
}

interface TagSharingDocument {
    sharedWith: SharedWithEntryDocument[];
    isPublic?: boolean;
}

interface TagDocument {
    _id: ObjectId;
    type: 'folder';
    value: TagValue;
    label: string;
    sharing: TagSharingDocument;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<TagDocument> {
    return getDb().collection<TagDocument>('tags');
}

// Legacy document type (with userId instead of sharing, and deprecated fields)
interface LegacyTagDocument {
    _id: ObjectId;
    userId?: ObjectId;
    type: 'folder';
    value: string;
    label: string;
    color?: string;
    parentId?: ObjectId;
    order?: number;
    sharing?: TagSharingDocument;
    createdAt: Date;
    updatedAt: Date;
}

function toTagResponse(doc: LegacyTagDocument): Tag {
    // Handle migration from userId to sharing
    let sharing: TagSharing;
    if (doc.sharing) {
        sharing = {
            sharedWith: doc.sharing.sharedWith,
            isPublic: doc.sharing.isPublic,
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
    ) as TagValue;

    return {
        _id: doc._id.toString(),
        type: doc.type,
        value,
        label: doc.label,
        sharing,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Check if a user has access to a tag
 */
export function hasAccess(tag: Tag, userId: string, requiredLevel?: AccessLevel): boolean {
    if (tag.sharing.isPublic && (!requiredLevel || requiredLevel === 'read')) {
        return true;
    }
    const entry = tag.sharing.sharedWith.find((e) => e.userId === userId);
    if (!entry) return false;
    if (!requiredLevel) return true;
    if (requiredLevel === 'read') return true;
    if (requiredLevel === 'write')
        return entry.accessLevel === 'write' || entry.accessLevel === 'owner';
    if (requiredLevel === 'owner') return entry.accessLevel === 'owner';
    return false;
}

/**
 * Get the user's access level for a tag
 */
export function getAccessLevel(tag: Tag, userId: string): AccessLevel | null {
    const entry = tag.sharing.sharedWith.find((e) => e.userId === userId);
    if (entry) return entry.accessLevel;
    if (tag.sharing.isPublic) return 'read';
    return null;
}

function labelToSlug(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

/**
 * Find all tags that a user has access to
 * Handles both new sharing format and legacy userId format
 */
export async function findTagsByUserId(userId: string): Promise<Tag[]> {
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
    return docs.map(toTagResponse);
}

/**
 * Find a tag by ID if the user has access
 * Handles both new sharing format and legacy userId format
 */
export async function findTagById(id: string, userId: string): Promise<Tag | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(id),
            $or: [
                { 'sharing.sharedWith.userId': userId },
                { 'sharing.isPublic': true },
                { userId: new ObjectId(userId) }, // Legacy format
            ],
        });
        return doc ? toTagResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a tag by ID without access check (for internal use like broadcasting)
 */
export async function findTagByIdUnsafe(id: string): Promise<Tag | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toTagResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a tag by ID with specific access level required
 */
export async function findTagByIdWithAccess(
    id: string,
    userId: string,
    requiredAccess: AccessLevel,
): Promise<Tag | null> {
    const tag = await findTagById(id, userId);
    if (!tag) return null;
    if (!hasAccess(tag, userId, requiredAccess)) return null;
    return tag;
}

/**
 * Create a new tag with the user as owner
 */
export async function createTag(userId: string, data: CreateTagInput): Promise<Tag> {
    const now = new Date();
    const value = data.value || 'mixed';
    const doc: Omit<TagDocument, '_id'> = {
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

    const result = await getCollection().insertOne(doc as TagDocument);

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
 * Update a tag (requires write access)
 */
export async function updateTag(
    id: string,
    userId: string,
    data: UpdateTagInput,
): Promise<Tag | null> {
    // First check if user has write access
    const tag = await findTagByIdWithAccess(id, userId, 'write');
    if (!tag) return null;

    const updateData: Partial<TagDocument> = {
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

        return result ? toTagResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Delete a tag (requires owner access)
 */
export async function deleteTag(id: string, userId: string): Promise<boolean> {
    // First check if user is owner
    const tag = await findTagByIdWithAccess(id, userId, 'owner');
    if (!tag) return false;

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
 * Share a tag with another user (requires owner access)
 */
export async function shareTag(
    tagId: string,
    ownerId: string,
    data: ShareTagInput,
): Promise<Tag | null> {
    // Check if requesting user is owner
    const tag = await findTagByIdWithAccess(tagId, ownerId, 'owner');
    if (!tag) return null;

    // Check if user is already shared with
    const existingEntry = tag.sharing.sharedWith.find((e) => e.userId === data.userId);
    if (existingEntry) {
        // Update access level
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(tagId), 'sharing.sharedWith.userId': data.userId },
            {
                $set: {
                    'sharing.sharedWith.$.accessLevel': data.accessLevel,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
        return result ? toTagResponse(result) : null;
    } else {
        // Add new entry
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(tagId) },
            {
                $push: {
                    'sharing.sharedWith': { userId: data.userId, accessLevel: data.accessLevel },
                },
                $set: { updatedAt: new Date() },
            },
            { returnDocument: 'after' },
        );
        return result ? toTagResponse(result) : null;
    }
}

/**
 * Remove a user's access to a tag (requires owner access)
 */
export async function unshareTag(
    tagId: string,
    ownerId: string,
    targetUserId: string,
): Promise<Tag | null> {
    // Check if requesting user is owner
    const tag = await findTagByIdWithAccess(tagId, ownerId, 'owner');
    if (!tag) return null;

    // Cannot remove owner
    if (targetUserId === ownerId) return null;

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(tagId) },
        {
            $pull: { 'sharing.sharedWith': { userId: targetUserId } },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after' },
    );
    return result ? toTagResponse(result) : null;
}

/**
 * Update tag's public status (requires owner access)
 */
export async function updateTagPublicStatus(
    tagId: string,
    ownerId: string,
    isPublic: boolean,
): Promise<Tag | null> {
    // Check if requesting user is owner
    const tag = await findTagByIdWithAccess(tagId, ownerId, 'owner');
    if (!tag) return null;

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(tagId) },
        {
            $set: { 'sharing.isPublic': isPublic, updatedAt: new Date() },
        },
        { returnDocument: 'after' },
    );
    return result ? toTagResponse(result) : null;
}

/**
 * Get all users with access to a tag
 */
export async function getTagMembers(
    tagId: string,
    userId: string,
): Promise<Tag['sharing']['sharedWith'] | null> {
    const tag = await findTagById(tagId, userId);
    if (!tag) return null;
    return tag.sharing.sharedWith;
}
