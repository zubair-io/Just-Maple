import type { Collection } from 'mongodb';
import { getDb } from '../db/client';

// Which Home Assistant entities the user exposed to assistants, as their Mac last read
// it. One document per user. Home items of entities not in the list are kept but never
// shown or given to bots; with no list at all, nothing is.

interface HomeExposureDocument {
    _id: string; // userId
    deviceId: string;
    entityIds: string[];
    updatedAt: Date;
}

function getCollection(): Collection<HomeExposureDocument> {
    return getDb().collection<HomeExposureDocument>('home_exposure');
}

export async function saveHomeExposure(
    userId: string,
    deviceId: string,
    entityIds: string[],
): Promise<number> {
    const unique = [...new Set(entityIds)].sort();
    await getCollection().updateOne(
        { _id: userId },
        { $set: { deviceId, entityIds: unique, updatedAt: new Date() } },
        { upsert: true },
    );
    return unique.length;
}

/** The exposed entity ids; empty when the Mac never sent a list. */
export async function findHomeExposure(userId: string): Promise<Set<string>> {
    const doc = await getCollection().findOne({ _id: userId });
    return new Set(doc?.entityIds ?? []);
}

export async function deleteHomeExposure(userId: string): Promise<void> {
    await getCollection().deleteOne({ _id: userId });
}
