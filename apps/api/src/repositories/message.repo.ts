import { ObjectId, Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type {
    Message,
    PageContent,
    CreateMessageInput,
    UpdateMessageInput,
    SenderType,
    Mention,
} from '@maple/shared';
import { findNotebookByIdWithAccess } from './notebook.repo';
import { findUsersByIds } from './user.repo';

/**
 * Generate a UUID v4 for message routing
 */
function generateMessageId(): string {
    return randomUUID();
}

interface MessageDocument {
    _id: ObjectId;
    id: string; // UUID v4 for routing
    notebookId: ObjectId;
    threadId?: ObjectId;
    userId: ObjectId;
    senderType?: SenderType;
    userBotId?: ObjectId;
    senderDisplayName?: string;
    senderProfilePictureUrl?: string;
    content: PageContent;
    mentions?: Mention[];
    hasThread?: boolean;
    createdAt: Date;
    updatedAt: Date;
    editedAt?: Date;
    deletedAt?: Date;
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
        id: doc.id,
        notebookId: doc.notebookId.toString(),
        threadId: doc.threadId?.toString(),
        userId: doc.userId.toString(),
        senderType: doc.senderType,
        userBotId: doc.userBotId?.toString(),
        senderEmail,
        // Prefer user lookup data (for users), fall back to document fields (for bots)
        senderDisplayName: senderDisplayName || doc.senderDisplayName,
        senderProfilePictureUrl: senderProfilePictureUrl || doc.senderProfilePictureUrl,
        content: doc.content,
        mentions: doc.mentions,
        hasThread: doc.hasThread,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        editedAt: doc.editedAt?.toISOString(),
        deletedAt: doc.deletedAt?.toISOString(),
    };
}

export async function findMessagesByNotebookId(
    notebookId: string,
    options?: {
        limit?: number;
        before?: string; // Cursor-based pagination: messages before this UUID id
    },
): Promise<Message[]> {
    const query: Record<string, unknown> = {
        notebookId: new ObjectId(notebookId),
        threadId: { $in: [null] }, // Only top-level messages, not thread replies
        deletedAt: { $exists: false },
    };

    // Cursor-based pagination using UUID id
    if (options?.before) {
        // Find the message with this UUID to get its _id for pagination
        const beforeMessage = await getCollection().findOne({ id: options.before });
        if (beforeMessage) {
            query._id = { $lt: beforeMessage._id };
        }
    }

    const limit = options?.limit || 500;

    // Fetch messages without user data
    const docs = await getCollection().find(query).sort({ _id: -1 }).limit(limit).toArray();

    // Batch fetch unique users
    const userIds = [...new Set(docs.map((doc) => doc.userId.toString()))];
    const usersMap = await findUsersByIds(userIds);

    // Return in chronological order (oldest first)
    return docs.reverse().map((doc) => {
        const user = usersMap.get(doc.userId.toString());
        return toMessageResponse(doc, user?.email, user?.displayName, user?.profilePictureUrl);
    });
}

export async function findMessageByMongoId(
    mongoId: string,
    userId?: string,
): Promise<Message | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(mongoId),
            deletedAt: { $exists: false },
        });
        if (!doc) return null;

        // If userId is provided, verify tag access
        if (userId) {
            const tag = await findNotebookByIdWithAccess(doc.notebookId.toString(), userId, 'read');
            if (!tag) return null; // No access to the tag
        }

        return toMessageResponse(doc);
    } catch {
        return null;
    }
}

export async function findMessageById(id: string, userId?: string): Promise<Message | null> {
    try {
        const doc = await getCollection().findOne({
            id,
            deletedAt: { $exists: false },
        });
        if (!doc) return null;

        // If userId is provided, verify tag access
        if (userId) {
            const tag = await findNotebookByIdWithAccess(doc.notebookId.toString(), userId, 'read');
            if (!tag) return null; // No access to the tag
        }

        return toMessageResponse(doc);
    } catch {
        return null;
    }
}

export async function createMessage(
    notebookId: string,
    userId: string,
    data: CreateMessageInput,
    senderEmail?: string,
    senderDisplayName?: string,
    senderProfilePictureUrl?: string,
    threadId?: string,
): Promise<Message> {
    const now = new Date();
    const messageId = generateMessageId();
    const doc: any = {
        id: messageId,
        notebookId: new ObjectId(notebookId),
        userId: new ObjectId(userId),
        content: data.content,
        createdAt: now,
        updatedAt: now,
    };

    // Only add threadId if it's provided (avoid storing null/undefined)
    if (threadId) {
        doc.threadId = new ObjectId(threadId);
    }

    // Note: senderDisplayName and senderProfilePictureUrl are NOT stored
    // They are passed through for real-time WebSocket broadcasts only
    // When messages are fetched later, user info comes from the $lookup

    const result = await getCollection().insertOne(doc);

    return {
        _id: result.insertedId.toString(),
        id: messageId,
        notebookId: notebookId,
        threadId: threadId,
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
                id,
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
                id,
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

export async function countMessagesSince(notebookId: string, since: Date): Promise<number> {
    try {
        return await getCollection().countDocuments({
            notebookId: new ObjectId(notebookId),
            deletedAt: { $exists: false },
            createdAt: { $gt: since },
        });
    } catch {
        return 0;
    }
}

export async function getLatestMessageTime(notebookId: string): Promise<Date | null> {
    try {
        const doc = await getCollection()
            .find({
                notebookId: new ObjectId(notebookId),
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

// ============================================
// Thread Message Functions
// ============================================

export async function findMessagesByThreadId(
    threadId: string,
    options?: {
        limit?: number;
        before?: string; // UUID id for cursor-based pagination
    },
): Promise<Message[]> {
    const query: Record<string, unknown> = {
        threadId: new ObjectId(threadId),
        deletedAt: { $exists: false },
    };

    // Cursor-based pagination using UUID id
    if (options?.before) {
        const beforeMessage = await getCollection().findOne({ id: options.before });
        if (beforeMessage) {
            query._id = { $lt: beforeMessage._id };
        }
    }

    const limit = options?.limit || 50;

    // Fetch messages without user data
    const docs = await getCollection().find(query).sort({ _id: -1 }).limit(limit).toArray();

    // Batch fetch unique users (only for non-bot messages)
    const userIds = [
        ...new Set(
            docs.filter((doc) => doc.senderType !== 'bot').map((doc) => doc.userId.toString()),
        ),
    ];
    const usersMap = await findUsersByIds(userIds);

    // Return in chronological order (oldest first)
    return docs.reverse().map((doc) => {
        // For bot messages, use the stored sender info
        if (doc.senderType === 'bot') {
            return toMessageResponse(doc);
        }
        const user = usersMap.get(doc.userId.toString());
        return toMessageResponse(doc, user?.email, user?.displayName, user?.profilePictureUrl);
    });
}

export async function createMessageInThread(data: {
    notebookId: string;
    threadId: string;
    userId: string;
    userBotId?: string;
    senderType: SenderType;
    senderDisplayName?: string;
    senderProfilePictureUrl?: string;
    content: PageContent;
}): Promise<Message> {
    const now = new Date();
    const messageId = generateMessageId();
    const isBot = data.senderType === 'bot';
    const doc: Omit<MessageDocument, '_id'> = {
        id: messageId,
        notebookId: new ObjectId(data.notebookId),
        threadId: new ObjectId(data.threadId),
        userId: new ObjectId(data.userId),
        userBotId: data.userBotId ? new ObjectId(data.userBotId) : undefined,
        senderType: data.senderType,
        // Only store display name and profile picture for bots (users get it from lookup)
        senderDisplayName: isBot ? data.senderDisplayName : undefined,
        senderProfilePictureUrl: isBot ? data.senderProfilePictureUrl : undefined,
        content: data.content,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as MessageDocument);

    return {
        _id: result.insertedId.toString(),
        id: messageId,
        notebookId: data.notebookId,
        threadId: data.threadId,
        userId: data.userId,
        userBotId: data.userBotId,
        senderType: data.senderType,
        senderDisplayName: data.senderDisplayName,
        senderProfilePictureUrl: data.senderProfilePictureUrl,
        content: data.content,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export async function markMessageHasThread(messageId: string): Promise<void> {
    try {
        await getCollection().updateOne(
            { id: messageId },
            { $set: { hasThread: true, updatedAt: new Date() } },
        );
    } catch {
        // Ignore errors
    }
}
