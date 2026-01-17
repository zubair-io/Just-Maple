import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { User, CreateUser, UserResponse } from '@maple/shared';
import { fetchGravatarProfile, getGravatarUrl } from '../services/gravatar.service';
import { deleteProfilePicture } from '../services/storage.service';

interface UserDocument {
    _id: ObjectId;
    email: string;
    displayName?: string;
    profilePictureUrl?: string;
    admin?: boolean;
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

    // Try to fetch Gravatar profile data
    const gravatarProfile = await fetchGravatarProfile(data.email);

    const doc: Omit<UserDocument, '_id'> = {
        email: data.email.toLowerCase(),
        displayName: data.displayName || gravatarProfile.displayName,
        // Use Gravatar thumbnail if available, otherwise generate Gravatar URL
        profilePictureUrl: gravatarProfile.thumbnailUrl || getGravatarUrl(data.email),
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as UserDocument);

    return {
        _id: result.insertedId.toString(),
        email: doc.email,
        displayName: doc.displayName,
        profilePictureUrl: doc.profilePictureUrl,
    };
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
    profilePictureUrl: string,
): Promise<UserResponse | null> {
    try {
        // Get current user to delete old picture if it's not from Gravatar
        const currentUser = await findUserById(userId);
        if (
            currentUser?.profilePictureUrl &&
            !currentUser.profilePictureUrl.includes('gravatar.com')
        ) {
            // Delete old custom profile picture
            await deleteProfilePicture(currentUser.profilePictureUrl);
        }

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    profilePictureUrl,
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
