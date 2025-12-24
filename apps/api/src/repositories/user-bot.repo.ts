import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { UserBot, CreateUserBotInput, UpdateUserBotInput, BotConfig } from '@maple/shared';

interface UserBotDocument {
    _id: ObjectId;
    userId: ObjectId;
    templateId: ObjectId;
    handle: string;
    displayName?: string;
    config?: BotConfig;
    isEnabled: boolean;
    tagId?: ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<UserBotDocument> {
    return getDb().collection<UserBotDocument>('user_bots');
}

/**
 * Convert document to UserBot - INTERNAL USE ONLY (includes config)
 * Use toUserBotSafe for API responses
 */
function toUserBot(doc: UserBotDocument): UserBot {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        templateId: doc.templateId.toString(),
        handle: doc.handle,
        displayName: doc.displayName,
        config: doc.config,
        isEnabled: doc.isEnabled,
        tagId: doc.tagId?.toString(),
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Convert document to UserBot with redacted sensitive data - SAFE FOR API RESPONSES
 */
function toUserBotSafe(doc: UserBotDocument): UserBot {
    const bot = toUserBot(doc);

    // Redact sensitive config fields
    if (bot.config) {
        bot.config = {
            ...bot.config,
            apiKey: bot.config.apiKey ? '***REDACTED***' : undefined,
        };
    }

    return bot;
}

export async function findUserBotsByUserId(userId: string): Promise<UserBot[]> {
    try {
        const docs = await getCollection()
            .find({ userId: new ObjectId(userId) })
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toUserBotSafe);
    } catch {
        return [];
    }
}

export async function findUserBotById(id: string): Promise<UserBot | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toUserBotSafe(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find user bot by ID with full config - INTERNAL USE ONLY (for bot execution)
 * Do not expose this in API responses
 */
export async function findUserBotByIdInternal(id: string): Promise<UserBot | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toUserBot(doc) : null;
    } catch {
        return null;
    }
}

export async function findUserBotByHandle(userId: string, handle: string): Promise<UserBot | null> {
    try {
        const doc = await getCollection().findOne({
            userId: new ObjectId(userId),
            handle: handle.toLowerCase(),
        });
        return doc ? toUserBotSafe(doc) : null;
    } catch {
        return null;
    }
}

export async function findEnabledBotsForTag(userId: string, tagId: string): Promise<UserBot[]> {
    try {
        const docs = await getCollection()
            .find({
                userId: new ObjectId(userId),
                isEnabled: true,
                $or: [
                    { tagId: { $exists: false } }, // Global bots (no tag restriction)
                    { tagId: null },
                    { tagId: new ObjectId(tagId) }, // Tag-specific bots
                ],
            })
            .toArray();
        return docs.map(toUserBotSafe);
    } catch {
        return [];
    }
}

async function findUserBotDocByHandleForTag(
    handle: string,
    tagId: string,
): Promise<UserBotDocument | null> {
    // Find any user's bot with this handle that is enabled and accessible in this tag
    // First, we need to find the tag to get the members
    const tagDoc = await getDb()
        .collection('tags')
        .findOne({ _id: new ObjectId(tagId) });
    if (!tagDoc) return null;

    // Get all user IDs that have access to this tag
    const memberIds =
        tagDoc.sharing?.sharedWith?.map((m: { userId: string }) => new ObjectId(m.userId)) || [];

    // Find any enabled bot with this handle from any of these users
    const doc = await getCollection().findOne({
        userId: { $in: memberIds },
        handle: handle.toLowerCase(),
        isEnabled: true,
        $or: [{ tagId: { $exists: false } }, { tagId: null }, { tagId: new ObjectId(tagId) }],
    });

    return doc;
}

export async function findUserBotByHandleForTag(
    handle: string,
    tagId: string,
): Promise<UserBot | null> {
    try {
        const doc = await findUserBotDocByHandleForTag(handle, tagId);
        return doc ? toUserBotSafe(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find user bot by handle for tag with full config - INTERNAL USE ONLY (for bot execution)
 * Do not expose this in API responses
 */
export async function findUserBotByHandleForTagInternal(
    handle: string,
    tagId: string,
): Promise<UserBot | null> {
    try {
        const doc = await findUserBotDocByHandleForTag(handle, tagId);
        return doc ? toUserBot(doc) : null;
    } catch {
        return null;
    }
}

export async function createUserBot(
    userId: string,
    data: CreateUserBotInput,
    templateHandle: string,
): Promise<UserBot> {
    const now = new Date();
    const doc: Omit<UserBotDocument, '_id'> = {
        userId: new ObjectId(userId),
        templateId: new ObjectId(data.templateId),
        handle: (data.handle || templateHandle).toLowerCase(),
        displayName: data.displayName,
        config: data.config,
        isEnabled: true,
        tagId: data.tagId ? new ObjectId(data.tagId) : undefined,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as UserBotDocument);
    return toUserBotSafe({ ...doc, _id: result.insertedId } as UserBotDocument);
}

export async function updateUserBot(
    id: string,
    userId: string,
    data: UpdateUserBotInput,
): Promise<UserBot | null> {
    const now = new Date();

    const updateDoc: Record<string, unknown> = { updatedAt: now };

    if (data.displayName !== undefined) updateDoc.displayName = data.displayName;
    if (data.config !== undefined) updateDoc.config = data.config;
    if (data.isEnabled !== undefined) updateDoc.isEnabled = data.isEnabled;
    if (data.tagId !== undefined) {
        updateDoc.tagId = data.tagId ? new ObjectId(data.tagId) : null;
    }

    try {
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updateDoc },
            { returnDocument: 'after' },
        );

        return result ? toUserBotSafe(result) : null;
    } catch {
        return null;
    }
}

export async function deleteUserBot(id: string, userId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

export async function searchUserBots(
    userId: string,
    tagId: string,
    query: string,
    limit: number = 10,
): Promise<UserBot[]> {
    try {
        const searchRegex = new RegExp(query, 'i');

        // Get tag to find all member user IDs
        const tagDoc = await getDb()
            .collection('tags')
            .findOne({ _id: new ObjectId(tagId) });
        if (!tagDoc) return [];

        const memberIds =
            tagDoc.sharing?.sharedWith?.map((m: { userId: string }) => new ObjectId(m.userId)) ||
            [];

        const docs = await getCollection()
            .find({
                userId: { $in: memberIds },
                isEnabled: true,
                $or: [
                    { tagId: { $exists: false } },
                    { tagId: null },
                    { tagId: new ObjectId(tagId) },
                ],
                $and: [
                    {
                        $or: [{ handle: searchRegex }, { displayName: searchRegex }],
                    },
                ],
            })
            .limit(limit)
            .toArray();

        return docs.map(toUserBotSafe);
    } catch {
        return [];
    }
}
