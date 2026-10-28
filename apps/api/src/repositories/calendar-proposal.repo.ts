import type { Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type { CalendarEventDraft, DeviceAction, DeviceActionResult } from '@maple/shared';

// "Add to calendar" proposals, and the queued `create_event` action each becomes once its
// owner taps Add. One document per proposal; its id is also the action id the Mac sees.
//
// proposed ──tap──▶ queued ──Mac lists it──▶ delivered ──Mac reports──▶ added | failed
//    │                 │   ▲                      │
//    │                 │   └── 15 min unreported, ┤
//    │                 │       or Mac stopped     │
//    │                 │       collecting calendar│
//    └─────────────────┴──── 7 days ──────────────┴──▶ expired
//
// failed ──tap again──▶ queued
// added ──Undo in the action log, Mac removed it──▶ removed (calendar-action.service)
//   └──Undo, but the Mac couldn't find it──▶ not_found (may be proposed again)
// queued ──the owner cancelled an automatic add──▶ cancelled
//
// Queries sort in code: Cosmos DB needs a matching index for every sort.

export type StoredProposalStatus =
    | 'proposed'
    | 'queued'
    | 'delivered'
    | 'added'
    | 'failed'
    | 'expired'
    | 'removed'
    | 'not_found'
    | 'cancelled';

export interface CalendarProposalDocument {
    _id: string;
    /** Whose calendar: the only person who can confirm it. */
    userId: string;
    notebookId: string;
    pageId?: string;
    messageId?: string;
    botId: string;
    event: CalendarEventDraft;
    status: StoredProposalStatus;
    /** The Mac holding the action now; only it gets it again until it reports. */
    deviceId?: string;
    /** Every Mac it was ever given to: a late success from any of them still counts. */
    deliveredTo?: string[];
    eventIdentifier?: string;
    itemId?: string;
    error?: string;
    createdAt: Date;
    confirmedAt?: Date;
    /** The last confirm was the owner's "Do it and tell me" setting, not a tap. */
    autoConfirmed?: boolean;
    deliveredAt?: Date;
    completedAt?: Date;
    /** 7 days from proposing, then 7 days from each tap. */
    expiresAt: Date;
    updatedAt: Date;
}

export const PROPOSAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** A delivered action unreported this long goes back to the queue. */
export const STALE_DELIVERY_MS = 15 * 60 * 1000;
export const OPEN_STATUSES: StoredProposalStatus[] = ['proposed', 'queued', 'delivered'];
const OPEN = OPEN_STATUSES;

export function isStaleDelivery(doc: CalendarProposalDocument, now = Date.now()): boolean {
    return (
        doc.status === 'delivered' &&
        !!doc.deliveredAt &&
        now - doc.deliveredAt.getTime() >= STALE_DELIVERY_MS
    );
}

function getCollection(): Collection<CalendarProposalDocument> {
    return getDb().collection<CalendarProposalDocument>('calendar_proposals');
}

export async function createProposal(input: {
    userId: string;
    notebookId: string;
    botId: string;
    event: CalendarEventDraft;
}): Promise<CalendarProposalDocument> {
    const now = new Date();
    const doc: CalendarProposalDocument = {
        _id: randomUUID(),
        ...input,
        status: 'proposed',
        createdAt: now,
        expiresAt: new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
        updatedAt: now,
    };
    await getCollection().insertOne(doc);
    return doc;
}

/**
 * The same event (title and start) already open or added for this user, in any notebook,
 * so a bot that sees the same email twice, or in two chats, offers it once. Prefers one
 * in `notebookId`.
 */
export async function findDuplicate(
    userId: string,
    notebookId: string,
    event: Pick<CalendarEventDraft, 'title' | 'start'>,
): Promise<CalendarProposalDocument | null> {
    const docs = await getCollection()
        .find({
            userId,
            'event.start': event.start,
            // Not `not_found`: it isn't on the calendar any more, so it may be offered again.
            status: { $in: [...OPEN, 'added', 'removed', 'cancelled'] },
        })
        .toArray();
    const title = event.title.trim().toLowerCase();
    const same = docs.filter((doc) => doc.event.title.trim().toLowerCase() === title);
    return same.find((doc) => doc.notebookId === notebookId) ?? same[0] ?? null;
}

export async function findProposal(id: string): Promise<CalendarProposalDocument | null> {
    return getCollection().findOne({ _id: id });
}

/** Records where the card was posted, so updates reach that chat. */
export async function attachToMessage(
    ids: string[],
    pageId: string,
    messageId: string,
): Promise<void> {
    if (!ids.length) return;
    await getCollection().updateMany(
        { _id: { $in: ids }, messageId: { $exists: false } },
        { $set: { pageId, messageId, updatedAt: new Date() } },
    );
}

/**
 * The owner's tap: queue the action. From `proposed`, `failed`, or a delivery that went
 * unreported for 15 minutes, so a second tap (or a double click) never queues it twice.
 * Null when it can't be confirmed now.
 */
export async function queueProposal(
    id: string,
    userId: string,
    options: { auto?: boolean } = {},
): Promise<CalendarProposalDocument | null> {
    const now = new Date();
    return getCollection().findOneAndUpdate(
        {
            _id: id,
            userId,
            $or: [
                { status: { $in: ['proposed', 'failed'] } },
                {
                    status: 'delivered',
                    deliveredAt: { $lte: new Date(now.getTime() - STALE_DELIVERY_MS) },
                },
            ],
        },
        {
            $set: {
                status: 'queued',
                confirmedAt: now,
                autoConfirmed: options.auto === true,
                expiresAt: new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
                updatedAt: now,
            },
            $unset: { error: '', deviceId: '', deliveredAt: '' },
        },
        { returnDocument: 'after' },
    );
}

export async function failProposal(
    id: string,
    error: string,
): Promise<CalendarProposalDocument | null> {
    return getCollection().findOneAndUpdate(
        { _id: id, status: { $in: ['queued', 'delivered'] } },
        { $set: { status: 'failed', error, updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
}

/**
 * Delivered actions stuck on a Mac go back to the queue: unreported for 15 minutes, or
 * held by a Mac that no longer collects the calendar (`calendarDeviceId` is the one that
 * does, if any). Returns the ones that moved.
 */
export async function requeueStranded(
    userId: string,
    calendarDeviceId: string | null,
    onlyId?: string,
): Promise<CalendarProposalDocument[]> {
    const now = new Date();
    const delivered = await getCollection()
        .find({ userId, status: 'delivered', ...(onlyId ? { _id: onlyId } : {}) })
        .toArray();
    const moved: CalendarProposalDocument[] = [];
    for (const doc of delivered) {
        if (doc.deviceId === calendarDeviceId && !isStaleDelivery(doc, now.getTime())) continue;
        const updated = await getCollection().findOneAndUpdate(
            { _id: doc._id, status: 'delivered', deviceId: doc.deviceId },
            {
                $set: { status: 'queued', updatedAt: now },
                $unset: { deviceId: '', deliveredAt: '' },
            },
            { returnDocument: 'after' },
        );
        if (updated) moved.push(updated);
    }
    return moved;
}

/**
 * Actions for this device: newly queued ones, and ones it picked up before but never
 * reported (it may have crashed mid-way; its own records keep it from adding twice).
 * Listing marks the new ones as delivered to it. Oldest tap first, at most 50.
 */
export async function takePendingActions(
    userId: string,
    deviceId: string,
): Promise<{ actions: DeviceAction[]; delivered: CalendarProposalDocument[] }> {
    const now = new Date();
    const fresh = byConfirmed(await getCollection().find({ userId, status: 'queued' }).toArray());
    const delivered: CalendarProposalDocument[] = [];
    for (const doc of fresh.slice(0, 50)) {
        const updated = await getCollection().findOneAndUpdate(
            { _id: doc._id, status: 'queued' },
            {
                $set: { status: 'delivered', deviceId, deliveredAt: now, updatedAt: now },
                $addToSet: { deliveredTo: deviceId },
            },
            { returnDocument: 'after' },
        );
        if (updated) delivered.push(updated);
    }
    const mine = byConfirmed(
        await getCollection().find({ userId, status: 'delivered', deviceId }).toArray(),
    ).slice(0, 50);
    return { actions: mine.map(toAction), delivered };
}

function byConfirmed(docs: CalendarProposalDocument[]): CalendarProposalDocument[] {
    const at = (doc: CalendarProposalDocument) => (doc.confirmedAt ?? doc.createdAt).getTime();
    return docs.sort((a, b) => at(a) - at(b));
}

/**
 * The device's report. Idempotent: a repeated report returns the stored result without
 * changing it, and a success always wins over a failure or expiry (the event exists),
 * even from a Mac it was taken back from. Only the Mac holding it can report a failure.
 * Null when the action was never this device's.
 */
export async function completeAction(
    userId: string,
    deviceId: string,
    id: string,
    result: DeviceActionResult,
): Promise<{ doc: CalendarProposalDocument; changed: boolean } | null> {
    const doc = await getCollection().findOne({ _id: id, userId });
    if (!doc || (doc.deviceId !== deviceId && !doc.deliveredTo?.includes(deviceId))) return null;
    // Added (and maybe undone since): a repeated success changes nothing.
    if (ADDED_ONCE.includes(doc.status)) return { doc, changed: false };
    const now = new Date();
    const update = result.ok
        ? {
              $set: {
                  status: 'added' as const,
                  deviceId,
                  completedAt: now,
                  updatedAt: now,
                  ...(result.eventIdentifier ? { eventIdentifier: result.eventIdentifier } : {}),
                  ...(result.itemId ? { itemId: result.itemId } : {}),
              },
              $unset: { error: '' as const },
          }
        : {
              $set: {
                  status: 'failed' as const,
                  error: result.error?.trim() || 'The Mac could not add the event.',
                  updatedAt: now,
              },
          };
    // A failure only replaces an action still in flight.
    const filter = result.ok
        ? { _id: id, status: { $nin: ADDED_ONCE } }
        : { _id: id, status: 'delivered' as const, deviceId };
    const updated = await getCollection().findOneAndUpdate(filter, update, {
        returnDocument: 'after',
    });
    if (updated) return { doc: updated, changed: true };
    return { doc: (await getCollection().findOne({ _id: id }))!, changed: false };
}

/** Statuses of a proposal whose event was added at some point. */
const ADDED_ONCE: StoredProposalStatus[] = ['added', 'removed', 'not_found'];

/**
 * The owner cancelled it before any Mac took it. Null when a Mac already has it (or it
 * isn't queued any more).
 */
export async function cancelQueued(id: string): Promise<CalendarProposalDocument | null> {
    return getCollection().findOneAndUpdate(
        { _id: id, status: 'queued' },
        { $set: { status: 'cancelled', updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
}

/** Undo found nothing on the Mac: it isn't on the calendar. Null unless it was `added`. */
export async function markNotFound(id: string): Promise<CalendarProposalDocument | null> {
    return getCollection().findOneAndUpdate(
        { _id: id, status: 'added' },
        { $set: { status: 'not_found', updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
}

/** An added event the Mac removed again (undo). Null unless it was `added`. */
export async function markRemoved(id: string): Promise<CalendarProposalDocument | null> {
    return getCollection().findOneAndUpdate(
        { _id: id, status: 'added' },
        { $set: { status: 'removed', updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
}

/** Open proposals past their date become `expired`. Returns the ones that changed. */
export async function expireStale(
    userId: string,
    onlyId?: string,
): Promise<CalendarProposalDocument[]> {
    const now = new Date();
    const stale = await getCollection()
        .find({
            userId,
            status: { $in: OPEN },
            expiresAt: { $lte: now },
            ...(onlyId ? { _id: onlyId } : {}),
        })
        .toArray();
    const expired: CalendarProposalDocument[] = [];
    for (const doc of stale) {
        const updated = await getCollection().findOneAndUpdate(
            { _id: doc._id, status: doc.status },
            { $set: { status: 'expired', updatedAt: now } },
            { returnDocument: 'after' },
        );
        if (updated) expired.push(updated);
    }
    return expired;
}

function toAction(doc: CalendarProposalDocument): DeviceAction {
    return {
        id: doc._id,
        type: 'create_event',
        source: 'calendar',
        event: doc.event,
        createdAt: (doc.confirmedAt ?? doc.createdAt).toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
    };
}
