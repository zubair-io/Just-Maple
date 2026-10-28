import { getDb } from '../db/client';

/**
 * Daily web-search counts, one document per bot owner (`_id` is the owner's user id).
 * The document is reused each day: a new day resets the count instead of adding a row.
 */

const COLLECTION = 'web_search_usage';

interface WebSearchUsageDoc {
    _id: string;
    /** UTC day the count belongs to, YYYY-MM-DD. */
    day: string;
    count: number;
    updatedAt: Date;
}

export function utcDay(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** Counts one search for the owner today and returns today's total, including this one. */
export async function incrementWebSearchUsage(ownerId: string, now = new Date()): Promise<number> {
    const collection = getDb().collection<WebSearchUsageDoc>(COLLECTION);
    const day = utcDay(now);
    const sameDay = await collection.findOneAndUpdate(
        { _id: ownerId, day },
        { $inc: { count: 1 }, $set: { updatedAt: now } },
        { returnDocument: 'after' },
    );
    if (sameDay) return sameDay.count;
    // First search today (or ever): start the count again.
    const fresh = await collection.findOneAndUpdate(
        { _id: ownerId },
        { $set: { day, count: 1, updatedAt: now } },
        { upsert: true, returnDocument: 'after' },
    );
    return fresh?.count ?? 1;
}
