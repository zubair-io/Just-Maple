import type { Collection } from 'mongodb';
import { getDb } from '../db/client';

// Records of scheduled things (a day's brief, a leave-now reminder), so each goes out
// once even with several API instances ticking at the same time. A send that fails is
// retried a few times before giving up.

interface ScheduledSendDocument {
    _id: string; // e.g. `brief:<pageId>:2026-10-26`
    sentAt: Date;
    state: 'claimed' | 'failed';
    failures: number;
    retryAt?: Date;
}

const MAX_FAILURES = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function getCollection(): Collection<ScheduledSendDocument> {
    return getDb().collection<ScheduledSendDocument>('scheduled_sends');
}

/**
 * Claims a send. True for the first caller only, or for a retry of a send that failed
 * (at most three tries, five minutes apart); everyone else gets false.
 */
export async function claimScheduledSend(key: string, now = new Date()): Promise<boolean> {
    try {
        await getCollection().insertOne({ _id: key, sentAt: now, state: 'claimed', failures: 0 });
        return true;
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    const retry = await getCollection().updateOne(
        { _id: key, state: 'failed', failures: { $lt: MAX_FAILURES }, retryAt: { $lte: now } },
        { $set: { state: 'claimed', sentAt: now } },
    );
    return retry.modifiedCount === 1;
}

/** The claimed send didn't go out; let a later tick try again. */
export async function failScheduledSend(key: string, now = new Date()): Promise<void> {
    await getCollection().updateOne(
        { _id: key },
        {
            $set: { state: 'failed', retryAt: new Date(now.getTime() + RETRY_DELAY_MS) },
            $inc: { failures: 1 },
        },
    );
}

/** Forgets sends older than a week; their keys name a day or an event that has passed. */
export async function purgeOldScheduledSends(now = new Date()): Promise<number> {
    const result = await getCollection().deleteMany({
        sentAt: { $lt: new Date(now.getTime() - KEEP_MS) },
    });
    return result.deletedCount;
}
