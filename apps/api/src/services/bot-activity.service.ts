import {
    BOT_ACTION_KIND_IDS,
    OPEN_BOT_ACTION_STATUSES,
    type BotAction,
    type BotActionKind,
    type BotActionStatus,
    type DeviceAction,
    type DeviceActionResult,
} from '@maple/shared';
import {
    findAction,
    findExpiredOpen,
    listActions,
    type BotActionDocument,
} from '../repositories/bot-action.repo';
import { findUserBotById } from '../repositories/user-bot.repo';
import { isMemberOf } from './device-data-access.service';
import { ActionError, canCancel, canUndo, toActionView, updateAction } from './bot-action.service';
import { ACTION_KIND_HANDLERS } from './bot-action-kinds';

/**
 * Reading the action log, and undo.
 *
 * - A bot's Activity (in its settings): only its owner, every action it took for them.
 * - A notebook's Activity page: any member. Their own actions in full; other people's
 *   only when they were posted in that notebook's chats, and only the summary.
 * - Undo: only the owner, while the action is done and less than 24 hours old.
 *
 * Reads catch up on time first (`settle`): expired proposals, stranded work.
 */

export interface ActivityFilters {
    kind?: BotActionKind;
    status?: BotActionStatus;
    limit?: number;
}

const MAX_LIMIT = 200;

export async function listBotActivity(
    viewerId: string,
    botId: string,
    filters: ActivityFilters = {},
): Promise<BotAction[]> {
    const bot = await findUserBotById(botId);
    if (!bot || bot.userId !== viewerId) throw new ActionError(404, 'Bot not found');
    await settle(viewerId);
    const rows = await listActions({ ownerId: viewerId, botId }, limitOf(filters), {
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.status ? { status: filters.status } : {}),
    });
    return present(rows, viewerId);
}

export async function listNotebookActivity(
    viewerId: string,
    notebookId: string,
    filters: ActivityFilters = {},
): Promise<BotAction[]> {
    if (!(await isMemberOf(notebookId, viewerId))) throw new ActionError(404, 'Notebook not found');
    await settle(viewerId);
    // Visibility and filters run in the query, so the limit counts only rows shown.
    const rows = await listActions({ notebookId }, limitOf(filters), {
        visibleTo: viewerId,
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.status ? { status: filters.status } : {}),
    });
    return present(
        rows.filter((row) => isVisibleTo(row, viewerId, true)),
        viewerId,
    );
}

/**
 * One row, for a "Done · Undo" card or the Activity list. Null when the viewer can't see
 * it. Only this row catches up, and only while something about it can still change: a
 * chat with 20 cards doesn't settle everything 20 times.
 */
export async function getActivityItem(id: string, viewerId: string): Promise<BotAction | null> {
    let row = await findAction(id);
    if (!row || !(await canSee(row, viewerId))) return null;
    if (row.ownerId === viewerId && isUnsettled(row)) {
        await settleRow(row);
        row = (await findAction(id)) ?? row;
    }
    return toActionView(row, viewerId);
}

/** The owner's Cancel of a queued action. Repeating it returns the current state. */
export async function cancelActivityItem(id: string, viewerId: string): Promise<BotAction> {
    const row = await findAction(id);
    if (!row || !(await canSee(row, viewerId))) throw new ActionError(404, 'Action not found');
    if (row.ownerId !== viewerId)
        throw new ActionError(403, 'Only the person this was done for can cancel it.');
    if (row.cancelRequestedAt) return toActionView(row, viewerId);
    const handler = ACTION_KIND_HANDLERS[row.kind]?.cancel;
    if (!handler || !canCancel(row))
        throw new ActionError(409, 'Only actions that are still waiting can be cancelled.');
    return toActionView(await handler(row, viewerId), viewerId);
}

/** The owner's Undo. Repeating it while the undo is under way returns the current state. */
export async function undoActivityItem(id: string, viewerId: string): Promise<BotAction> {
    const row = await findAction(id);
    if (!row || !(await canSee(row, viewerId))) throw new ActionError(404, 'Action not found');
    if (row.ownerId !== viewerId)
        throw new ActionError(403, 'Only the person this was done for can undo it.');
    const handler = ACTION_KIND_HANDLERS[row.kind]?.undo;
    if (row.undo && ['queued', 'delivered'].includes(row.undo.state))
        return toActionView(row, viewerId);
    if (row.status === 'undone') return toActionView(row, viewerId);
    if (!handler || !canUndo(row))
        throw new ActionError(
            409,
            row.status === 'done'
                ? 'This can no longer be undone here (undo is offered for 24 hours).'
                : 'Only finished actions can be undone.',
        );
    return toActionView(await handler(row, viewerId), viewerId);
}

// MARK: - Device queue

/** Work for the owner's device from every kind (undo of an added event, …). */
export async function takeLogDeviceActions(
    ownerId: string,
    deviceId: string,
): Promise<DeviceAction[]> {
    const actions: DeviceAction[] = [];
    for (const handlers of Object.values(ACTION_KIND_HANDLERS))
        if (handlers?.deviceActions)
            actions.push(...(await handlers.deviceActions(ownerId, deviceId)));
    return actions;
}

/** A device's report for one of those. Null when the id isn't one of them. */
export async function reportLogDeviceResult(
    ownerId: string,
    deviceId: string,
    id: string,
    result: DeviceActionResult,
): Promise<BotAction | null> {
    for (const handlers of Object.values(ACTION_KIND_HANDLERS)) {
        const row = await handlers?.reportDeviceResult?.(ownerId, deviceId, id, result);
        if (row) return toActionView(row, ownerId);
    }
    return null;
}

// MARK: - Private

function isVisibleTo(row: BotActionDocument, viewerId: string, isMember: boolean): boolean {
    if (row.ownerId === viewerId) return true;
    // Someone else's: only what was posted in a chat of a notebook the viewer is in.
    return isMember && !!row.messageId && !!row.pageId;
}

async function canSee(row: BotActionDocument, viewerId: string): Promise<boolean> {
    if (row.ownerId === viewerId) return true;
    return isVisibleTo(row, viewerId, await isMemberOf(row.notebookId, viewerId));
}

function limitOf(filters: ActivityFilters): number {
    return Math.min(Math.max(filters.limit ?? 100, 1), MAX_LIMIT);
}

function present(rows: BotActionDocument[], viewerId: string): BotAction[] {
    return rows.map((row) => toActionView(row, viewerId));
}

function isUnsettled(row: BotActionDocument): boolean {
    return (
        OPEN_BOT_ACTION_STATUSES.includes(row.status) ||
        row.undo?.state === 'queued' ||
        row.undo?.state === 'delivered'
    );
}

async function settleRow(row: BotActionDocument): Promise<void> {
    const handler = ACTION_KIND_HANDLERS[row.kind]?.settleOne;
    if (handler) {
        await handler(row).catch((error) => console.error('[BotActivity]', error));
        return;
    }
    if (ACTION_KIND_HANDLERS[row.kind]?.settle) return; // Its rows expire on list reads
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now())
        await updateAction(row._id, { status: 'expired' }, { from: OPEN_BOT_ACTION_STATUSES });
}

/**
 * Catches the owner's rows up on time: kinds with their own lifecycle settle it; the
 * rest expire at `expiresAt`.
 */
async function settle(ownerId: string): Promise<void> {
    const plain: BotActionKind[] = [];
    for (const kind of BOT_ACTION_KIND_IDS) {
        const handler = ACTION_KIND_HANDLERS[kind]?.settle;
        if (handler) await handler(ownerId).catch((error) => console.error('[BotActivity]', error));
        else plain.push(kind);
    }
    for (const row of await findExpiredOpen(ownerId, plain))
        await updateAction(row._id, { status: 'expired' }, { from: OPEN_BOT_ACTION_STATUSES });
}
