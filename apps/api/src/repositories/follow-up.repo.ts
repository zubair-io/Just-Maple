import { getDb } from '../db/client';
import type {
    FollowUpCloseReason,
    FollowUpDirection,
    FollowUpStatus,
    MacDataSource,
} from '@maple/shared';

// Follow-ups, stored per person: each one belongs to the person whose messages or mail
// it was found in. Notebooks don't own them; a notebook shows one only while its data
// pages share the evidence (checked on read in follow-up.service). Queries never sort
// in the database (Cosmos needs an index for every sort): results are sorted in code.

export interface FollowUpEvidenceDocument {
    itemId: string;
    source: MacDataSource;
    at: number;
    title?: string;
}

export interface FollowUpChange {
    type: 'user' | 'bot' | 'auto';
    id?: string;
    /** A bot's name. */
    name?: string;
    at: Date;
}

export interface FollowUpDocument {
    /** `${userId}|${direction}|${messageKey}`: one per message and direction, found once. */
    _id: string;
    userId: string;
    direction: FollowUpDirection;
    who: string;
    what: string;
    at: number;
    dueAt?: number;
    /** Unanswered questions show only once they've waited long enough (seconds). */
    showAfter?: number;
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
    /** When it was last reopened (seconds): expiry counts from then too. */
    reopenedAt?: number;
    /** Replaced by a newer question in the same thread: never shown as closed. */
    superseded?: boolean;
    closed?: { reason: FollowUpCloseReason; at: number; itemId?: string };
    /** The last change by a person, bot or the pass, and what it was before (for undo). */
    changedBy?: FollowUpChange;
    previous?: { status: FollowUpStatus; snoozedUntil?: number };
    createdAt: Date;
    updatedAt: Date;
}

export type NewFollowUp = Omit<FollowUpDocument, 'status' | 'createdAt' | 'updatedAt'>;

interface ScannedDocument {
    _id: string; // `${userId}|${messageKey}`
    userId: string;
    revision: string;
    /** The model read it. */
    done?: boolean;
    /** Calls about it that failed; at two it's set aside so newer items get their turn. */
    failures?: number;
    scannedAt: Date;
}

interface UsageDocument {
    _id: string; // `${userId}|${day}`
    day: string;
    calls: number;
}

export interface FollowUpStateDocument {
    _id: string; // userId
    leaseUntil?: Date;
    /** When the last finished pass started: the next one reads items updated since. */
    lastRunAt?: Date;
    /**
     * The next pass reads items changed since this. It only moves on once nothing waits
     * for the model, so items left by the daily cap are read again next time.
     */
    cursor?: Date;
    /** What the person's Follow-ups notebooks shared at the last pass (pages and filters). */
    signature?: string;
}

/** A batch failing this often is set aside. */
export const MAX_SCAN_FAILURES = 2;

const followUps = () => getDb().collection<FollowUpDocument>('follow_ups');
const scanned = () => getDb().collection<ScannedDocument>('follow_up_scanned');
const usage = () => getDb().collection<UsageDocument>('follow_up_usage');
const states = () => getDb().collection<FollowUpStateDocument>('follow_up_state');

export function followUpId(
    userId: string,
    direction: FollowUpDirection,
    messageKey: string,
): string {
    return `${userId}|${direction}|${messageKey}`;
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

/**
 * The person's follow-ups with these statuses (changed since `updatedSince`, if given),
 * newest first, at most `limit`. Sorted in code.
 */
export async function findFollowUpsByUser(
    userId: string,
    statuses: FollowUpStatus[],
    options: { limit?: number; updatedSince?: Date } = {},
): Promise<FollowUpDocument[]> {
    const docs = await followUps()
        .find({
            userId,
            status: { $in: statuses },
            ...(options.updatedSince ? { updatedAt: { $gte: options.updatedSince } } : {}),
        })
        .limit(5_000)
        .toArray();
    return docs.sort((a, b) => b.at - a.at).slice(0, options.limit ?? 500);
}

export async function findFollowUp(userId: string, id: string): Promise<FollowUpDocument | null> {
    return followUps().findOne({ _id: id, userId });
}

/** A change by a person or bot. Remembers the status before it, for undo. */
export async function setFollowUpStatus(
    current: FollowUpDocument,
    change: {
        status: FollowUpStatus;
        snoozedUntil?: number;
        reopen?: boolean;
        by: Omit<FollowUpChange, 'at'>;
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
    if (change.reopen) {
        // Back by hand: it doesn't close by itself again, and expiry starts over.
        set.keepOpen = true;
        set.reopenedAt = Math.floor(now.getTime() / 1000);
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

/**
 * Open too long, or replaced by a newer question: expired by the pass. A superseded one
 * was never the latest, so it isn't listed as closed.
 */
export async function expireFollowUps(
    ids: string[],
    now = new Date(),
    options: { superseded?: boolean } = {},
): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await followUps().updateMany(
        { _id: { $in: ids }, status: { $in: ['open', 'snoozed'] } },
        {
            $set: {
                status: 'expired',
                updatedAt: now,
                changedBy: { type: 'auto', at: now },
                ...(options.superseded ? { superseded: true } : {}),
            },
            $unset: { snoozedUntil: '' },
        },
    );
    return result.modifiedCount;
}

// MARK: - Items the model has read

/**
 * Which of these the model doesn't need to see again: read at this revision, or set
 * aside after failing twice.
 */
export async function findScannedItems(
    userId: string,
    items: Array<{ key: string; revision: string }>,
): Promise<Set<string>> {
    if (items.length === 0) return new Set();
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i += 500) {
        const batch = items.slice(i, i + 500);
        const docs = await scanned()
            .find({ _id: { $in: batch.map((item) => `${userId}|${item.key}`) } })
            .toArray();
        const byId = new Map(docs.map((doc) => [doc._id, doc]));
        for (const item of batch) {
            const doc = byId.get(`${userId}|${item.key}`);
            if (!doc || doc.revision !== item.revision) continue;
            if (doc.done || (doc.failures ?? 0) >= MAX_SCAN_FAILURES) seen.add(item.key);
        }
    }
    return seen;
}

export async function markItemsScanned(
    userId: string,
    items: Array<{ key: string; revision: string }>,
    now = new Date(),
): Promise<void> {
    if (items.length === 0) return;
    await scanned().bulkWrite(
        items.map((item) => ({
            updateOne: {
                filter: { _id: `${userId}|${item.key}` },
                update: {
                    $set: { userId, revision: item.revision, done: true, scannedAt: now },
                    $unset: { failures: '' },
                },
                upsert: true,
            },
        })),
        { ordered: false },
    );
}

/** A call about these failed: one more strike each (a new revision starts over). */
export async function markItemsFailed(
    userId: string,
    items: Array<{ key: string; revision: string }>,
    now = new Date(),
): Promise<void> {
    if (items.length === 0) return;
    const existing = new Map(
        (
            await scanned()
                .find({ _id: { $in: items.map((item) => `${userId}|${item.key}`) } })
                .toArray()
        ).map((doc) => [doc._id, doc]),
    );
    await scanned().bulkWrite(
        items.map((item) => {
            const doc = existing.get(`${userId}|${item.key}`);
            const failures = doc?.revision === item.revision ? (doc.failures ?? 0) + 1 : 1;
            return {
                updateOne: {
                    filter: { _id: `${userId}|${item.key}` },
                    update: {
                        $set: { userId, revision: item.revision, failures, scannedAt: now },
                        $unset: { done: '' },
                    },
                    upsert: true,
                },
            };
        }),
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

export async function finishFollowUpPass(
    userId: string,
    startedAt: Date,
    signature: string,
    cursor: Date | undefined,
): Promise<void> {
    await states().updateOne(
        { _id: userId },
        {
            $set: { lastRunAt: startedAt, signature, ...(cursor ? { cursor } : {}) },
            $unset: { leaseUntil: '', ...(cursor ? {} : { cursor: '' }) },
        },
    );
}

export async function releaseFollowUpPass(userId: string): Promise<void> {
    await states().updateOne({ _id: userId }, { $unset: { leaseUntil: '' } });
}

export async function findFollowUpState(userId: string): Promise<FollowUpStateDocument | null> {
    return states().findOne({ _id: userId });
}
