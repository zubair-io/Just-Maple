import type {
    BotUIBlock,
    BotUIResponse,
    CalendarEventDraft,
    CalendarProposal,
    CalendarProposalStatus,
    DeviceAction,
    DeviceActionResult,
} from '@maple/shared';
import {
    attachToMessage,
    cancelQueued,
    completeAction,
    createProposal,
    expireStale,
    failProposal,
    findDuplicate,
    findProposal,
    markNotFound,
    markRemoved,
    OPEN_STATUSES,
    queueProposal,
    requeueStranded,
    takePendingActions,
    type CalendarProposalDocument,
} from '../repositories/calendar-proposal.repo';
import { findCollector, listCollectors } from '../repositories/collector.repo';
import { isMemberOf } from './device-data-access.service';
import { broadcastChatEvent } from './realtime.service';
import { macDataRelay } from './mac-data-relay.service';
import type { MacDataToolContext, ToolDefinition } from './mac-data-tools.service';
import { toEpochSeconds } from '../utils/time-zone';
import { ActionError, decideAutonomy } from './bot-action.service';
import {
    findAction as findActionDoc,
    type BotActionDocument,
} from '../repositories/bot-action.repo';
import {
    markCancelRequested,
    recordCalendarProposal,
    recordDeniedCalendarAction,
    syncCalendarAction,
    undoCalendarAdd,
} from './calendar-action.service';

/**
 * "Add to calendar"
 *
 * 1. A bot calls `propose_calendar_event`; a proposal is saved and an `event_proposal`
 *    card is attached to its reply. Bots can only propose.
 * 2. The calendar's owner taps Add (`confirmProposal`). That queues a `create_event`
 *    action for the Mac collecting their calendar, and nudges it if it's connected.
 * 3. The Mac lists its actions on every sync and when it connects (`takeActions`), adds
 *    the event with EventKit and reports the result (`reportActionResult`). An action a
 *    Mac holds for 15 minutes without reporting, or holds after it stops collecting the
 *    calendar, goes back to the queue for whichever Mac collects it next.
 * 4. Every change is broadcast to the chat, so the card moves through
 *    proposed → adding → added (or failed / expired).
 *
 * Expiry and stranded actions are caught up lazily (`settle`) whenever a card is read,
 * tapped, proposed or polled; what changes is broadcast like any other change.
 *
 * Every proposal is also a row in the bot action log (calendar-action.service), kept in
 * step on each change. The owner's autonomy setting for the bot decides whether the bot
 * asks (the card), adds it without a tap ("Done · Undo" card), or may never add events.
 */

/** After this long without hearing from the Mac, the card says it will be added later. */
export const DEVICE_OFFLINE_AFTER_MS = 10 * 60 * 1000;
export const MAX_PROPOSALS_PER_RUN = 3;

export class ProposalError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

// MARK: - Proposing (bots)

/**
 * Saves a proposal for `userId`'s calendar, unless the same event (title and start) is
 * already open or added for them:
 * - `existing`: still open in this notebook; its card is shown again;
 * - `elsewhere`: open in another chat; no second card;
 * - `added`: already added from an earlier card.
 */
export async function proposeEvent(params: {
    userId: string;
    notebookId: string;
    botId: string;
    event: CalendarEventDraft;
}): Promise<{
    proposal: CalendarProposalDocument;
    outcome: 'created' | DuplicateOutcome;
}> {
    const duplicate = await findExistingProposal(params);
    if (duplicate) return duplicate;
    return { proposal: await createProposal(params), outcome: 'created' };
}

type DuplicateOutcome = 'existing' | 'elsewhere' | 'added' | 'removed' | 'cancelled';

/** The same event already proposed for this user (see `proposeEvent`), after catching up. */
export async function findExistingProposal(params: {
    userId: string;
    notebookId: string;
    event: CalendarEventDraft;
}): Promise<{ proposal: CalendarProposalDocument; outcome: DuplicateOutcome } | null> {
    await settle(params.userId);
    const duplicate = await findDuplicate(params.userId, params.notebookId, params.event);
    if (!duplicate) return null;
    const outcome =
        duplicate.status === 'added' ||
        duplicate.status === 'removed' ||
        duplicate.status === 'cancelled'
            ? duplicate.status
            : duplicate.notebookId === params.notebookId
              ? 'existing'
              : 'elsewhere';
    return { proposal: duplicate, outcome };
}

/**
 * Bots get the tool when the run reads the user's own calendar: the only calendar a
 * proposal can go to.
 */
export function canProposeEvents(ctx: MacDataToolContext): boolean {
    if (!ctx.botId || !ctx.sources.includes('calendar')) return false;
    return (
        !ctx.pages ||
        ctx.pages.some((page) => page.source === 'calendar' && page.ownerId === ctx.userId)
    );
}

export const proposeEventTool: ToolDefinition = {
    name: 'propose_calendar_event',
    description:
        "Offer to add an event to the user's calendar, for example a game, party or appointment from an email or message. " +
        'First check with search_local_data that it is not already on the calendar. ' +
        'This only proposes: a card with the details and an "Add to calendar" button is attached to your reply automatically, ' +
        'and nothing is added until the user taps it. Do not add your own Button for it. Put useful details in notes, e.g. "pickup 4:15–4:30, bring jersey".',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', maxLength: 200 },
            start: {
                type: 'string',
                description:
                    "ISO 8601 in the user's time zone, e.g. 2026-10-28T15:00. A bare date for all-day events.",
            },
            end: { type: 'string', description: 'ISO 8601. Defaults to one hour after start.' },
            all_day: { type: 'boolean' },
            location: { type: 'string', maxLength: 500 },
            notes: { type: 'string', maxLength: 2000 },
        },
        required: ['title', 'start'],
        additionalProperties: false,
    },
};

/** Runs `propose_calendar_event`; the ids collect on the context for the reply's cards. */
export async function executeProposeEvent(
    ctx: MacDataToolContext,
    input: Record<string, unknown>,
): Promise<string> {
    if (!canProposeEvents(ctx)) return 'Unknown tool: propose_calendar_event';
    if (
        (ctx.proposedEvents?.length ?? 0) + (ctx.actionReceipts?.length ?? 0) >=
        MAX_PROPOSALS_PER_RUN
    )
        return `At most ${MAX_PROPOSALS_PER_RUN} events can be proposed in one reply.`;
    const event = toDraft(input, ctx.timeZone);
    if (typeof event === 'string') return event;
    const where = { userId: ctx.userId, notebookId: ctx.notebookId, botId: ctx.botId! };
    // Events already offered or added first: they never log a denied row.
    const duplicate = await findExistingProposal({ ...where, event });
    switch (duplicate?.outcome) {
        case 'added':
            return 'The user already added this event to their calendar from an earlier card. Do not offer it again.';
        case 'removed':
            return 'This event was added earlier and the user removed it again. Do not offer it again.';
        case 'cancelled':
            return 'The user cancelled adding this event. Do not offer it again.';
        case 'elsewhere':
            return 'This event was already offered in another chat and is waiting for the user there. Do not offer it again here.';
    }
    // The owner's setting for this bot decides; the bot never sees it.
    const { autonomy } = await decideAutonomy({
        ownerId: ctx.userId,
        botId: ctx.botId!,
        kind: 'calendar_add',
        notebookId: ctx.notebookId,
        params: { event },
    });
    if (autonomy === 'never') {
        // Already offered before the setting changed: logged then, not again.
        if (!duplicate)
            await recordDeniedCalendarAction({
                ownerId: ctx.userId,
                botId: ctx.botId!,
                botName: ctx.botName,
                notebookId: ctx.notebookId,
                event,
            });
        return 'The user has turned off adding calendar events for you. Do not offer this event; you may mention it in your reply.';
    }
    if (duplicate) {
        ctx.proposedEvents = [...(ctx.proposedEvents ?? []), duplicate.proposal._id];
        return 'This event was already proposed and is still waiting for the user. The card is attached to your reply again.';
    }
    const proposal = await createProposal({ ...where, event });
    await recordCalendarProposal(proposal, autonomy, ctx.botName);
    if (autonomy === 'auto') return autoAdd(ctx, proposal);
    ctx.proposedEvents = [...(ctx.proposedEvents ?? []), proposal._id];
    return 'Proposed. The card with an "Add to calendar" button is attached to your reply. Nothing is added until the user taps it, so say it is not on their calendar yet.';
}

/**
 * "Do it and tell me": queued as if the owner had tapped. The reply gets a
 * "Done · Undo" card; if it can't be queued (no Mac), the usual card with Try again.
 */
async function autoAdd(
    ctx: MacDataToolContext,
    proposal: CalendarProposalDocument,
): Promise<string> {
    const view = await confirmProposal(proposal._id, ctx.userId, { auto: true }).catch(() => null);
    if (!view || view.status === 'failed') {
        ctx.proposedEvents = [...(ctx.proposedEvents ?? []), proposal._id];
        return `It could not be added: ${view?.error ?? 'something went wrong.'} A card with the details and a Try again button is attached to your reply.`;
    }
    ctx.actionReceipts = [...(ctx.actionReceipts ?? []), proposal._id];
    return "Added to the user's calendar without asking, as they chose (their Mac finishes it shortly). A card saying so, with Undo, is attached to your reply: say you added it.";
}

function toDraft(input: Record<string, unknown>, timeZone: string): CalendarEventDraft | string {
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : '';
    if (!title) return 'Error: a title is required.';
    const allDay =
        input.all_day === true ||
        (typeof input.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.start.trim()));
    const start = toEpochSeconds(input.start, timeZone, 'start');
    if (start === undefined) return 'Error: start must be an ISO 8601 date or date-time.';
    const end = allDay
        ? (toEpochSeconds(input.end ?? input.start, timeZone, 'end') ?? start) + 1
        : (toEpochSeconds(input.end, timeZone, 'end') ?? start + 60 * 60);
    if (end <= start) return 'Error: end must be after start.';
    if (end - start > 31 * 24 * 60 * 60) return 'Error: events can be at most 31 days long.';
    const text = (value: unknown, max: number) =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
    const location = text(input.location, 500);
    const notes = text(input.notes, 2000);
    return {
        title,
        start,
        end,
        ...(allDay ? { allDay: true } : {}),
        ...(location ? { location } : {}),
        ...(notes ? { notes } : {}),
        timeZone,
    };
}

/** Cards for the proposals a bot made in this run, added to its reply's blocks. */
export async function withProposalCards(
    ui: BotUIResponse | undefined,
    proposalIds: string[],
): Promise<BotUIResponse | undefined> {
    const cards: BotUIBlock[] = [];
    for (const id of [...new Set(proposalIds)]) {
        const doc = await findProposal(id);
        if (doc) cards.push({ type: 'event_proposal', proposalId: doc._id, event: doc.event });
    }
    if (!cards.length) return ui;
    const blocks = [...(ui?.blocks ?? []), ...cards].slice(-30);
    return { version: 1, format: 'openui', blocks };
}

/** Once the reply is posted: the cards' chat, so later updates reach it. */
export async function attachProposals(
    proposalIds: string[],
    pageId: string,
    messageId: string,
): Promise<void> {
    await attachToMessage([...new Set(proposalIds)], pageId, messageId);
}

// MARK: - Cards (people)

/** What a notebook member sees on the card. Null when they can't see it. */
export async function getProposalView(
    id: string,
    viewerId: string,
): Promise<CalendarProposal | null> {
    const doc = await settled(id);
    if (!doc || !(await isMemberOf(doc.notebookId, viewerId))) return null;
    return toView(doc, viewerId);
}

/**
 * The owner's tap. Repeated taps return the current state; only the owner may confirm,
 * and only while they're still in the notebook. `auto`: confirmed by the owner's
 * "Do it and tell me" setting rather than a tap.
 */
export async function confirmProposal(
    id: string,
    userId: string,
    options: { auto?: boolean } = {},
): Promise<CalendarProposal> {
    const doc = await settled(id);
    if (!doc || !(await isMemberOf(doc.notebookId, userId)))
        throw new ProposalError(404, 'Proposal not found');
    if (doc.userId !== userId)
        throw new ProposalError(403, 'Only the owner of this calendar can add the event.');
    if (doc.status === 'expired')
        throw new ProposalError(409, 'This proposal expired. Ask the bot to propose it again.');

    const queued = await queueProposal(id, userId, options);
    if (!queued) {
        // Already adding: nudge the Mac again in case it missed the first one.
        const current = (await findProposal(id))!;
        if (current.status === 'queued') nudge(userId);
        return toView(current, userId);
    }

    const collector = await calendarCollector(userId);
    if (!collector) {
        const failed = await failProposal(
            id,
            'No Mac is collecting your calendar. Open Just Maple on your Mac and turn on Calendar, then try again.',
        );
        await broadcastProposal(failed ?? queued);
        return toView((failed ?? queued)!, userId);
    }
    await broadcastProposal(queued);
    nudge(userId);
    return toView(queued, userId);
}

/** If the Mac is connected right now, tell it to look instead of waiting for its next sync. */
function nudge(userId: string): void {
    void macDataRelay.request(userId, 'runActions', {}, 5_000).catch(() => {});
}

// MARK: - Collector action queue (devices)

/**
 * Pending actions for this device. Only the device collecting `calendar` gets
 * calendar actions; listing also counts as being seen.
 */
export async function takeActions(userId: string, deviceId: string): Promise<DeviceAction[]> {
    const collector = await findCollector(userId, deviceId);
    if (!collector) throw new ProposalError(404, 'Device not found');
    await settle(userId);
    if (collector.platform !== 'macos' || !collector.activeSources.includes('calendar')) return [];
    const { actions, delivered } = await takePendingActions(userId, deviceId);
    await broadcastAll(delivered);
    return actions;
}

export async function reportActionResult(
    userId: string,
    deviceId: string,
    id: string,
    result: DeviceActionResult,
): Promise<CalendarProposal> {
    if (result.itemId && !result.itemId.startsWith('calendar:'))
        throw new ProposalError(400, 'itemId must be a calendar item id');
    const outcome = await completeAction(userId, deviceId, id, result);
    if (!outcome) throw new ProposalError(404, 'Action not found');
    if (outcome.changed) await broadcastProposal(outcome.doc);
    return toView(outcome.doc, userId);
}

/** Undo finished on the Mac: the card says the event was removed. */
export async function markProposalRemoved(id: string): Promise<void> {
    await broadcastProposal(await markRemoved(id));
}

/** Undo found nothing on the Mac: the card says so, and the bot may offer it again. */
export async function markProposalNotFound(id: string): Promise<void> {
    await broadcastProposal(await markNotFound(id));
}

/**
 * The owner's Cancel on a queued add (the action log's row `row`). Before a Mac has
 * taken it, it isn't done at all; once one has, it's undone as soon as it's added; if
 * it's already added, this is an Undo.
 */
export async function cancelCalendarAdd(
    row: BotActionDocument,
    userId: string,
): Promise<BotActionDocument> {
    const proposal = await findProposal(row._id);
    if (!proposal) throw new ActionError(404, 'Action not found');
    if (proposal.status === 'added') return undoCalendarAdd(row, userId);
    if (proposal.status !== 'queued' && proposal.status !== 'delivered')
        throw new ActionError(409, 'Only actions that are still waiting can be cancelled.');
    // Recorded first, so an add that finishes anyway is undone.
    await markCancelRequested(row);
    const cancelled = await cancelQueued(row._id);
    if (cancelled) await broadcastProposal(cancelled);
    else {
        // A Mac took it meanwhile, or even finished it.
        const current = await findProposal(row._id);
        if (current) await syncCalendarAction(current);
    }
    return (await findActionDoc(row._id)) ?? row;
}

// MARK: - Private

/**
 * Catches up on time: open proposals past their 7 days expire, and stranded deliveries
 * go back to the queue. Every card that changed is told.
 */
async function settle(userId: string): Promise<void> {
    await settleProposals(userId);
}

/** `settle`, for the action log's reads. */
export async function settleProposals(userId: string): Promise<void> {
    const expired = await expireStale(userId);
    const collector = await calendarCollector(userId);
    const requeued = await requeueStranded(userId, collector?.deviceId ?? null);
    await broadcastAll([...expired, ...requeued]);
}

/** `settle` for one proposal only: reading a single card doesn't catch up all of them. */
export async function settleProposal(id: string): Promise<void> {
    const doc = await findProposal(id);
    if (!doc || !OPEN_STATUSES.includes(doc.status)) return;
    const expired = await expireStale(doc.userId, id);
    const requeued =
        !expired.length && doc.status === 'delivered'
            ? await requeueStranded(
                  doc.userId,
                  (await calendarCollector(doc.userId))?.deviceId ?? null,
                  id,
              )
            : [];
    await broadcastAll([...expired, ...requeued]);
}

/** The proposal after catching up, when it may have moved on since it was last read. */
async function settled(id: string): Promise<CalendarProposalDocument | null> {
    const doc = await findProposal(id);
    if (!doc || !OPEN_STATUSES.includes(doc.status)) return doc;
    await settleProposal(id);
    return findProposal(id);
}

async function calendarCollector(userId: string) {
    return (
        (await listCollectors(userId)).find(
            (c) => c.platform === 'macos' && c.activeSources.includes('calendar'),
        ) ?? null
    );
}

export function viewStatus(doc: CalendarProposalDocument): CalendarProposalStatus {
    switch (doc.status) {
        case 'queued':
        case 'delivered':
            return 'adding';
        default:
            return doc.status;
    }
}

async function toView(doc: CalendarProposalDocument, viewerId: string): Promise<CalendarProposal> {
    const status = viewStatus(doc);
    let device: CalendarProposal['device'];
    if (status === 'adding') {
        const collector = doc.deviceId
            ? await findCollector(doc.userId, doc.deviceId)
            : await calendarCollector(doc.userId);
        if (collector) {
            const lastSeenAt = collector.lastSeenAt ?? new Date(0).toISOString();
            device = {
                name: collector.name,
                lastSeenAt,
                offline: Date.now() - Date.parse(lastSeenAt) > DEVICE_OFFLINE_AFTER_MS,
            };
        }
    }
    return {
        id: doc._id,
        notebookId: doc.notebookId,
        ...(doc.pageId ? { pageId: doc.pageId } : {}),
        ...(doc.messageId ? { messageId: doc.messageId } : {}),
        event: doc.event,
        status,
        ...(status === 'failed' && doc.error ? { error: doc.error } : {}),
        ...(status === 'added' && doc.itemId ? { itemId: doc.itemId } : {}),
        ...(device ? { device } : {}),
        canConfirm: doc.userId === viewerId,
        expiresAt: doc.expiresAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Tells everyone in the chat. `canConfirm` is left out: each client knows whether it's
 * the owner from the card it loaded.
 */
async function broadcastProposal(doc: CalendarProposalDocument | null): Promise<void> {
    if (doc)
        await syncCalendarAction(doc).catch((error) =>
            console.error('[CalendarProposal] Could not update the action log:', error),
        );
    if (!doc?.pageId) return;
    const { canConfirm: _, ...data } = await toView(doc, '');
    await broadcastChatEvent(doc.notebookId, {
        action: 'calendar_proposal_updated',
        pageId: doc.pageId,
        notebookId: doc.notebookId,
        userId: doc.userId,
        data,
        timestamp: new Date().toISOString(),
    }).catch((error) => console.error('[CalendarProposal] Broadcast failed:', error));
}

async function broadcastAll(docs: CalendarProposalDocument[]): Promise<void> {
    for (const doc of docs) await broadcastProposal(doc);
}
