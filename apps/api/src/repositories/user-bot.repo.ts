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
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<UserBotDocument> {
    return getDb().collection<UserBotDocument>('user_bots');
}

/**
 * Convert document to UserBot - INTERNAL USE ONLY (includes config)
 * WARNING: Contains sensitive data (API keys). Use toUserBotSafe for API responses.
 */
function toUserBotInternal(doc: UserBotDocument): UserBot {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        templateId: doc.templateId.toString(),
        handle: doc.handle,
        displayName: doc.displayName,
        config: doc.config,
        isEnabled: doc.isEnabled,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Convert document to UserBot with redacted sensitive data - SAFE FOR API RESPONSES
 */
function toUserBotSafe(doc: UserBotDocument): UserBot {
    const bot = toUserBotInternal(doc);

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
            .toArray();
        // Note: Sort removed to avoid CosmosDB indexing issues (no index on createdAt)
        return docs.map(toUserBotSafe);
    } catch (error) {
        console.error('Error finding user bots by userId:', error);
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
        return doc ? toUserBotInternal(doc) : null;
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

async function findUserBotDocByHandleForNotebook(
    handle: string,
    notebookId: string,
): Promise<UserBotDocument | null> {
    // Find a bot with this handle that is shared with this tag
    const tagDoc = await getDb()
        .collection('notebooks')
        .findOne({ _id: new ObjectId(notebookId) });
    if (!tagDoc) return null;

    // Get bot IDs from tag's sharing config
    const sharedBotIds =
        tagDoc.sharing?.sharedBots?.map((b: { userBotId: string }) => new ObjectId(b.userBotId)) ||
        [];

    if (sharedBotIds.length === 0) return null;

    // Find the bot with matching handle
    const doc = await getCollection().findOne({
        _id: { $in: sharedBotIds },
        handle: handle.toLowerCase(),
        isEnabled: true,
    });

    return doc;
}

export async function findUserBotByHandleForNotebook(
    handle: string,
    notebookId: string,
): Promise<UserBot | null> {
    try {
        const doc = await findUserBotDocByHandleForNotebook(handle, notebookId);
        return doc ? toUserBotSafe(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find user bot by handle for tag with full config - INTERNAL USE ONLY (for bot execution)
 * Do not expose this in API responses
 */
export async function findUserBotByHandleForNotebookInternal(
    handle: string,
    notebookId: string,
): Promise<UserBot | null> {
    try {
        const doc = await findUserBotDocByHandleForNotebook(handle, notebookId);
        return doc ? toUserBotInternal(doc) : null;
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

    // Merge config instead of replacing it to preserve existing fields
    if (data.config !== undefined) {
        // Get existing bot to merge config
        const existing = await getCollection().findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });

        if (existing) {
            updateDoc.config = {
                ...(existing.config || {}),
                ...data.config,
            };
        } else {
            updateDoc.config = data.config;
        }
    }

    if (data.isEnabled !== undefined) updateDoc.isEnabled = data.isEnabled;

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

export async function findUserBotsForNotebook(notebookId: string): Promise<UserBot[]> {
    try {
        const tagDoc = await getDb()
            .collection('notebooks')
            .findOne({ _id: new ObjectId(notebookId) });
        if (!tagDoc) return [];

        // Get bot IDs from tag's sharing config
        const sharedBotIds =
            tagDoc.sharing?.sharedBots?.map(
                (b: { userBotId: string }) => new ObjectId(b.userBotId),
            ) || [];

        if (sharedBotIds.length === 0) return [];

        // Fetch bots
        const botDocs = await getCollection()
            .find({
                _id: { $in: sharedBotIds },
                isEnabled: true,
            })
            .sort({ handle: 1 })
            .toArray();

        // Batch load owners and templates
        const ownerIds = [...new Set(botDocs.map((b) => b.userId.toString()))];
        const templateIds = [...new Set(botDocs.map((b) => b.templateId.toString()))];

        const owners = await getDb()
            .collection('users')
            .find({ _id: { $in: ownerIds.map((id) => new ObjectId(id)) } })
            .toArray();

        const { findBotTemplatesByIds } = await import('./bot-template.repo');
        const templates = await findBotTemplatesByIds(templateIds);

        const ownerMap = new Map(owners.map((u) => [u._id.toString(), u]));
        const templateMap = new Map(templates.map((t) => [t._id, t]));

        // Enrich bots with owner and template info
        return botDocs.map((doc) => {
            const owner = ownerMap.get(doc.userId.toString());
            const template = templateMap.get(doc.templateId.toString());

            const bot = toUserBotSafe(doc);
            return {
                ...bot,
                // Add enrichment fields (these will be spread into EnrichedUserBot)
                ownerName: owner?.displayName || owner?.email || 'Unknown',
                ownerAvatar: owner?.profilePictureUrl,
                templateName: template?.name,
                templateAvatar: template?.avatar,
                templateDescription: template?.description,
            } as any; // Cast to any since we're adding extra fields
        });
    } catch {
        return [];
    }
}

export async function searchUserBots(
    userId: string,
    notebookId: string,
    query: string,
): Promise<UserBot[]> {
    try {
        const regex = new RegExp(query, 'i'); // case-insensitive

        // Get user's bots and tag's bots
        const userBots = await getCollection()
            .find({
                userId: new ObjectId(userId),
                isEnabled: true,
                $or: [{ handle: regex }, { displayName: regex }],
            })
            .toArray();

        // Get bots shared with the tag
        const tagDoc = await getDb()
            .collection('notebooks')
            .findOne({ _id: new ObjectId(notebookId) });

        if (!tagDoc) {
            return userBots.map(toUserBotSafe);
        }

        const sharedBotIds =
            tagDoc.sharing?.sharedBots?.map(
                (b: { userBotId: string }) => new ObjectId(b.userBotId),
            ) || [];

        const tagBots = await getCollection()
            .find({
                _id: { $in: sharedBotIds },
                isEnabled: true,
                $or: [{ handle: regex }, { displayName: regex }],
            })
            .toArray();

        // Combine and deduplicate
        const allBots = [...userBots, ...tagBots];
        const uniqueBots = Array.from(
            new Map(allBots.map((bot) => [bot._id.toString(), bot])).values(),
        );

        return uniqueBots.map(toUserBotSafe);
    } catch {
        return [];
    }
}
