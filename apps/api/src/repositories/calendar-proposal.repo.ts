import type { Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type { CalendarEventDraft, DeviceAction, DeviceActionResult } from '@maple/shared';

// "Add to calendar" proposals, and the queued `create_event` action each becomes once its
// owner taps Add. One document per proposal; its id is also the action id the Mac sees.
//
// proposed ──tap──▶ queued ──Mac lists it──▶ delivered ──Mac reports──▶ added | failed
//    │                 │                          │
//    └─────────────────┴──── 7 days ──────────────┴──▶ expired
//
// failed ──tap again──▶ queued

export type StoredProposalStatus =
    | 'proposed'
    | 'queued'
    | 'delivered'
    | 'added'
    | 'failed'
    | 'expired';

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
    /** The Mac that picked the action up; only it gets it again until it reports. */
    deviceId?: string;
    eventIdentifier?: string;
    itemId?: string;
    error?: string;
    createdAt: Date;
    confirmedAt?: Date;
    deliveredAt?: Date;
    completedAt?: Date;
    /** 7 days from proposing, then 7 days from each tap. */
    expiresAt: Date;
    updatedAt: Date;
}

export const PROPOSAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const OPEN: StoredProposalStatus[] = ['proposed', 'queued', 'delivered'];

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
 * An open proposal for the same event in this notebook, so a bot that sees the same email
 * twice offers it once.
 */
export async function findOpenDuplicate(
    userId: string,
    notebookId: string,
    event: Pick<CalendarEventDraft, 'title' | 'start'>,
): Promise<CalendarProposalDocument | null> {
    await expireStale(userId);
    const docs = await getCollection()
        .find({ userId, notebookId, 'event.start': event.start, status: { $in: OPEN } })
        .toArray();
    const title = event.title.trim().toLowerCase();
    return docs.find((doc) => doc.event.title.trim().toLowerCase() === title) ?? null;
}

export async function findProposal(id: string): Promise<CalendarProposalDocument | null> {
    const doc = await getCollection().findOne({ _id: id });
    if (doc && OPEN.includes(doc.status) && doc.expiresAt.getTime() <= Date.now()) {
        await expireStale(doc.userId);
        return getCollection().findOne({ _id: id });
    }
    return doc;
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
 * The owner's tap: queue the action. Only from `proposed` or `failed`, so a second tap
 * (or a double click) never queues it twice. Null when it can't be confirmed now.
 */
export async function queueProposal(
    id: string,
    userId: string,
): Promise<CalendarProposalDocument | null> {
    await expireStale(userId);
    const now = new Date();
    return getCollection().findOneAndUpdate(
        { _id: id, userId, status: { $in: ['proposed', 'failed'] } },
        {
            $set: {
                status: 'queued',
                confirmedAt: now,
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
 * Actions for this device: newly queued ones, and ones it picked up before but never
 * reported (it may have crashed mid-way; its own records keep it from adding twice).
 * Listing marks the new ones as delivered to it.
 */
export async function takePendingActions(
    userId: string,
    deviceId: string,
): Promise<{ actions: DeviceAction[]; delivered: CalendarProposalDocument[] }> {
    await expireStale(userId);
    const now = new Date();
    const fresh = await getCollection()
        .find({ userId, status: 'queued' })
        .sort({ confirmedAt: 1 })
        .limit(50)
        .toArray();
    const delivered: CalendarProposalDocument[] = [];
    for (const doc of fresh) {
        const updated = await getCollection().findOneAndUpdate(
            { _id: doc._id, status: 'queued' },
            { $set: { status: 'delivered', deviceId, deliveredAt: now, updatedAt: now } },
            { returnDocument: 'after' },
        );
        if (updated) delivered.push(updated);
    }
    const mine = await getCollection()
        .find({ userId, status: 'delivered', deviceId })
        .sort({ confirmedAt: 1 })
        .limit(50)
        .toArray();
    return { actions: mine.map(toAction), delivered };
}

/**
 * The device's report. Idempotent: a repeated report returns the stored result without
 * changing it, and a success always wins over a failure or expiry (the event exists).
 * Null when the action isn't this device's.
 */
export async function completeAction(
    userId: string,
    deviceId: string,
    id: string,
    result: DeviceActionResult,
): Promise<{ doc: CalendarProposalDocument; changed: boolean } | null> {
    const doc = await getCollection().findOne({ _id: id, userId });
    if (!doc || doc.deviceId !== deviceId) return null;
    if (doc.status === 'added') return { doc, changed: false };
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
        ? { _id: id, status: { $ne: 'added' as const } }
        : { _id: id, status: 'delivered' as const, deviceId };
    const updated = await getCollection().findOneAndUpdate(filter, update, {
        returnDocument: 'after',
    });
    if (updated) return { doc: updated, changed: true };
    return { doc: (await getCollection().findOne({ _id: id }))!, changed: false };
}

/** Open proposals past their date become `expired`. Returns the ones that changed. */
export async function expireStale(userId: string): Promise<CalendarProposalDocument[]> {
    const now = new Date();
    const stale = await getCollection()
        .find({ userId, status: { $in: OPEN }, expiresAt: { $lte: now } })
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
