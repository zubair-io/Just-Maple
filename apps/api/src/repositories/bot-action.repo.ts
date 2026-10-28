import type { Collection, Filter, UpdateFilter } from 'mongodb';
import { getDb } from '../db/client';
import {
    OPEN_BOT_ACTION_STATUSES,
    type BotActionKind,
    type BotActionStatus,
    type BotAutonomy,
    type BotAutonomySettings,
} from '@maple/shared';

// The bot action log (`bot_actions`): one row per action a bot proposed or performed,
// and the owner's autonomy settings per bot (`bot_autonomy`). Written only through
// bot-action.service. Queries sort in code: Cosmos DB needs a matching index to sort.

export interface BotActionUndoDocument {
    /** The id the device sees for the undo action (not the action's own id). */
    id: string;
    state: 'queued' | 'delivered' | 'done' | 'failed';
    requestedAt: Date;
    requestedBy: string;
    deviceId?: string;
    deliveredTo?: string[];
    deliveredAt?: Date;
    completedAt?: Date;
    error?: string;
}

export interface BotActionDocument {
    _id: string;
    /** Whose action: the person it acts for, and the only one who sees its details. */
    ownerId: string;
    botId: string;
    botName?: string;
    notebookId: string;
    /** The chat it was posted in, once its card is posted. */
    pageId?: string;
    messageId?: string;
    kind: BotActionKind;
    summary: string;
    params: Record<string, unknown>;
    status: BotActionStatus;
    /** How it was decided: ask (a tap), auto (the setting), never (the setting). */
    decision?: BotAutonomy;
    approvedBy?: string;
    approvedAt?: Date;
    result?: Record<string, unknown>;
    error?: string;
    undo?: BotActionUndoDocument;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    expiresAt?: Date;
}

function actions(): Collection<BotActionDocument> {
    return getDb().collection<BotActionDocument>('bot_actions');
}

/** Inserts the row; with a fixed id, a second insert returns the first row unchanged. */
export async function insertAction(doc: BotActionDocument): Promise<BotActionDocument> {
    try {
        await actions().insertOne(doc);
        return doc;
    } catch (error) {
        if ((error as { code?: number }).code === 11000) {
            const existing = await findAction(doc._id);
            if (existing) return existing;
        }
        throw error;
    }
}

export async function findAction(id: string): Promise<BotActionDocument | null> {
    return actions().findOne({ _id: id });
}

/** Updates the row, only while it is in one of `from` when given. Null when nothing matched. */
export async function updateActionDoc(
    id: string,
    update: UpdateFilter<BotActionDocument>,
    filter: Filter<BotActionDocument> = {},
): Promise<BotActionDocument | null> {
    return actions().findOneAndUpdate({ ...filter, _id: id }, update, {
        returnDocument: 'after',
    });
}

/** Points rows at the message that shows their cards. */
export async function attachActionsToMessage(
    ids: string[],
    pageId: string,
    messageId: string,
): Promise<BotActionDocument[]> {
    const attached: BotActionDocument[] = [];
    for (const id of ids) {
        const doc = await updateActionDoc(
            id,
            { $set: { pageId, messageId, updatedAt: new Date() } },
            { messageId: { $exists: false } },
        );
        if (doc) attached.push(doc);
    }
    return attached;
}

/** How far back Activity reads go. */
export const ACTIVITY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** A bot's rows for its owner, or a notebook's rows; newest first, at most `limit`. */
export async function listActions(
    scope: { ownerId: string; botId: string } | { notebookId: string },
    limit: number,
): Promise<BotActionDocument[]> {
    const since = new Date(Date.now() - ACTIVITY_WINDOW_MS);
    const docs = await actions()
        .find({ ...scope, createdAt: { $gte: since } })
        .toArray();
    return docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

/** Open rows past their date (kinds without their own expiry). */
export async function findExpiredOpen(
    ownerId: string,
    kinds: BotActionKind[],
): Promise<BotActionDocument[]> {
    const docs = await actions()
        .find({ ownerId, status: { $in: OPEN_BOT_ACTION_STATUSES } })
        .toArray();
    const now = Date.now();
    return docs.filter(
        (doc) => kinds.includes(doc.kind) && !!doc.expiresAt && doc.expiresAt.getTime() <= now,
    );
}

// MARK: - Undo queue (for kinds whose undo runs on a device)

export async function findPendingUndos(ownerId: string): Promise<BotActionDocument[]> {
    return actions()
        .find({ ownerId, 'undo.state': { $in: ['queued', 'delivered'] } })
        .toArray();
}

export async function findActionByUndoId(
    ownerId: string,
    undoId: string,
): Promise<BotActionDocument | null> {
    return actions().findOne({ ownerId, 'undo.id': undoId });
}

// MARK: - Autonomy settings

interface BotAutonomyDocument {
    _id: string;
    userId: string;
    botId: string;
    settings: BotAutonomySettings;
    updatedAt: Date;
}

function autonomy(): Collection<BotAutonomyDocument> {
    return getDb().collection<BotAutonomyDocument>('bot_autonomy');
}

export async function findAutonomy(userId: string, botId: string): Promise<BotAutonomySettings> {
    const doc = await autonomy().findOne({ _id: `${userId}:${botId}` });
    return doc?.settings ?? {};
}

export async function saveAutonomy(
    userId: string,
    botId: string,
    kind: BotActionKind,
    value: BotAutonomy,
): Promise<BotAutonomySettings> {
    const doc = await autonomy().findOneAndUpdate(
        { _id: `${userId}:${botId}` },
        {
            $set: { [`settings.${kind}`]: value, userId, botId, updatedAt: new Date() },
        },
        { upsert: true, returnDocument: 'after' },
    );
    return doc?.settings ?? { [kind]: value };
}
