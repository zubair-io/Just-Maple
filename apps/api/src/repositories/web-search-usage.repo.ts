import { getDb } from '../db/client';

/**
 * Daily web-search counts: one document per bot owner per UTC day, `_id` "owner:day".
 * Each search is a single atomic upsert-and-increment, so concurrent searches can't
 * lose a count.
 */

const COLLECTION = 'web_search_usage';
const MAX_ATTEMPTS = 3;

interface WebSearchUsageDoc {
    _id: string;
    ownerId: string;
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
    for (let attempt = 1; ; attempt++) {
        try {
            const doc = await collection.findOneAndUpdate(
                { _id: `${ownerId}:${day}` },
                {
                    $inc: { count: 1 },
                    $set: { updatedAt: now },
                    $setOnInsert: { ownerId, day },
                },
                { upsert: true, returnDocument: 'after' },
            );
            return doc?.count ?? 1;
        } catch (error) {
            // Two first-of-the-day upserts can race; the loser retries and increments.
            const duplicate = (error as { code?: number }).code === 11000;
            if (!duplicate || attempt >= MAX_ATTEMPTS) throw error;
        }
    }
}
