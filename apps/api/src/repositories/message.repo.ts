import { ObjectId, Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type {
    Message,
    BotUIResponse,
    PageContent,
    CreateMessageInput,
    UpdateMessageInput,
    SenderType,
    Mention,
} from '@maple/shared';
import { findUsersByIds } from './user.repo';
import { findPageById } from './page.repo';

/**
 * Generate a UUID v4 for message routing
 */
function generateMessageId(): string {
    return randomUUID();
}

interface MessageDocument {
    _id: ObjectId;
    id: string; // UUID v4 for routing
    pageId: string; // Messages page ID (UUID)
    notebookId?: ObjectId; // Deprecated: kept for backward compatibility
    threadId?: ObjectId;
    userId: ObjectId;
    senderType?: SenderType;
    userBotId?: ObjectId;
    senderDisplayName?: string;
    senderProfilePictureUrl?: string;
    content: PageContent;
    botUI?: BotUIResponse;
    botModel?: string;
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
        pageId: doc.pageId,
        notebookId: doc.notebookId?.toString(),
        threadId: doc.threadId?.toString(),
        userId: doc.userId.toString(),
        senderType: doc.senderType,
        userBotId: doc.userBotId?.toString(),
        senderEmail,
        // Prefer user lookup data (for users), fall back to document fields (for bots)
        senderDisplayName: senderDisplayName || doc.senderDisplayName,
        senderProfilePictureUrl: senderProfilePictureUrl || doc.senderProfilePictureUrl,
        content: doc.content,
        botUI: doc.botUI,
        botModel: doc.botModel,
        mentions: doc.mentions,
        hasThread: doc.hasThread,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        editedAt: doc.editedAt?.toISOString(),
        deletedAt: doc.deletedAt?.toISOString(),
    };
}

export async function findMessagesByPageId(
    pageId: string,
    options?: {
        limit?: number;
        before?: string; // Cursor-based pagination: messages before this UUID id
    },
): Promise<Message[]> {
    const query: Record<string, unknown> = {
        pageId: pageId,
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

/**
 * @deprecated Use findMessagesByPageId instead. This is kept for backward compatibility.
 */
export async function findMessagesByNotebookId(
    notebookId: string,
    options?: {
        limit?: number;
        before?: string;
    },
): Promise<Message[]> {
    const query: Record<string, unknown> = {
        notebookId: new ObjectId(notebookId),
        threadId: { $in: [null] },
        deletedAt: { $exists: false },
    };

    if (options?.before) {
        const beforeMessage = await getCollection().findOne({ id: options.before });
        if (beforeMessage) {
            query._id = { $lt: beforeMessage._id };
        }
    }

    const limit = options?.limit || 500;
    const docs = await getCollection().find(query).sort({ _id: -1 }).limit(limit).toArray();
    const userIds = [
        ...new Set(
            docs.filter((doc) => doc.senderType !== 'bot').map((doc) => doc.userId.toString()),
        ),
    ];
    const usersMap = await findUsersByIds(userIds);

    return docs.reverse().map((doc) => {
        // For bot messages, use the stored sender info
        if (doc.senderType === 'bot') {
            return toMessageResponse(doc);
        }
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

        // If userId is provided, verify access via the page
        if (userId) {
            const page = await findPageById(doc.pageId, userId);
            if (!page) return null; // No access to the page
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

        // If userId is provided, verify access via the page
        if (userId) {
            const page = await findPageById(doc.pageId, userId);
            if (!page) return null; // No access to the page
        }

        return toMessageResponse(doc);
    } catch {
        return null;
    }
}

export async function createMessage(
    pageId: string,
    userId: string,
    data: CreateMessageInput,
    senderEmail?: string,
    senderDisplayName?: string,
    senderProfilePictureUrl?: string,
    threadId?: string,
    notebookId?: string, // Optional: for backward compatibility and convenience
): Promise<Message> {
    const now = new Date();
    const messageId = generateMessageId();
    const doc: any = {
        id: messageId,
        pageId: pageId,
        userId: new ObjectId(userId),
        content: data.content,
        createdAt: now,
        updatedAt: now,
    };

    // Store notebookId if provided (for convenience in queries/broadcasts)
    if (notebookId) {
        doc.notebookId = new ObjectId(notebookId);
    }

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
        pageId: pageId,
        notebookId: notebookId,
        threadId: threadId,
        userId: userId,
        senderEmail,
        senderDisplayName,
        senderProfilePictureUrl,
        content: doc.content,
        botUI: doc.botUI,
        botModel: doc.botModel,
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

/**
 * Count a page's messages (thread replies included) newer than `since`.
 * With `readerId`, the reader's own messages are left out: what you wrote is
 * never unread. Bot posts are stored under their owner's id but still count.
 */
export async function countMessagesSinceByPageId(
    pageId: string,
    since: Date,
    readerId?: string,
): Promise<number> {
    try {
        return await getCollection().countDocuments({
            pageId: pageId,
            deletedAt: { $exists: false },
            createdAt: { $gt: since },
            ...(readerId
                ? { $or: [{ userId: { $ne: new ObjectId(readerId) } }, { senderType: 'bot' }] }
                : {}),
        });
    } catch {
        return 0;
    }
}

/**
 * @deprecated Use countMessagesSinceByPageId instead
 */
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

export async function getLatestMessageTimeByPageId(pageId: string): Promise<Date | null> {
    try {
        const doc = await getCollection()
            .find({
                pageId: pageId,
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

/**
 * @deprecated Use getLatestMessageTimeByPageId instead
 */
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
    pageId: string;
    notebookId?: string; // Optional: for backward compatibility
    threadId: string;
    userId: string;
    userBotId?: string;
    senderType: SenderType;
    senderDisplayName?: string;
    senderProfilePictureUrl?: string;
    content: PageContent;
    botUI?: BotUIResponse;
    botModel?: string;
}): Promise<Message> {
    const now = new Date();
    const messageId = generateMessageId();
    const isBot = data.senderType === 'bot';
    const doc: Omit<MessageDocument, '_id'> = {
        id: messageId,
        pageId: data.pageId,
        notebookId: data.notebookId ? new ObjectId(data.notebookId) : undefined,
        threadId: new ObjectId(data.threadId),
        userId: new ObjectId(data.userId),
        userBotId: data.userBotId ? new ObjectId(data.userBotId) : undefined,
        senderType: data.senderType,
        // Only store display name and profile picture for bots (users get it from lookup)
        senderDisplayName: isBot ? data.senderDisplayName : undefined,
        senderProfilePictureUrl: isBot ? data.senderProfilePictureUrl : undefined,
        content: data.content,
        botUI: data.botUI,
        botModel: data.botModel,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as MessageDocument);

    return {
        _id: result.insertedId.toString(),
        id: messageId,
        pageId: data.pageId,
        notebookId: data.notebookId,
        threadId: data.threadId,
        userId: data.userId,
        userBotId: data.userBotId,
        senderType: data.senderType,
        senderDisplayName: data.senderDisplayName,
        senderProfilePictureUrl: data.senderProfilePictureUrl,
        content: data.content,
        botUI: data.botUI,
        botModel: data.botModel,
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

/**
 * Create a top-level bot message in a page (not in a thread). Used by proactive bots,
 * which post updates and answers directly in the conversation.
 */
export async function createTopLevelBotMessage(data: {
    pageId: string;
    notebookId?: string;
    userId: string;
    userBotId: string;
    senderDisplayName?: string;
    senderProfilePictureUrl?: string;
    content: PageContent;
    botUI?: BotUIResponse;
    botModel?: string;
}): Promise<Message> {
    const now = new Date();
    const messageId = generateMessageId();
    const doc: Omit<MessageDocument, '_id'> = {
        id: messageId,
        pageId: data.pageId,
        notebookId: data.notebookId ? new ObjectId(data.notebookId) : undefined,
        userId: new ObjectId(data.userId),
        userBotId: new ObjectId(data.userBotId),
        senderType: 'bot',
        senderDisplayName: data.senderDisplayName,
        senderProfilePictureUrl: data.senderProfilePictureUrl,
        content: data.content,
        botUI: data.botUI,
        botModel: data.botModel,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as MessageDocument);

    return {
        _id: result.insertedId.toString(),
        id: messageId,
        pageId: data.pageId,
        notebookId: data.notebookId,
        userId: data.userId,
        userBotId: data.userBotId,
        senderType: 'bot',
        senderDisplayName: data.senderDisplayName,
        senderProfilePictureUrl: data.senderProfilePictureUrl,
        content: data.content,
        botUI: data.botUI,
        botModel: data.botModel,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}
