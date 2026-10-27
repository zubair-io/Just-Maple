import type { Collection } from 'mongodb';
import { getDb } from '../db/client';

// Calendar overlaps a chat's proactive bot already told the user about, so each pair is
// flagged once until one of its events moves (its signature changes). Several API
// instances can race on the same pair; only one claim wins.

interface OverlapFlagDocument {
    _id: string; // `${scope}:${pairKey}`
    scope: string; // The chat page the flag was posted in
    eventIds: [string, string];
    signature: string; // Both events' ids and times
    flaggedAt: Date;
}

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

function getCollection(): Collection<OverlapFlagDocument> {
    return getDb().collection<OverlapFlagDocument>('calendar_overlap_flags');
}

/**
 * Claims flagging this pair in `scope`. True when it wasn't flagged yet, or was flagged
 * with other times; false when this exact overlap was already flagged.
 */
export async function claimOverlapFlag(
    scope: string,
    pairKey: string,
    eventIds: [string, string],
    signature: string,
    now = new Date(),
): Promise<boolean> {
    const _id = `${scope}:${pairKey}`;
    try {
        await getCollection().insertOne({ _id, scope, eventIds, signature, flaggedAt: now });
        return true;
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    const moved = await getCollection().updateOne(
        { _id, signature: { $ne: signature } },
        { $set: { signature, flaggedAt: now } },
    );
    return moved.modifiedCount === 1;
}

/** Flags in `scope` that involve any of these events. */
export async function findOverlapFlags(
    scope: string,
    eventIds: string[],
): Promise<{ pairKey: string; eventIds: [string, string]; signature: string }[]> {
    if (eventIds.length === 0) return [];
    const docs = await getCollection()
        .find({ scope, eventIds: { $in: eventIds } })
        .toArray();
    return docs.map((doc) => ({
        pairKey: doc._id.slice(scope.length + 1),
        eventIds: doc.eventIds,
        signature: doc.signature,
    }));
}

/**
 * Forgets a flag (the overlap cleared, or the message about it didn't go out). True for
 * the caller that removed it, so a cleared overlap is reported once.
 */
export async function releaseOverlapFlag(
    scope: string,
    pairKey: string,
    signature?: string,
): Promise<boolean> {
    const result = await getCollection().deleteOne({
        _id: `${scope}:${pairKey}`,
        ...(signature ? { signature } : {}),
    });
    return result.deletedCount === 1;
}

/** Forgets flags older than a month; their events have passed. */
export async function purgeOldOverlapFlags(now = new Date()): Promise<number> {
    const result = await getCollection().deleteMany({
        flaggedAt: { $lt: new Date(now.getTime() - KEEP_MS) },
    });
    return result.deletedCount;
}
