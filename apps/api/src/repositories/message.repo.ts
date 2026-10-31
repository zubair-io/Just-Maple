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
    MessageRevision,
    ProactiveMessageMeta,
} from '@maple/shared';
import { findUsersByIds } from './user.repo';
import { findPageById } from './page.repo';
import { repairRawBotUI } from '../services/bot-ui.service';

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
    botResponseSource?: string;
    botModel?: string;
    mentions?: Mention[];
    hasThread?: boolean;
    createdAt: Date;
    updatedAt: Date;
    editedAt?: Date;
    deletedAt?: Date;
    proactiveMeta?: ProactiveMessageMeta;
    revisedAt?: Date;
    revisions?: Array<Omit<MessageRevision, 'at'> & { at: Date }>;
}

function getCollection(): Collection<MessageDocument> {
    return getDb().collection<MessageDocument>('messages');
}

/** A bot's message content and card, with old raw card text read as a card. */
function readBotContent(
    doc: MessageDocument,
): Pick<Message, 'content' | 'botUI' | 'botResponseSource'> {
    if (doc.senderType === 'bot' && !doc.botUI) {
        const repaired = repairRawBotUI(doc.content);
        if (repaired)
            return {
                content: repaired.content,
                botUI: repaired.ui,
                botResponseSource: doc.botResponseSource ?? repaired.source,
            };
    }
    return { content: doc.content, botUI: doc.botUI, botResponseSource: doc.botResponseSource };
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
        ...readBotContent(doc),
        botModel: doc.botModel,
        mentions: doc.mentions,
        hasThread: doc.hasThread,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        editedAt: doc.editedAt?.toISOString(),
        deletedAt: doc.deletedAt?.toISOString(),
        ...(doc.proactiveMeta ? { proactiveMeta: doc.proactiveMeta } : {}),
        ...(doc.revisedAt ? { revisedAt: doc.revisedAt.toISOString() } : {}),
        ...(doc.revisions?.length
            ? {
                  revisions: doc.revisions.map((revision) => ({
                      ...revision,
                      at: revision.at.toISOString(),
                  })),
              }
            : {}),
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
        const beforeMessage = await getCollection().findOne({ id: options.before, pageId });
        if (!beforeMessage) return [];
        query._id = { $lt: beforeMessage._id };
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
        const beforeMessage = await getCollection().findOne({
            id: options.before,
            notebookId: new ObjectId(notebookId),
        });
        if (!beforeMessage) return [];
        query._id = { $lt: beforeMessage._id };
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
        botResponseSource: doc.botResponseSource,
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
                // An explicit edit replaces the generated presentation too.
                $unset: { botResponseSource: '', botUI: '' },
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
    botResponseSource?: string;
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
        botResponseSource:
            data.senderType === undefined || data.senderType === 'bot'
                ? data.botResponseSource
                : undefined,
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
        botResponseSource:
            data.senderType === undefined || data.senderType === 'bot'
                ? data.botResponseSource
                : undefined,
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
    botResponseSource?: string;
    botModel?: string;
    proactiveMeta?: ProactiveMessageMeta;
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
        botResponseSource: data.botResponseSource,
        botModel: data.botModel,
        ...(data.proactiveMeta ? { proactiveMeta: data.proactiveMeta } : {}),
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
        botResponseSource: data.botResponseSource,
        botModel: data.botModel,
        ...(data.proactiveMeta ? { proactiveMeta: data.proactiveMeta } : {}),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/** Earlier versions kept on a revised message: the first one, then the latest ones. */
const MAX_REVISIONS = 10;

/**
 * A proactive bot rewrites its own top-level post in place (it was still unread and
 * nothing came after it). The version it replaces is kept in `revisions`, the first
 * version always. Everything that allows a revision is checked again here, right before
 * the write, since the revision took a model run to write: null (the caller then posts a
 * new message) when the post is gone, isn't this bot's, has thread replies, is no longer
 * the chat's latest top-level message, has been read (`stillUnread`, given when it was
 * posted), or changed meanwhile (another revision got in first: the write only lands on
 * the version that was read).
 */
export async function reviseBotMessage(
    id: string,
    userBotId: string,
    update: {
        content: PageContent;
        botUI?: BotUIResponse;
        botResponseSource?: string;
        botModel?: string;
        proactiveMeta?: ProactiveMessageMeta;
    },
    guard: { stillUnread?: (postedAt: Date) => Promise<boolean> } = {},
): Promise<Message | null> {
    const current = await getCollection().findOne({
        id,
        userBotId: new ObjectId(userBotId),
        deletedAt: { $exists: false },
    });
    // Only top-level posts without replies.
    if (!current || current.threadId || current.hasThread) return null;
    // Still the latest top-level message in the chat.
    const latestQuery: Record<string, unknown> = {
        pageId: current.pageId,
        threadId: { $in: [null] },
        deletedAt: { $exists: false },
    };
    const [latest] = await getCollection().find(latestQuery).sort({ _id: -1 }).limit(1).toArray();
    if (!latest || !latest._id.equals(current._id)) return null;
    if (guard.stillUnread && !(await guard.stillUnread(current.createdAt))) return null;
    const previous = {
        content: current.content,
        ...(current.botUI ? { botUI: current.botUI } : {}),
        ...(current.botResponseSource !== undefined
            ? { botResponseSource: current.botResponseSource }
            : {}),
        at: current.revisedAt ?? current.createdAt,
    };
    const all = [...(current.revisions ?? []), previous];
    const revisions =
        all.length > MAX_REVISIONS ? [all[0]!, ...all.slice(-(MAX_REVISIONS - 1))] : all;
    const now = new Date();
    const result = await getCollection().findOneAndUpdate(
        // Unchanged since it was read, and still without replies.
        { _id: current._id, updatedAt: current.updatedAt, hasThread: { $ne: true } },
        {
            $set: {
                content: update.content,
                ...(update.botUI ? { botUI: update.botUI } : {}),
                ...(update.botResponseSource !== undefined
                    ? { botResponseSource: update.botResponseSource }
                    : {}),
                ...(update.botModel ? { botModel: update.botModel } : {}),
                ...(update.proactiveMeta ? { proactiveMeta: update.proactiveMeta } : {}),
                revisions,
                revisedAt: now,
                updatedAt: now,
            },
            // A revision without a card drops the old card.
            ...(!update.botUI || update.botResponseSource === undefined
                ? {
                      $unset: {
                          ...(update.botUI ? {} : { botUI: '' as const }),
                          ...(update.botResponseSource !== undefined
                              ? {}
                              : { botResponseSource: '' as const }),
                      },
                  }
                : {}),
        },
        { returnDocument: 'after' },
    );
    return result ? toMessageResponse(result) : null;
}
