import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Message, NoteContent, CreateMessageInput, UpdateMessageInput } from '@maple/shared';
import { findTagByIdWithAccess } from './tag.repo';

interface MessageDocument {
    _id: ObjectId;
    tagId: ObjectId;
    userId: ObjectId;
    content: NoteContent;
    createdAt: Date;
    updatedAt: Date;
    editedAt?: Date;
    deletedAt?: Date;
}

interface MessageWithUser extends MessageDocument {
    user?: { email: string; displayName?: string; profilePictureUrl?: string }[];
}

function getCollection(): Collection<MessageDocument> {
    return getDb().collection<MessageDocument>('messages');
}

function toMessageResponse(
    doc: MessageDocument,
    senderEmail?: string,
    senderDisplayName?: string,
    senderProfilePictureUrl?: string,
): Message {
    return {
        _id: doc._id.toString(),
        tagId: doc.tagId.toString(),
        userId: doc.userId.toString(),
        senderEmail,
        senderDisplayName,
        senderProfilePictureUrl,
        content: doc.content,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        editedAt: doc.editedAt?.toISOString(),
        deletedAt: doc.deletedAt?.toISOString(),
    };
}

export async function findMessagesByTagId(
    tagId: string,
    options?: {
        limit?: number;
        before?: string; // Cursor-based pagination: messages before this ID
    },
): Promise<Message[]> {
    const matchStage: Record<string, unknown> = {
        tagId: new ObjectId(tagId),
        deletedAt: { $exists: false },
    };

    // Cursor-based pagination
    if (options?.before) {
        try {
            matchStage._id = { $lt: new ObjectId(options.before) };
        } catch {
            // Invalid ObjectId, ignore
        }
    }

    const limit = options?.limit || 50;

    // Use aggregation to join with users collection
    const docs = await getCollection()
        .aggregate<MessageWithUser>([
            { $match: matchStage },
            { $sort: { _id: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user',
                },
            },
        ])
        .toArray();

    // Return in chronological order (oldest first)
    return docs.reverse().map((doc) => {
        const user = doc.user?.[0];
        return toMessageResponse(doc, user?.email, user?.displayName, user?.profilePictureUrl);
    });
}

export async function findMessageById(id: string, userId?: string): Promise<Message | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(id),
            deletedAt: { $exists: false },
        });
        if (!doc) return null;

        // If userId is provided, verify tag access
        if (userId) {
            const tag = await findTagByIdWithAccess(doc.tagId.toString(), userId, 'read');
            if (!tag) return null; // No access to the tag
        }

        return toMessageResponse(doc);
    } catch {
        return null;
    }
}

export async function createMessage(
    tagId: string,
    userId: string,
    data: CreateMessageInput,
    senderEmail?: string,
    senderDisplayName?: string,
    senderProfilePictureUrl?: string,
): Promise<Message> {
    const now = new Date();
    const doc: Omit<MessageDocument, '_id'> = {
        tagId: new ObjectId(tagId),
        userId: new ObjectId(userId),
        content: data.content,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as MessageDocument);

    return {
        _id: result.insertedId.toString(),
        tagId: tagId,
        userId: userId,
        senderEmail,
        senderDisplayName,
        senderProfilePictureUrl,
        content: doc.content,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export async function updateMessage(
    id: string,
    userId: string,
    data: UpdateMessageInput,
): Promise<Message | null> {
    const now = new Date();

    try {
        const result = await getCollection().findOneAndUpdate(
            {
                _id: new ObjectId(id),
                userId: new ObjectId(userId), // Only owner can edit
                deletedAt: { $exists: false },
            },
            {
                $set: {
                    content: data.content,
                    updatedAt: now,
                    editedAt: now,
                },
            },
            { returnDocument: 'after' },
        );

        return result ? toMessageResponse(result) : null;
    } catch {
        return null;
    }
}

export async function softDeleteMessage(id: string, userId: string): Promise<boolean> {
    const now = new Date();

    try {
        const result = await getCollection().updateOne(
            {
                _id: new ObjectId(id),
                userId: new ObjectId(userId), // Only owner can delete
                deletedAt: { $exists: false },
            },
            {
                $set: {
                    deletedAt: now,
                    updatedAt: now,
                },
            },
        );

        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

export async function countMessagesSince(tagId: string, since: Date): Promise<number> {
    try {
        return await getCollection().countDocuments({
            tagId: new ObjectId(tagId),
            deletedAt: { $exists: false },
            createdAt: { $gt: since },
        });
    } catch {
        return 0;
    }
}

export async function getLatestMessageTime(tagId: string): Promise<Date | null> {
    try {
        const doc = await getCollection()
            .find({
                tagId: new ObjectId(tagId),
                deletedAt: { $exists: false },
            })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();

        return doc.length > 0 ? doc[0].createdAt : null;
    } catch {
        return null;
    }
}
