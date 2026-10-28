import { createHash, randomUUID } from 'crypto';
import {
    formatEventTime,
    type BotActionStatus,
    type CalendarEventDraft,
    type BotAutonomy,
    type DeleteEventAction,
    type DeviceActionResult,
} from '@maple/shared';
import {
    findActionByUndoId,
    findAction,
    findPendingUndos,
    updateActionDoc,
    type BotActionDocument,
} from '../repositories/bot-action.repo';
import {
    findProposal,
    STALE_DELIVERY_MS,
    type CalendarProposalDocument,
} from '../repositories/calendar-proposal.repo';
import { listCollectors, findCollector } from '../repositories/collector.repo';
import {
    ActionError,
    broadcastAction,
    recordAction,
    updateAction,
    type ActionChanges,
} from './bot-action.service';
import { macDataRelay } from './mac-data-relay.service';

/**
 * "Add to calendar" in the action log (`calendar_add`).
 *
 * The calendar proposal stays the source of truth; its log row shares its id and
 * follows it (`syncCalendarAction`, called on every proposal change):
 *   proposed → proposed, queued/delivered → queued, added → done, failed → failed,
 *   expired → expired, removed → undone, cancelled → denied.
 * A row never moves back from done, undone, expired or denied.
 *
 * Undo (24 hours after it was added) queues a `delete_event` action for the Mac that
 * added the event (or, once that one stops collecting the calendar, the one that does),
 * next to the `create_event` ones. The Mac removes the event only if it still carries
 * this proposal's marker; one it can't find is reported as `not_found`, shown as such,
 * and the bot may offer the event again.
 *
 * Cancel (a queued add): before a Mac takes it, it's simply not done; once a Mac has
 * it, it's undone as soon as the Mac reports it added.
 */

const UNDO_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function calendarActionSummary(event: CalendarEventDraft): string {
    return `“${event.title}” · ${formatEventTime(event)}`;
}

/** Logs a new proposal: `proposed` (ask) or `auto` (the owner's setting). */
export async function recordCalendarProposal(
    proposal: CalendarProposalDocument,
    decision: BotAutonomy,
    botName?: string,
): Promise<BotActionDocument> {
    return recordAction({
        id: proposal._id,
        kind: 'calendar_add',
        ownerId: proposal.userId,
        botId: proposal.botId,
        ...(botName ? { botName } : {}),
        notebookId: proposal.notebookId,
        summary: calendarActionSummary(proposal.event),
        params: { event: proposal.event },
        status: decision === 'auto' ? 'auto' : 'proposed',
        decision,
        ...(decision === 'auto' ? { approvedBy: 'auto', approvedAt: new Date() } : {}),
        expiresAt: proposal.expiresAt,
    });
}

/**
 * The row of an event a bot may never add: one per bot and event (title and start), so
 * a bot that keeps finding the same email updates one row instead of filling the log.
 */
export function deniedCalendarActionId(
    ownerId: string,
    botId: string,
    event: Pick<CalendarEventDraft, 'title' | 'start'>,
): string {
    const hex = createHash('sha256')
        .update(`denied|${ownerId}|${botId}|${event.title.trim().toLowerCase()}|${event.start}`)
        .digest('hex');
    // Shaped like a UUID (version 5 style), like every other row id.
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `5${hex.slice(13, 16)}`,
        `8${hex.slice(17, 20)}`,
        hex.slice(20, 32),
    ].join('-');
}

/** An event the bot may never add: logged as denied, no proposal is saved. */
export async function recordDeniedCalendarAction(input: {
    ownerId: string;
    botId: string;
    botName?: string;
    notebookId: string;
    event: CalendarEventDraft;
}): Promise<BotActionDocument> {
    const before = Date.now();
    const summary = calendarActionSummary(input.event);
    const doc = await recordAction({
        id: deniedCalendarActionId(input.ownerId, input.botId, input.event),
        kind: 'calendar_add',
        ownerId: input.ownerId,
        botId: input.botId,
        ...(input.botName ? { botName: input.botName } : {}),
        notebookId: input.notebookId,
        summary,
        params: { event: input.event },
        status: 'denied',
        decision: 'never',
    });
    // Seen before: the same row, touched.
    if (doc.createdAt.getTime() < before) return (await updateAction(doc._id, { summary })) ?? doc;
    return doc;
}

/** Statuses a row may move to each status from. Done, undone, expired and denied are ends. */
const STILL_OPEN: BotActionStatus[] = ['proposed', 'approved', 'auto', 'queued'];
const MOVES_FROM: Partial<Record<BotActionStatus, BotActionStatus[]>> = {
    queued: [...STILL_OPEN, 'failed'],
    failed: [...STILL_OPEN, 'failed'],
    expired: STILL_OPEN,
    denied: STILL_OPEN,
    // A success wins over a failure or expiry: the event exists.
    done: [...STILL_OPEN, 'failed', 'expired', 'done'],
    undone: ['done', 'undone'],
};

/**
 * Brings the log row in line with the proposal. The proposal is read again here, so a
 * caller's older copy can't move the row back, and a row never moves back from done,
 * undone, expired or denied. Proposals from before the log get their row the first time
 * they change, dated when they were proposed.
 */
export async function syncCalendarAction(doc: CalendarProposalDocument): Promise<void> {
    const proposal = (await findProposal(doc._id)) ?? doc;
    const row = (await findAction(proposal._id)) ?? (await recordOlderProposal(proposal));
    const meta: ActionChanges = {
        ...(proposal.expiresAt.getTime() !== row.expiresAt?.getTime()
            ? { expiresAt: proposal.expiresAt }
            : {}),
        ...(proposal.pageId && !row.pageId ? { pageId: proposal.pageId } : {}),
        ...(proposal.messageId && !row.messageId ? { messageId: proposal.messageId } : {}),
    };
    const change = statusChange(proposal, row);
    if (change?.status) {
        const from = [...(MOVES_FROM[change.status] ?? [])];
        // The owner cancelled it, but a Mac added it anyway: the event exists, undo it.
        if (change.status === 'done' && row.cancelRequestedAt) from.push('denied');
        const moved = await updateAction(proposal._id, { ...meta, ...change }, { from });
        if (moved) return afterChange(moved);
    }
    if (Object.keys(meta).length) await updateAction(proposal._id, meta);
}

function statusChange(
    proposal: CalendarProposalDocument,
    row: BotActionDocument,
): ActionChanges | null {
    switch (proposal.status) {
        case 'proposed':
        case 'not_found': // The row stays done; its undo says what happened.
            return null;
        case 'queued':
        case 'delivered':
            return {
                status: 'queued',
                error: null,
                // A tap (the first, or Try again) is the owner's approval, whatever the
                // setting did before. Requeues after an automatic confirm keep `auto`.
                ...(proposal.confirmedAt && !proposal.autoConfirmed
                    ? {
                          decision: 'ask' as const,
                          approvedBy: proposal.userId,
                          approvedAt: proposal.confirmedAt,
                      }
                    : {}),
            };
        case 'added':
            return {
                status: 'done',
                error: null,
                completedAt: row.completedAt ?? proposal.completedAt ?? new Date(),
                result: {
                    ...(proposal.eventIdentifier
                        ? { eventIdentifier: proposal.eventIdentifier }
                        : {}),
                    ...(proposal.itemId ? { itemId: proposal.itemId } : {}),
                    ...(proposal.deviceId ? { deviceId: proposal.deviceId } : {}),
                },
            };
        case 'failed':
            return {
                status: 'failed',
                error: proposal.error ?? 'The Mac could not add the event.',
            };
        case 'expired':
            return { status: 'expired' };
        case 'removed':
            return { status: 'undone' };
        case 'cancelled':
            return { status: 'denied' };
    }
}

/** A cancelled add that a Mac finished anyway is undone straight away. */
async function afterChange(row: BotActionDocument): Promise<void> {
    if (row.status !== 'done' || !row.cancelRequestedAt || row.undo) return;
    await undoCalendarAdd(row, row.ownerId).catch(async (error) => {
        const message = error instanceof Error ? error.message : 'It could not be undone.';
        await updateAction(row._id, { error: `Cancelled too late to stop it. ${message}` });
    });
}

/** A proposal from before the log: logged as it was, on the day it was proposed. */
async function recordOlderProposal(proposal: CalendarProposalDocument) {
    return recordAction({
        id: proposal._id,
        kind: 'calendar_add',
        ownerId: proposal.userId,
        botId: proposal.botId,
        notebookId: proposal.notebookId,
        summary: calendarActionSummary(proposal.event),
        params: { event: proposal.event },
        status: 'proposed',
        decision: 'ask',
        ...(proposal.confirmedAt
            ? { approvedBy: proposal.userId, approvedAt: proposal.confirmedAt }
            : {}),
        expiresAt: proposal.expiresAt,
        createdAt: proposal.createdAt,
    });
}

/** The owner cancelled a queued add: recorded first, so a late success is undone. */
export async function markCancelRequested(
    row: BotActionDocument,
): Promise<BotActionDocument | null> {
    const now = new Date();
    const updated = await updateActionDoc(
        row._id,
        { $set: { cancelRequestedAt: now, updatedAt: now } },
        { cancelRequestedAt: { $exists: false } },
    );
    if (updated) await broadcastAction(updated);
    return updated;
}

// MARK: - Undo

/** Which Mac removes it: the one that added it while it still collects the calendar. */
async function undoTarget(userId: string, addedBy: unknown) {
    const macs = (await listCollectors(userId)).filter(
        (c) => c.platform === 'macos' && c.activeSources.includes('calendar'),
    );
    const adder = typeof addedBy === 'string' ? macs.find((c) => c.deviceId === addedBy) : null;
    if (adder) return { collector: adder, fallback: false };
    const other = macs[0];
    return other ? { collector: other, fallback: typeof addedBy === 'string' && !!addedBy } : null;
}

/** Queues removing the event on the Mac. Repeating it while queued changes nothing. */
export async function undoCalendarAdd(
    row: BotActionDocument,
    userId: string,
): Promise<BotActionDocument> {
    const eventIdentifier = row.result?.['eventIdentifier'];
    if (typeof eventIdentifier !== 'string' || !eventIdentifier)
        throw new ActionError(409, 'This event can’t be removed from here. Remove it in Calendar.');
    const target = await undoTarget(userId, row.result?.['deviceId']);
    if (!target)
        throw new ActionError(
            409,
            'No Mac is collecting your calendar. Open Just Maple on your Mac and turn on Calendar, then try again.',
        );
    const now = new Date();
    const updated = await updateActionDoc(
        row._id,
        {
            $set: {
                undo: {
                    id: randomUUID(),
                    state: 'queued',
                    requestedAt: now,
                    requestedBy: userId,
                    targetDeviceId: target.collector.deviceId,
                    deviceName: target.collector.name,
                    ...(target.fallback ? { fallback: true } : {}),
                },
                updatedAt: now,
            },
        },
        {
            status: 'done',
            'undo.state': { $nin: ['queued', 'delivered', 'done', 'not_found'] },
        },
    );
    const current = updated ?? (await findAction(row._id))!;
    if (updated) await broadcastAction(updated);
    nudge(userId);
    return current;
}

/**
 * `delete_event` actions for this Mac: undos meant for it (or for a Mac that no longer
 * collects the calendar), ones it took but never reported, and ones another Mac held for
 * 15 minutes without reporting once that Mac stopped collecting.
 */
export async function takeUndoActions(
    userId: string,
    deviceId: string,
): Promise<DeleteEventAction[]> {
    const collector = await findCollector(userId, deviceId);
    if (collector?.platform !== 'macos' || !collector.activeSources.includes('calendar')) return [];
    const collecting = new Set(
        (await listCollectors(userId))
            .filter((c) => c.platform === 'macos' && c.activeSources.includes('calendar'))
            .map((c) => c.deviceId),
    );
    const now = new Date();
    const pending = (await findPendingUndos(userId)).sort(
        (a, b) => a.undo!.requestedAt.getTime() - b.undo!.requestedAt.getTime(),
    );
    const mine: BotActionDocument[] = [];
    for (const row of pending.slice(0, 50)) {
        const undo = row.undo!;
        if (undo.state === 'delivered' && undo.deviceId === deviceId) {
            mine.push(row);
            continue;
        }
        const target = undo.targetDeviceId;
        // Another Mac that still collects the calendar is meant to do it.
        if (target && target !== deviceId && collecting.has(target)) continue;
        const stale =
            undo.state === 'delivered' &&
            (!undo.deviceId ||
                !collecting.has(undo.deviceId) ||
                (!!undo.deliveredAt &&
                    now.getTime() - undo.deliveredAt.getTime() >= STALE_DELIVERY_MS));
        if (undo.state !== 'queued' && !stale) continue;
        const rerouted = !!target && target !== deviceId;
        const taken = await updateActionDoc(
            row._id,
            {
                $set: {
                    'undo.state': 'delivered',
                    'undo.deviceId': deviceId,
                    'undo.deliveredAt': now,
                    ...(rerouted
                        ? {
                              'undo.targetDeviceId': deviceId,
                              'undo.deviceName': collector.name,
                              'undo.fallback': true,
                          }
                        : {}),
                    updatedAt: now,
                },
                $addToSet: { 'undo.deliveredTo': deviceId },
            },
            { 'undo.id': undo.id, 'undo.state': undo.state },
        );
        if (taken) {
            mine.push(taken);
            if (rerouted) await broadcastAction(taken);
        }
    }
    return mine.map((row) => ({
        id: row.undo!.id,
        type: 'delete_event',
        source: 'calendar',
        eventIdentifier: String(row.result?.['eventIdentifier'] ?? ''),
        createdBy: row._id,
        event: (row.params as { event: CalendarEventDraft }).event,
        createdAt: row.undo!.requestedAt.toISOString(),
        expiresAt: new Date(row.undo!.requestedAt.getTime() + UNDO_LIFETIME_MS).toISOString(),
    }));
}

/**
 * The Mac's report on an undo. Null when `undoId` isn't an undo (the caller then treats
 * it as an "Add to calendar" result). The caller marks the proposal removed (or not
 * found) afterwards. Idempotent; a success from any Mac it was given to counts, a
 * failure only from the one holding it.
 */
export async function reportUndoResult(
    userId: string,
    deviceId: string,
    undoId: string,
    result: DeviceActionResult,
): Promise<BotActionDocument | null> {
    const row = await findActionByUndoId(userId, undoId);
    if (!row?.undo) return null;
    if (!row.undo.deliveredTo?.includes(deviceId)) throw new ActionError(404, 'Action not found');
    if (row.undo.state === 'done' || row.undo.state === 'not_found') return row;
    const now = new Date();
    if (result.ok) {
        // Found nothing to remove: the event stays "done", the undo says so.
        const notFound = result.outcome === 'not_found';
        const done = await updateActionDoc(
            row._id,
            {
                $set: {
                    'undo.state': notFound ? 'not_found' : 'done',
                    'undo.completedAt': now,
                    'undo.deviceId': deviceId,
                    ...(notFound ? {} : { status: 'undone' as const }),
                    updatedAt: now,
                },
                $unset: { 'undo.error': '' },
            },
            { 'undo.id': undoId, 'undo.state': { $nin: ['done', 'not_found'] } },
        );
        if (!done) return (await findAction(row._id))!;
        await broadcastAction(done);
        return done;
    }
    const failed = await updateActionDoc(
        row._id,
        {
            $set: {
                'undo.state': 'failed',
                'undo.error': (result.error?.trim() || 'The Mac could not remove the event.').slice(
                    0,
                    500,
                ),
                updatedAt: now,
            },
        },
        { 'undo.id': undoId, 'undo.state': 'delivered', 'undo.deviceId': deviceId },
    );
    if (failed) await broadcastAction(failed);
    return failed ?? (await findAction(row._id))!;
}

/**
 * Undos no Mac picked up within 7 days give up, so the row can be undone again. With
 * `onlyId`, just that row.
 */
export async function expireStaleUndos(userId: string, onlyId?: string): Promise<void> {
    const cutoff = Date.now() - UNDO_LIFETIME_MS;
    for (const row of await findPendingUndos(userId)) {
        if (onlyId && row._id !== onlyId) continue;
        if (row.kind !== 'calendar_add' || row.undo!.requestedAt.getTime() > cutoff) continue;
        const failed = await updateActionDoc(
            row._id,
            {
                $set: {
                    'undo.state': 'failed',
                    'undo.error': 'Your Mac didn’t remove the event in time.',
                    updatedAt: new Date(),
                },
            },
            { 'undo.id': row.undo!.id, 'undo.state': row.undo!.state },
        );
        if (failed) await broadcastAction(failed);
    }
}

function nudge(userId: string): void {
    void macDataRelay.request(userId, 'runActions', {}, 5_000).catch(() => {});
}
