import type { Collection } from 'mongodb';
import { getDb } from '../db/client';
import {
    DEVICE_DATA_RETENTION_DAYS,
    type DeviceItemVectors,
    type MacDataItem,
    type MacDataSource,
} from '@maple/shared';

// Personal data uploaded by the user's devices (messages, mail, events, contacts, visits,
// health). One document per item, keyed by user and the device's own item id, so uploads
// are idempotent. Vectors come from the device's on-device model and are stored as-is.

export interface DeviceItemDocument {
    _id: string; // `${userId}:${item.id}`
    userId: string;
    deviceId: string;
    id: string;
    source: MacDataSource;
    revision: string;
    occurredAt: number;
    endAt?: number;
    item: MacDataItem;
    /** Lowercased title, sender, participants and body, for keyword matching. */
    searchText: string;
    vectors?: string;
    dimensions?: number;
    /** The revision the vectors were made from; stale vectors are ignored. */
    embeddedRevision?: string;
    updatedAt: Date;
}

export interface DeviceItemQuery {
    sources?: MacDataSource[];
    from?: number;
    to?: number;
    search?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
}

const MAX_BODY_CHARS = 20_000;

function getCollection(): Collection<DeviceItemDocument> {
    return getDb().collection<DeviceItemDocument>('device_items');
}

const docId = (userId: string, id: string) => `${userId}:${id}`;

export function searchTextFor(item: MacDataItem): string {
    return [item.title, item.sender, item.location, item.calendar, ...item.participants, item.body]
        .filter((part): part is string => !!part)
        .join('\n')
        .toLowerCase();
}

export async function upsertDeviceItems(
    userId: string,
    deviceId: string,
    items: MacDataItem[],
): Promise<number> {
    if (items.length === 0) return 0;
    const now = new Date();
    await getCollection().bulkWrite(
        items.map((raw) => {
            const item = { ...raw, body: raw.body.slice(0, MAX_BODY_CHARS) };
            return {
                updateOne: {
                    filter: { _id: docId(userId, item.id) },
                    update: {
                        $set: {
                            userId,
                            deviceId,
                            id: item.id,
                            source: item.source,
                            revision: item.revision,
                            occurredAt: item.occurredAt,
                            endAt: item.endAt,
                            item,
                            searchText: searchTextFor(item),
                            updatedAt: now,
                        },
                    },
                    upsert: true,
                },
            };
        }),
        { ordered: false },
    );
    return items.length;
}

/** Current revisions of the given items, to tell new and changed items from repeats. */
export async function findDeviceItemRevisions(
    userId: string,
    ids: string[],
): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const docs = await getCollection()
        .find(
            { _id: { $in: ids.map((id) => docId(userId, id)) } },
            { projection: { id: 1, revision: 1 } },
        )
        .toArray();
    return new Map(docs.map((doc) => [doc.id, doc.revision]));
}

/** Stores vectors for items whose revision still matches; returns how many were stored. */
export async function setDeviceItemVectors(
    userId: string,
    vectors: DeviceItemVectors[],
): Promise<number> {
    let stored = 0;
    for (const entry of vectors) {
        const result = await getCollection().updateOne(
            { _id: docId(userId, entry.id), revision: entry.revision },
            {
                $set: {
                    vectors: entry.vectors,
                    dimensions: entry.dimensions,
                    embeddedRevision: entry.revision,
                },
            },
        );
        stored += result.matchedCount;
    }
    return stored;
}

export async function removeDeviceItems(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await getCollection().deleteMany({
        _id: { $in: ids.map((id) => docId(userId, id)) },
    });
    return result.deletedCount;
}

/** Items for a page or a bot listing, newest first by default. Sorting is done in code (Cosmos DB). */
export async function findDeviceItems(
    userId: string,
    query: DeviceItemQuery,
): Promise<{ items: MacDataItem[]; total: number }> {
    const filter: Record<string, unknown> = { userId };
    if (query.sources?.length) filter.source = { $in: query.sources };
    if (query.from !== undefined || query.to !== undefined) {
        filter.occurredAt = {
            ...(query.from !== undefined ? { $gte: query.from } : {}),
            ...(query.to !== undefined ? { $lte: query.to } : {}),
        };
    }
    const docs = await getCollection()
        .find(filter, { projection: { item: 1, occurredAt: 1, searchText: 1 } })
        .toArray();
    const words = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const matching = words.length
        ? docs.filter((doc) => words.every((word) => doc.searchText.includes(word)))
        : docs;
    const direction = query.order === 'asc' ? 1 : -1;
    matching.sort((a, b) => (a.occurredAt - b.occurredAt) * direction);
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
    return {
        items: matching.slice(offset, offset + limit).map((doc) => doc.item),
        total: matching.length,
    };
}

export async function findDeviceItem(userId: string, id: string): Promise<MacDataItem | null> {
    const doc = await getCollection().findOne({ _id: docId(userId, id) });
    return doc?.item ?? null;
}

/** Everything the search index needs for one user, vectors included. */
export async function findDeviceItemsForIndex(userId: string): Promise<DeviceItemDocument[]> {
    return getCollection().find({ userId }).toArray();
}

export async function countDeviceItems(
    userId: string,
    deviceId?: string,
): Promise<Record<string, number>> {
    const docs = await getCollection()
        .find({ userId, ...(deviceId ? { deviceId } : {}) }, { projection: { source: 1 } })
        .toArray();
    const counts: Record<string, number> = {};
    for (const doc of docs) counts[doc.source] = (counts[doc.source] ?? 0) + 1;
    return counts;
}

/** Removes a user's items: everything, one device's, or one source's. */
export async function deleteDeviceItems(
    userId: string,
    scope: { deviceId?: string; source?: MacDataSource } = {},
): Promise<number> {
    const result = await getCollection().deleteMany({
        userId,
        ...(scope.deviceId ? { deviceId: scope.deviceId } : {}),
        ...(scope.source ? { source: scope.source } : {}),
    });
    return result.deletedCount;
}

/**
 * Drops items older than the retention window. Contacts are kept; calendar events are
 * kept until they end. Returns the user ids that lost items, so their indexes refresh.
 */
export async function purgeExpiredDeviceItems(now = Date.now()): Promise<string[]> {
    const cutoff = now / 1000 - DEVICE_DATA_RETENTION_DAYS * 24 * 60 * 60;
    const expired = await getCollection()
        .find(
            {
                source: { $nin: ['contacts'] },
                occurredAt: { $lt: cutoff },
            },
            { projection: { _id: 1, userId: 1, source: 1, endAt: 1 } },
        )
        .toArray();
    // Calendar events that started before the cutoff but haven't ended yet stay.
    const doomed = expired.filter((doc) => doc.source !== 'calendar' || (doc.endAt ?? 0) < cutoff);
    if (doomed.length === 0) return [];
    await getCollection().deleteMany({ _id: { $in: doomed.map((doc) => doc._id) } });
    return [...new Set(doomed.map((doc) => doc.userId))];
}
