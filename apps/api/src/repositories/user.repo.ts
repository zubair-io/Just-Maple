import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { User, CreateUser, UserResponse } from '@maple/shared';

interface UserDocument {
    _id: ObjectId;
    email: string;
    displayName?: string;
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

export async function createUser(data: CreateUser): Promise<UserResponse> {
    const now = new Date();
    const doc: Omit<UserDocument, '_id'> = {
        email: data.email.toLowerCase(),
        displayName: data.displayName,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as UserDocument);

    return {
        _id: result.insertedId.toString(),
        email: doc.email,
        displayName: doc.displayName,
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
