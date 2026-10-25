import type { Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Collector, MacDataSource, RegisterCollectorInput } from '@maple/shared';

// Devices that upload personal data. Each source has at most one active collector per
// user, so the same calendar read on both a Mac and an iPhone isn't stored twice.

interface CollectorDocument {
    _id: string; // `${userId}:${deviceId}`
    userId: string;
    deviceId: string;
    platform: Collector['platform'];
    name: string;
    sources: MacDataSource[];
    activeSources: MacDataSource[];
    timeZone?: string;
    lastSeenAt: Date;
    lastUploadAt?: Date;
}

function getCollection(): Collection<CollectorDocument> {
    return getDb().collection<CollectorDocument>('collectors');
}

const docId = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

function toCollector(doc: CollectorDocument): Collector {
    return {
        deviceId: doc.deviceId,
        platform: doc.platform,
        name: doc.name,
        sources: doc.sources,
        activeSources: doc.activeSources,
        timeZone: doc.timeZone,
        lastSeenAt: doc.lastSeenAt.toISOString(),
        lastUploadAt: doc.lastUploadAt?.toISOString(),
    };
}

export async function listCollectors(userId: string): Promise<Collector[]> {
    const docs = await getCollection().find({ userId }).toArray();
    return docs.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).map(toCollector);
}

export async function findCollector(userId: string, deviceId: string): Promise<Collector | null> {
    const doc = await getCollection().findOne({ _id: docId(userId, deviceId) });
    return doc ? toCollector(doc) : null;
}

/**
 * Records a device and what it can collect. It becomes the active collector for every
 * source no other device already collects; sources it can no longer read are dropped.
 */
export async function registerCollector(
    userId: string,
    input: RegisterCollectorInput,
): Promise<Collector> {
    const others = (await getCollection().find({ userId }).toArray()).filter(
        (doc) => doc.deviceId !== input.deviceId,
    );
    const takenElsewhere = new Set(others.flatMap((doc) => doc.activeSources));
    const existing = await getCollection().findOne({ _id: docId(userId, input.deviceId) });
    const sources = [...new Set(input.sources)];
    const activeSources = sources.filter(
        (source) => existing?.activeSources.includes(source) || !takenElsewhere.has(source),
    );
    await getCollection().updateOne(
        { _id: docId(userId, input.deviceId) },
        {
            $set: {
                userId,
                deviceId: input.deviceId,
                platform: input.platform,
                name: input.name,
                sources,
                activeSources,
                ...(input.timeZone ? { timeZone: input.timeZone } : {}),
                lastSeenAt: new Date(),
            },
        },
        { upsert: true },
    );
    return (await findCollector(userId, input.deviceId))!;
}

/**
 * Makes this device the collector for `sources`, taking them over from other devices.
 * Returns the sources that moved here from elsewhere (their old items should go).
 */
export async function setActiveSources(
    userId: string,
    deviceId: string,
    sources: MacDataSource[],
): Promise<{
    collector: Collector | null;
    movedFrom: Array<{ deviceId: string; source: MacDataSource }>;
}> {
    const doc = await getCollection().findOne({ _id: docId(userId, deviceId) });
    if (!doc) return { collector: null, movedFrom: [] };
    const wanted = [...new Set(sources)].filter((source) => doc.sources.includes(source));
    const movedFrom: Array<{ deviceId: string; source: MacDataSource }> = [];
    for (const other of await getCollection().find({ userId }).toArray()) {
        if (other.deviceId === deviceId) continue;
        const taken = other.activeSources.filter((source) => wanted.includes(source));
        if (taken.length === 0) continue;
        movedFrom.push(...taken.map((source) => ({ deviceId: other.deviceId, source })));
        await getCollection().updateOne(
            { _id: other._id },
            { $set: { activeSources: other.activeSources.filter((s) => !wanted.includes(s)) } },
        );
    }
    await getCollection().updateOne({ _id: doc._id }, { $set: { activeSources: wanted } });
    return { collector: await findCollector(userId, deviceId), movedFrom };
}

export async function touchCollector(
    userId: string,
    deviceId: string,
    uploaded: boolean,
): Promise<void> {
    const now = new Date();
    await getCollection().updateOne(
        { _id: docId(userId, deviceId) },
        { $set: { lastSeenAt: now, ...(uploaded ? { lastUploadAt: now } : {}) } },
    );
}

export async function deleteCollector(userId: string, deviceId: string): Promise<boolean> {
    const result = await getCollection().deleteOne({ _id: docId(userId, deviceId) });
    return result.deletedCount > 0;
}

/** The user's time zone, from the device seen most recently. */
export async function collectorTimeZone(userId: string): Promise<string | undefined> {
    return (await listCollectors(userId)).find((c) => c.timeZone)?.timeZone;
}
