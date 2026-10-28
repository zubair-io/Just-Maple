import { randomUUID } from 'crypto';
import {
    formatEventTime,
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
 *   expired → expired, removed → undone.
 *
 * Undo (24 hours after it was added) queues a `delete_event` action for the Mac
 * collecting the calendar, next to the `create_event` ones. The Mac removes the event
 * only if it still carries this proposal's marker, and an event that's already gone
 * counts as removed, so undo is safe to repeat.
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

/** An event the bot may never add: logged as denied, no proposal is saved. */
export async function recordDeniedCalendarAction(input: {
    ownerId: string;
    botId: string;
    botName?: string;
    notebookId: string;
    event: CalendarEventDraft;
}): Promise<BotActionDocument> {
    return recordAction({
        kind: 'calendar_add',
        ownerId: input.ownerId,
        botId: input.botId,
        ...(input.botName ? { botName: input.botName } : {}),
        notebookId: input.notebookId,
        summary: calendarActionSummary(input.event),
        params: { event: input.event },
        status: 'denied',
        decision: 'never',
    });
}

/**
 * Brings the log row in line with the proposal. Proposals from before the log get
 * their row the first time they change.
 */
export async function syncCalendarAction(doc: CalendarProposalDocument): Promise<void> {
    const row = (await findAction(doc._id)) ?? (await recordCalendarProposal(doc, 'ask'));
    const changes: ActionChanges = {
        expiresAt: doc.expiresAt,
        ...(doc.pageId && !row.pageId ? { pageId: doc.pageId } : {}),
        ...(doc.messageId && !row.messageId ? { messageId: doc.messageId } : {}),
    };
    switch (doc.status) {
        case 'proposed':
            break;
        case 'queued':
        case 'delivered':
            changes.status = 'queued';
            changes.error = null;
            // A tap (the first, or Try again). Auto rows keep their decision.
            if (row.decision !== 'auto' && doc.confirmedAt) {
                changes.decision = 'ask';
                changes.approvedBy = doc.userId;
                changes.approvedAt = doc.confirmedAt;
            }
            break;
        case 'added':
            // Undone already: a late repeat of the report doesn't bring it back.
            if (row.status === 'undone') return;
            changes.status = 'done';
            changes.error = null;
            changes.completedAt = row.completedAt ?? doc.completedAt ?? new Date();
            changes.result = {
                ...(doc.eventIdentifier ? { eventIdentifier: doc.eventIdentifier } : {}),
                ...(doc.itemId ? { itemId: doc.itemId } : {}),
                ...(doc.deviceId ? { deviceId: doc.deviceId } : {}),
            };
            break;
        case 'failed':
            changes.status = 'failed';
            changes.error = doc.error ?? 'The Mac could not add the event.';
            break;
        case 'expired':
            changes.status = 'expired';
            break;
        case 'removed':
            changes.status = 'undone';
            break;
    }
    await updateAction(doc._id, changes);
}

// MARK: - Undo

/** Queues removing the event on the Mac. Repeating it while queued changes nothing. */
export async function undoCalendarAdd(
    row: BotActionDocument,
    userId: string,
): Promise<BotActionDocument> {
    const eventIdentifier = row.result?.['eventIdentifier'];
    if (typeof eventIdentifier !== 'string' || !eventIdentifier)
        throw new ActionError(409, 'This event can’t be removed from here. Remove it in Calendar.');
    if (!(await calendarCollector(userId)))
        throw new ActionError(
            409,
            'No Mac is collecting your calendar. Open Just Maple on your Mac and turn on Calendar, then try again.',
        );
    const now = new Date();
    const updated = await updateActionDoc(
        row._id,
        {
            $set: {
                undo: { id: randomUUID(), state: 'queued', requestedAt: now, requestedBy: userId },
                updatedAt: now,
            },
        },
        { status: 'done', 'undo.state': { $nin: ['queued', 'delivered'] } },
    );
    const current = updated ?? (await findAction(row._id))!;
    if (updated) await broadcastAction(updated);
    nudge(userId);
    return current;
}

/**
 * `delete_event` actions for this Mac: newly queued undos, ones it took but never
 * reported, and ones another Mac held for 15 minutes without reporting. Only the Mac
 * collecting the calendar gets them.
 */
export async function takeUndoActions(
    userId: string,
    deviceId: string,
): Promise<DeleteEventAction[]> {
    const collector = await findCollector(userId, deviceId);
    if (collector?.platform !== 'macos' || !collector.activeSources.includes('calendar')) return [];
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
        const stale =
            undo.state === 'delivered' &&
            !!undo.deliveredAt &&
            now.getTime() - undo.deliveredAt.getTime() >= STALE_DELIVERY_MS;
        if (undo.state !== 'queued' && !stale) continue;
        const taken = await updateActionDoc(
            row._id,
            {
                $set: {
                    'undo.state': 'delivered',
                    'undo.deviceId': deviceId,
                    'undo.deliveredAt': now,
                    updatedAt: now,
                },
                $addToSet: { 'undo.deliveredTo': deviceId },
            },
            { 'undo.id': undo.id, 'undo.state': undo.state },
        );
        if (taken) mine.push(taken);
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
 * it as an "Add to calendar" result). The caller marks the proposal removed once undone. Idempotent; a success from any Mac it was given to
 * counts, a failure only from the one holding it.
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
    if (row.undo.state === 'done') return row;
    const now = new Date();
    if (result.ok) {
        const done = await updateActionDoc(
            row._id,
            {
                $set: {
                    'undo.state': 'done',
                    'undo.completedAt': now,
                    'undo.deviceId': deviceId,
                    status: 'undone',
                    updatedAt: now,
                },
                $unset: { 'undo.error': '' },
            },
            { 'undo.id': undoId, 'undo.state': { $ne: 'done' } },
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

/** Undos no Mac picked up within 7 days give up, so the row can be undone again. */
export async function expireStaleUndos(userId: string): Promise<void> {
    const cutoff = Date.now() - UNDO_LIFETIME_MS;
    for (const row of await findPendingUndos(userId)) {
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

async function calendarCollector(userId: string) {
    return (
        (await listCollectors(userId)).find(
            (c) => c.platform === 'macos' && c.activeSources.includes('calendar'),
        ) ?? null
    );
}

function nudge(userId: string): void {
    void macDataRelay.request(userId, 'runActions', {}, 5_000).catch(() => {});
}
