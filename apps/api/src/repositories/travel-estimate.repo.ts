import type { Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { TravelEstimate } from '@maple/shared';

// Driving times to upcoming events, computed on the user's iPhone with Apple Maps.

interface TravelEstimateDocument extends TravelEstimate {
    _id: string; // `${userId}:${eventId}`
    userId: string;
    deviceId: string;
    savedAt: Date;
}

function getCollection(): Collection<TravelEstimateDocument> {
    return getDb().collection<TravelEstimateDocument>('travel_estimates');
}

export async function saveTravelEstimates(
    userId: string,
    deviceId: string,
    estimates: TravelEstimate[],
): Promise<number> {
    for (const estimate of estimates) {
        await getCollection().updateOne(
            { _id: `${userId}:${estimate.eventId}` },
            { $set: { ...estimate, userId, deviceId, savedAt: new Date() } },
            { upsert: true },
        );
    }
    return estimates.length;
}

/** Estimates for these events, by event id. */
export async function findTravelEstimates(
    userId: string,
    eventIds: string[],
): Promise<Map<string, TravelEstimate>> {
    if (eventIds.length === 0) return new Map();
    const docs = await getCollection()
        .find({ _id: { $in: eventIds.map((id) => `${userId}:${id}`) } })
        .toArray();
    return new Map(
        docs.map((doc) => [
            doc.eventId,
            {
                eventId: doc.eventId,
                minutes: doc.minutes,
                origin: doc.origin,
                computedAt: doc.computedAt,
            },
        ]),
    );
}

/** Removes estimates the phone hasn't refreshed in two days; their events have passed. */
export async function purgeOldTravelEstimates(now = new Date()): Promise<number> {
    const result = await getCollection().deleteMany({
        savedAt: { $lt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
    });
    return result.deletedCount;
}
