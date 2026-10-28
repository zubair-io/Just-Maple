import { getDb } from '../db/client';
import type {
    FollowUpCloseReason,
    FollowUpDirection,
    FollowUpStatus,
    MacDataSource,
} from '@maple/shared';

// Follow-ups, stored per person: each one belongs to the person whose messages or mail
// it was found in. Notebooks don't own them; a notebook shows one only while its data
// pages share the evidence (checked on read in follow-up.service).

export interface FollowUpEvidenceDocument {
    itemId: string;
    source: MacDataSource;
    at: number;
    title?: string;
}

export interface FollowUpDocument {
    /** `${userId}|${direction}|${itemId}`: one per message and direction, found once. */
    _id: string;
    userId: string;
    direction: FollowUpDirection;
    who: string;
    what: string;
    at: number;
    dueAt?: number;
    status: FollowUpStatus;
    snoozedUntil?: number;
    confidence: number;
    madeBy: 'rule' | 'model';
    evidence: FollowUpEvidenceDocument[];
    /** Where a reply would land: the message thread, or the mail subject and person. */
    threadKey: string;
    /** The other person's handle or address, lowercased. */
    counterpart?: string;
    /** Health, money, legal or relationship matters: never shown in shared notebooks. */
    sensitive: boolean;
    /** Reopened by hand: it doesn't close by itself again. */
    keepOpen?: boolean;
    closed?: { reason: FollowUpCloseReason; at: number; itemId?: string };
    /** The last change by a person or bot, and what it was before (for undo). */
    changedBy?: { type: 'user' | 'bot' | 'auto'; id?: string; at: Date };
    previous?: { status: FollowUpStatus; snoozedUntil?: number };
    createdAt: Date;
    updatedAt: Date;
}

export type NewFollowUp = Omit<FollowUpDocument, 'status' | 'createdAt' | 'updatedAt'>;

interface ScannedDocument {
    _id: string; // `${userId}|${itemId}`
    userId: string;
    revision: string;
    scannedAt: Date;
}

interface UsageDocument {
    _id: string; // `${userId}|${day}`
    day: string;
    calls: number;
}

interface StateDocument {
    _id: string; // userId
    leaseUntil?: Date;
    lastRunAt?: Date;
}

const followUps = () => getDb().collection<FollowUpDocument>('follow_ups');
const scanned = () => getDb().collection<ScannedDocument>('follow_up_scanned');
const usage = () => getDb().collection<UsageDocument>('follow_up_usage');
const states = () => getDb().collection<StateDocument>('follow_up_state');

export function followUpId(userId: string, direction: FollowUpDirection, itemId: string): string {
    return `${userId}|${direction}|${itemId}`;
}

/** Adds follow-ups not seen before. One already stored (even dismissed) is left alone. */
export async function insertFollowUps(docs: NewFollowUp[], now = new Date()): Promise<number> {
    if (docs.length === 0) return 0;
    const result = await followUps().bulkWrite(
        docs.map((doc) => ({
            updateOne: {
                filter: { _id: doc._id },
                update: {
                    $setOnInsert: { ...doc, status: 'open', createdAt: now, updatedAt: now },
                },
                upsert: true,
            },
        })),
        { ordered: false },
    );
    return result.upsertedCount;
}

export async function findFollowUpsByUser(
    userId: string,
    statuses: FollowUpStatus[],
    limit = 500,
): Promise<FollowUpDocument[]> {
    return followUps()
        .find({ userId, status: { $in: statuses } })
        .limit(limit)
        .toArray();
}

export async function findFollowUp(userId: string, id: string): Promise<FollowUpDocument | null> {
    return followUps().findOne({ _id: id, userId });
}

/** Ids already stored for these, whatever their status. */
export async function findExistingFollowUpIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const docs = await followUps()
        .find({ _id: { $in: ids } }, { projection: { _id: 1 } })
        .toArray();
    return new Set(docs.map((doc) => doc._id));
}

/** A change by a person or bot. Remembers the status before it, for undo. */
export async function setFollowUpStatus(
    current: FollowUpDocument,
    change: {
        status: FollowUpStatus;
        snoozedUntil?: number;
        keepOpen?: boolean;
        by: { type: 'user' | 'bot'; id?: string };
    },
    now = new Date(),
): Promise<FollowUpDocument | null> {
    const set: Record<string, unknown> = {
        status: change.status,
        updatedAt: now,
        changedBy: { ...change.by, at: now },
        previous: {
            status: current.status,
            ...(current.snoozedUntil !== undefined ? { snoozedUntil: current.snoozedUntil } : {}),
        },
    };
    const unset: Record<string, ''> = {};
    if (change.snoozedUntil !== undefined) set.snoozedUntil = change.snoozedUntil;
    else unset.snoozedUntil = '';
    if (change.keepOpen) {
        set.keepOpen = true;
        unset.closed = '';
    }
    return followUps().findOneAndUpdate(
        { _id: current._id, userId: current.userId },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { returnDocument: 'after' },
    );
}

/** Closes an open or snoozed follow-up by itself, with the evidence that closed it. */
export async function autoCloseFollowUp(
    id: string,
    closed: { reason: FollowUpCloseReason; at: number; itemId?: string },
    now = new Date(),
): Promise<boolean> {
    const result = await followUps().updateOne(
        { _id: id, status: { $in: ['open', 'snoozed'] }, keepOpen: { $ne: true } },
        {
            $set: { status: 'done', closed, updatedAt: now, changedBy: { type: 'auto', at: now } },
            $unset: { snoozedUntil: '' },
        },
    );
    return result.modifiedCount > 0;
}

// MARK: - Items the model has read

export async function findScannedItems(
    userId: string,
    items: Array<{ id: string; revision: string }>,
): Promise<Set<string>> {
    if (items.length === 0) return new Set();
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i += 500) {
        const batch = items.slice(i, i + 500);
        const docs = await scanned()
            .find({ _id: { $in: batch.map((item) => `${userId}|${item.id}`) } })
            .toArray();
        const revisions = new Map(docs.map((doc) => [doc._id, doc.revision]));
        for (const item of batch)
            if (revisions.get(`${userId}|${item.id}`) === item.revision) seen.add(item.id);
    }
    return seen;
}

export async function markItemsScanned(
    userId: string,
    items: Array<{ id: string; revision: string }>,
    now = new Date(),
): Promise<void> {
    if (items.length === 0) return;
    await scanned().bulkWrite(
        items.map((item) => ({
            updateOne: {
                filter: { _id: `${userId}|${item.id}` },
                update: { $set: { userId, revision: item.revision, scannedAt: now } },
                upsert: true,
            },
        })),
        { ordered: false },
    );
}

export async function pruneScannedItems(before: Date): Promise<void> {
    await scanned().deleteMany({ scannedAt: { $lt: before } });
}

// MARK: - Model budget

/** Counts one model call against the person's daily cap. False at the cap. */
export async function reserveFollowUpCall(
    userId: string,
    day: string,
    cap: number,
): Promise<boolean> {
    try {
        const result = await usage().updateOne(
            { _id: `${userId}|${day}`, calls: { $lt: cap } },
            { $inc: { calls: 1 }, $set: { day } },
            { upsert: true },
        );
        return result.matchedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        // At the cap the filter misses and the upsert hits the existing day.
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
    }
}

export async function releaseFollowUpCall(userId: string, day: string): Promise<void> {
    await usage().updateOne(
        { _id: `${userId}|${day}`, calls: { $gt: 0 } },
        { $inc: { calls: -1 } },
    );
}

export async function pruneFollowUpUsage(beforeDay: string): Promise<void> {
    await usage().deleteMany({ day: { $lt: beforeDay } });
}

// MARK: - Passes

/** Takes the person's pass for `leaseMs`. False while another pass holds it. */
export async function claimFollowUpPass(
    userId: string,
    now: Date,
    leaseMs: number,
): Promise<boolean> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    try {
        const result = await states().updateOne(
            {
                _id: userId,
                $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
            },
            { $set: { leaseUntil } },
            { upsert: true },
        );
        return result.matchedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
    }
}

export async function finishFollowUpPass(userId: string, now: Date): Promise<void> {
    await states().updateOne(
        { _id: userId },
        { $set: { lastRunAt: now }, $unset: { leaseUntil: '' } },
    );
}

export async function releaseFollowUpPass(userId: string): Promise<void> {
    await states().updateOne({ _id: userId }, { $unset: { leaseUntil: '' } });
}

export async function findFollowUpState(userId: string): Promise<StateDocument | null> {
    return states().findOne({ _id: userId });
}
