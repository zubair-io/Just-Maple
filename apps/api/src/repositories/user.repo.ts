import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { CreateUser, UserResponse, UserPreferences } from '@maple/shared';
import { deleteProfilePictures, type ProfilePictureUrls } from '../services/storage.service';

interface UserDocument {
    _id: ObjectId;
    email?: string;
    displayName?: string;
    profilePictureUrl?: string;
    profilePictureThumbnailUrl?: string;
    admin?: boolean;
    preferences?: UserPreferences;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<UserDocument> {
    return getDb().collection<UserDocument>('users');
}

function toUserResponse(doc: UserDocument): UserResponse {
    return {
        _id: doc._id.toString(),
        email: doc.email,
        displayName: doc.displayName,
        profilePictureUrl: doc.profilePictureUrl,
        profilePictureThumbnailUrl: doc.profilePictureThumbnailUrl,
        admin: doc.admin,
    };
}

export async function findUserByEmail(email: string): Promise<UserResponse | null> {
    const doc = await getCollection().findOne({ email: email.toLowerCase() });
    return doc ? toUserResponse(doc) : null;
}

export async function findUserById(id: string): Promise<UserResponse | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toUserResponse(doc) : null;
    } catch {
        return null;
    }
}

export async function findUsersByIds(ids: string[]): Promise<Map<string, UserResponse>> {
    const userMap = new Map<string, UserResponse>();
    if (ids.length === 0) return userMap;

    try {
        const objectIds = ids.map((id) => new ObjectId(id));
        const docs = await getCollection()
            .find({ _id: { $in: objectIds } })
            .toArray();

        for (const doc of docs) {
            userMap.set(doc._id.toString(), toUserResponse(doc));
        }
    } catch {
        // Return empty map on error
    }

    return userMap;
}

export async function createUser(data: CreateUser): Promise<UserResponse> {
    const now = new Date();

    const doc: Omit<UserDocument, '_id'> = {
        ...(data.email ? { email: data.email.toLowerCase() } : {}),
        displayName: data.displayName,
        createdAt: now,
        updatedAt: now,
    };
    const result = await getCollection().insertOne(doc as UserDocument);
    return toUserResponse({ ...doc, _id: result.insertedId });
}

export async function findOrCreateUser(email: string): Promise<UserResponse> {
    const existing = await findUserByEmail(email);
    if (existing) {
        return existing;
    }
    return createUser({ email });
}

export async function updateUserDisplayName(
    userId: string,
    displayName: string | undefined,
): Promise<UserResponse | null> {
    try {
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    displayName: displayName || undefined,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );

        return result ? toUserResponse(result) : null;
    } catch {
        return null;
    }
}

export async function updateUserProfilePicture(
    userId: string,
    profilePictures: ProfilePictureUrls,
): Promise<UserResponse | null> {
    try {
        // Get current user to delete old pictures (from our storage)
        const currentUser = await findUserById(userId);
        if (currentUser?.profilePictureUrl) {
            // Delete old profile pictures from storage
            await deleteProfilePictures(
                currentUser.profilePictureUrl,
                currentUser.profilePictureThumbnailUrl,
            );
        }

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    profilePictureUrl: profilePictures.thumbnailUrl,
                    profilePictureFullUrl: profilePictures.fullUrl,
                    profilePictureThumbnailUrl: profilePictures.thumbnailUrl,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );

        return result ? toUserResponse(result) : null;
    } catch {
        return null;
    }
}

// ============================================
// User Preferences Functions
// ============================================

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
    try {
        const doc = await getCollection().findOne(
            { _id: new ObjectId(userId) },
            { projection: { preferences: 1 } },
        );
        return doc?.preferences || null;
    } catch {
        return null;
    }
}

/**
 * Update user preferences (partial update)
 */
export async function updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>,
): Promise<UserPreferences | null> {
    try {
        const updateFields: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        // Build dot notation updates for nested preferences
        if (preferences.tagColors !== undefined) {
            updateFields['preferences.tagColors'] = preferences.tagColors;
        }

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(userId) },
            { $set: updateFields },
            { returnDocument: 'after' },
        );

        return result?.preferences || null;
    } catch {
        return null;
    }
}

/**
 * Set a single tag color
 */
export async function setTagColor(
    userId: string,
    tagName: string,
    color: string,
): Promise<boolean> {
    try {
        const result = await getCollection().updateOne(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    [`preferences.tagColors.${tagName}`]: color,
                    updatedAt: new Date(),
                },
            },
        );
        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Remove a tag color
 */
export async function removeTagColor(userId: string, tagName: string): Promise<boolean> {
    try {
        const result = await getCollection().updateOne(
            { _id: new ObjectId(userId) },
            {
                $unset: { [`preferences.tagColors.${tagName}`]: '' },
                $set: { updatedAt: new Date() },
            },
        );
        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Get all tag colors for a user
 */
export async function getTagColors(userId: string): Promise<Record<string, string>> {
    try {
        const doc = await getCollection().findOne(
            { _id: new ObjectId(userId) },
            { projection: { 'preferences.tagColors': 1 } },
        );
        return doc?.preferences?.tagColors || {};
    } catch {
        return {};
    }
}
