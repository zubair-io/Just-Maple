import { randomUUID } from 'crypto';
import type { UpdateFilter } from 'mongodb';
import {
    autonomyChoices,
    BOT_ACTION_KIND_IDS,
    BOT_ACTION_KINDS,
    BOT_ACTION_UNDO_WINDOW_MS,
    DEFAULT_BOT_AUTONOMY,
    isAlwaysAsk,
    isNotebookShared,
    type BotAction,
    type BotActionKind,
    type BotActionStatus,
    type BotActionUpdate,
    type BotAutonomy,
    type BotAutonomySettings,
    type BotUIBlock,
    type BotUIResponse,
    type KnownHomeEntity,
} from '@maple/shared';
import {
    attachActionsToMessage,
    findAction,
    findAutonomy,
    insertAction,
    saveAutonomy,
    updateActionDoc,
    type BotActionDocument,
} from '../repositories/bot-action.repo';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import { findUserBotById } from '../repositories/user-bot.repo';
import { broadcastChatEvent } from './realtime.service';

/**
 * The bot action log, and who decides ask versus auto.
 *
 * 1. A feature that lets a bot act calls `decideAutonomy` first. The answer comes from the
 *    owner's setting for that bot and kind, lowered by the hard floors: some actions are
 *    always Ask (`isAlwaysAsk`), and outside the owner's own private notebook auto
 *    becomes Ask. Bots never see or change the settings.
 * 2. It records the action with `recordAction` (status `proposed`, `auto` or `denied`)
 *    and moves it along with `updateAction` (queued → done / failed / undone / expired).
 *    Each change is broadcast to the chat it was posted in, without its parameters.
 * 3. Actions done on the setting get a "Done: … · Undo" card on the bot's reply
 *    (`withActionReceipts`, then `attachActions` once the reply is posted).
 *
 * Reading the log, undo and expiry live in bot-activity.service.
 */

export class ActionError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

// MARK: - Autonomy

export interface AutonomyDecision {
    /** What happens now. */
    autonomy: BotAutonomy;
    /** What the owner saved (or the default). */
    setting: BotAutonomy;
    /** Why `autonomy` differs from `setting`, if it does. */
    lowered?: 'always_ask' | 'shared_notebook';
}

/** The owner's settings for one bot, with the default filled in for every kind. */
export async function getAutonomySettings(
    ownerId: string,
    botId: string,
): Promise<Record<BotActionKind, BotAutonomy>> {
    const saved = await findAutonomy(ownerId, botId);
    return Object.fromEntries(
        BOT_ACTION_KIND_IDS.map((kind) => [kind, effectiveSetting(kind, saved)]),
    ) as Record<BotActionKind, BotAutonomy>;
}

/** Saves one setting. `auto` is refused for kinds that are always Ask. */
export async function setAutonomy(
    ownerId: string,
    botId: string,
    kind: BotActionKind,
    autonomy: BotAutonomy,
): Promise<Record<BotActionKind, BotAutonomy>> {
    if (!autonomyChoices(kind).includes(autonomy))
        throw new ActionError(400, `${BOT_ACTION_KINDS[kind].label} always asks first.`);
    await saveAutonomy(ownerId, botId, kind, autonomy);
    return getAutonomySettings(ownerId, botId);
}

function effectiveSetting(kind: BotActionKind, saved: BotAutonomySettings): BotAutonomy {
    const value = saved[kind] ?? DEFAULT_BOT_AUTONOMY;
    // A value saved before a floor existed never gets past it.
    return autonomyChoices(kind).includes(value) ? value : DEFAULT_BOT_AUTONOMY;
}

/**
 * Ask, auto or never for this action. Never is never; auto needs a kind (and parameters)
 * that may be automatic and the owner's own private notebook.
 */
export async function decideAutonomy(input: {
    ownerId: string;
    botId: string;
    kind: BotActionKind;
    notebookId: string;
    params?: unknown;
    /** What the server (never the bot) knows about the target, e.g. a Home Assistant entity. */
    known?: KnownHomeEntity;
}): Promise<AutonomyDecision> {
    const setting = effectiveSetting(input.kind, await findAutonomy(input.ownerId, input.botId));
    if (setting !== 'auto') return { autonomy: setting, setting };
    if (isAlwaysAsk(input.kind, input.params, input.known))
        return { autonomy: 'ask', setting, lowered: 'always_ask' };
    if (!(await isOwnersPrivateNotebook(input.notebookId, input.ownerId)))
        return { autonomy: 'ask', setting, lowered: 'shared_notebook' };
    return { autonomy: 'auto', setting };
}

/** Only the owner is in it, and nobody else can read it. */
export async function isOwnersPrivateNotebook(
    notebookId: string,
    ownerId: string,
): Promise<boolean> {
    const notebook = await findNotebookByIdUnsafe(notebookId).catch(() => null);
    if (!notebook || isNotebookShared(notebook)) return false;
    const members = notebook.sharing.sharedWith;
    return members.length > 0 && members.every((entry) => entry.userId === ownerId);
}

// MARK: - Writing the log

export interface RecordActionInput {
    /** A fixed id (e.g. the calendar proposal's), so recording twice is harmless. */
    id?: string;
    kind: BotActionKind;
    ownerId: string;
    botId: string;
    botName?: string;
    notebookId: string;
    pageId?: string;
    messageId?: string;
    summary: string;
    params: Record<string, unknown>;
    status?: BotActionStatus;
    decision?: BotAutonomy;
    approvedBy?: string;
    approvedAt?: Date;
    expiresAt?: Date;
    /** When it happened, if earlier than now (a proposal from before the log). */
    createdAt?: Date;
}

/** Adds an action to the log. With a fixed id, a second call returns the first row. */
export async function recordAction(input: RecordActionInput): Promise<BotActionDocument> {
    const now = new Date();
    const { id, botName, createdAt, ...rest } = input;
    const doc = await insertAction({
        ...rest,
        _id: id ?? randomUUID(),
        botName: botName ?? (await botDisplayName(input.botId)),
        summary: input.summary.slice(0, 500),
        status: input.status ?? 'proposed',
        createdAt: createdAt && createdAt < now ? createdAt : now,
        updatedAt: now,
    });
    await broadcastAction(doc);
    return doc;
}

export interface ActionChanges {
    status?: BotActionStatus;
    summary?: string;
    decision?: BotAutonomy;
    approvedBy?: string;
    approvedAt?: Date;
    result?: Record<string, unknown>;
    /** null clears it. */
    error?: string | null;
    completedAt?: Date;
    expiresAt?: Date;
    pageId?: string;
    messageId?: string;
}

/**
 * Moves an action along. With `from`, only while its status is one of those. Returns
 * the row after the change, or null when it isn't there (or not in `from`). Changes are
 * broadcast to the chat it was posted in.
 */
export async function updateAction(
    id: string,
    changes: ActionChanges,
    options: { from?: BotActionStatus[] } = {},
): Promise<BotActionDocument | null> {
    const { error, ...set } = changes;
    const defined = Object.fromEntries(
        Object.entries(set).filter(([, value]) => value !== undefined),
    );
    const update: UpdateFilter<BotActionDocument> = {
        $set: {
            ...defined,
            ...(typeof error === 'string' ? { error: error.slice(0, 500) } : {}),
            updatedAt: new Date(),
        },
        ...(error === null ? { $unset: { error: '' } } : {}),
    };
    const doc = await updateActionDoc(
        id,
        update,
        options.from ? { status: { $in: options.from } } : {},
    );
    if (doc) await broadcastAction(doc);
    return doc;
}

async function botDisplayName(botId: string): Promise<string | undefined> {
    const bot = await findUserBotById(botId).catch(() => null);
    return bot ? bot.displayName || bot.handle : undefined;
}

// MARK: - Views

/** Done, undoable, inside the window, not already undoing. */
export function undoableUntil(doc: BotActionDocument): Date | null {
    if (!BOT_ACTION_KINDS[doc.kind]?.undoable || doc.status !== 'done' || !doc.completedAt)
        return null;
    return new Date(doc.completedAt.getTime() + BOT_ACTION_UNDO_WINDOW_MS);
}

export function canUndo(doc: BotActionDocument, now = Date.now()): boolean {
    const until = undoableUntil(doc);
    // Under way, or the Mac already found nothing to remove.
    const settled = ['queued', 'delivered', 'not_found'].includes(doc.undo?.state ?? '');
    return !!until && until.getTime() > now && !settled;
}

/** Queued (not done yet), of a kind that can be cancelled, and not cancelled already. */
export function canCancel(doc: BotActionDocument): boolean {
    return (
        !!BOT_ACTION_KINDS[doc.kind]?.cancellable &&
        (doc.status === 'auto' || doc.status === 'queued') &&
        !doc.cancelRequestedAt
    );
}

/** What everyone in the chat may see: no parameters, results or errors. */
export function toActionUpdate(doc: BotActionDocument): BotActionUpdate {
    const until = undoableUntil(doc);
    return {
        id: doc._id,
        kind: doc.kind,
        ownerId: doc.ownerId,
        botId: doc.botId,
        ...(doc.botName ? { botName: doc.botName } : {}),
        notebookId: doc.notebookId,
        ...(doc.pageId ? { pageId: doc.pageId } : {}),
        ...(doc.messageId ? { messageId: doc.messageId } : {}),
        summary: doc.summary,
        status: doc.status,
        ...(doc.decision ? { decision: doc.decision } : {}),
        ...(doc.approvedAt ? { approvedAt: doc.approvedAt.toISOString() } : {}),
        ...(until ? { undoableUntil: until.toISOString() } : {}),
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        ...(doc.completedAt ? { completedAt: doc.completedAt.toISOString() } : {}),
        ...(doc.expiresAt ? { expiresAt: doc.expiresAt.toISOString() } : {}),
        ...(doc.cancelRequestedAt
            ? { cancelRequestedAt: doc.cancelRequestedAt.toISOString() }
            : {}),
    };
}

/** The row for this viewer: the owner gets everything, anyone else the summary. */
export function toActionView(doc: BotActionDocument, viewerId: string): BotAction {
    const isOwner = doc.ownerId === viewerId;
    const base = { ...toActionUpdate(doc), isOwner, canUndo: isOwner && canUndo(doc) };
    if (!isOwner) return base;
    return {
        ...base,
        canCancel: canCancel(doc),
        ...(doc.approvedBy ? { approvedBy: doc.approvedBy } : {}),
        params: doc.params,
        ...(doc.result ? { result: doc.result } : {}),
        ...(doc.error ? { error: doc.error } : {}),
        ...(doc.undo
            ? {
                  undo: {
                      state: doc.undo.state,
                      requestedAt: doc.undo.requestedAt.toISOString(),
                      ...(doc.undo.completedAt
                          ? { completedAt: doc.undo.completedAt.toISOString() }
                          : {}),
                      ...(doc.undo.error ? { error: doc.undo.error } : {}),
                      ...(doc.undo.deviceName ? { deviceName: doc.undo.deviceName } : {}),
                      ...(doc.undo.fallback ? { fallback: true } : {}),
                  },
              }
            : {}),
    };
}

/** Tells the chat it was posted in. Rows not posted anywhere stay with their owner. */
export async function broadcastAction(doc: BotActionDocument | null): Promise<void> {
    if (!doc?.pageId || !doc.messageId) return;
    await broadcastChatEvent(doc.notebookId, {
        action: 'bot_action_updated',
        pageId: doc.pageId,
        notebookId: doc.notebookId,
        userId: doc.ownerId,
        data: toActionUpdate(doc),
        timestamp: new Date().toISOString(),
    }).catch((error) => console.error('[BotAction] Broadcast failed:', error));
}

// MARK: - "Done · Undo" cards

/** Receipt cards for the actions a bot did on its own in this run, after its own blocks. */
export async function withActionReceipts(
    ui: BotUIResponse | undefined,
    actionIds: string[],
): Promise<BotUIResponse | undefined> {
    const cards: BotUIBlock[] = [];
    for (const id of [...new Set(actionIds)]) {
        const doc = await findAction(id);
        if (doc) cards.push({ type: 'action_receipt', actionId: doc._id, summary: doc.summary });
    }
    if (!cards.length) return ui;
    const blocks = [...(ui?.blocks ?? []), ...cards].slice(-30);
    return { version: 1, format: 'openui', blocks };
}

/** Once the reply is posted: the chat its cards are in, so changes reach it. */
export async function attachActions(
    actionIds: string[],
    pageId: string,
    messageId: string,
): Promise<void> {
    const attached = await attachActionsToMessage([...new Set(actionIds)], pageId, messageId);
    for (const doc of attached) await broadcastAction(doc);
}
