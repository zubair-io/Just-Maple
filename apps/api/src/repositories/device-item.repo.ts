import type { Collection } from 'mongodb';
import { getDb } from '../db/client';
import {
    DEVICE_DATA_RETENTION_DAYS,
    type DeviceDataChoice,
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
    /** Extra database conditions, e.g. a page's calendars (see device-data-access.service). */
    conditions?: Record<string, unknown>;
    /** Checked in code after the database query, for filters it can't express. */
    match?: (item: MacDataItem) => boolean;
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

/**
 * Removes items a device deleted. Only that device's own items for sources it still
 * collects: a device that hasn't heard yet that a source moved can't delete the new
 * collector's copy (calendar ids are shared across Macs).
 */
export async function removeDeviceItems(
    userId: string,
    ids: string[],
    scope: { deviceId: string; sources: MacDataSource[] },
): Promise<number> {
    if (ids.length === 0 || scope.sources.length === 0) return 0;
    const result = await getCollection().deleteMany({
        _id: { $in: ids.map((id) => docId(userId, id)) },
        deviceId: scope.deviceId,
        source: { $in: scope.sources },
    });
    return result.deletedCount;
}

/**
 * Items for a page or a bot listing, newest first by default. Without a search the
 * database sorts and pages; with one, only the small search text is scanned and just
 * the page's items are loaded.
 */
export async function findDeviceItems(
    userId: string,
    query: DeviceItemQuery,
): Promise<{ items: MacDataItem[]; total: number }> {
    const filter: Record<string, unknown> = { ...query.conditions, userId };
    if (query.sources?.length) filter.source = { $in: query.sources };
    if (query.from !== undefined || query.to !== undefined) {
        filter.occurredAt = {
            ...(query.from !== undefined ? { $gte: query.from } : {}),
            ...(query.to !== undefined ? { $lte: query.to } : {}),
        };
    }
    const direction = query.order === 'asc' ? 1 : -1;
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
    const words = (query.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);

    // Filters checked in code (calendars and chats by id or name, Places windows and
    // places): match on items without their bodies, then load just this page in full.
    if (query.match) {
        const rows = await getCollection()
            .find(filter, { projection: { _id: 1, item: 1, searchText: 1 } })
            .toArray();
        const matching = rows
            .filter((row) => words.every((word) => row.searchText.includes(word)))
            .filter((row) => query.match!({ ...row.item, body: '' }))
            .sort((a, b) => (a.item.occurredAt - b.item.occurredAt) * direction);
        const pageIds = matching.slice(offset, offset + limit).map((row) => row._id);
        const byId = new Map(rows.map((row) => [row._id, row.item]));
        return {
            items: pageIds.map((id) => byId.get(id)).filter((item): item is MacDataItem => !!item),
            total: matching.length,
        };
    }

    if (words.length === 0) {
        const [docs, total] = await Promise.all([
            getCollection()
                .find(filter, { projection: { item: 1 } })
                .sort({ occurredAt: direction })
                .skip(offset)
                .limit(limit)
                .toArray(),
            getCollection().countDocuments(filter),
        ]);
        return { items: docs.map((doc) => doc.item), total };
    }

    const rows = await getCollection()
        .find(filter, { projection: { _id: 1, occurredAt: 1, searchText: 1 } })
        .toArray();
    const matching = rows
        .filter((row) => words.every((word) => row.searchText.includes(word)))
        .sort((a, b) => (a.occurredAt - b.occurredAt) * direction);
    const pageIds = matching.slice(offset, offset + limit).map((row) => row._id);
    const docs = pageIds.length
        ? await getCollection()
              .find({ _id: { $in: pageIds } }, { projection: { item: 1 } })
              .toArray()
        : [];
    const byId = new Map(docs.map((doc) => [doc._id, doc.item]));
    return {
        items: pageIds.map((id) => byId.get(id)).filter((item): item is MacDataItem => !!item),
        total: matching.length,
    };
}

/**
 * The calendars, mailboxes and chats in a user's data, most recently used first, for
 * choosing what a page shares. Calendars and chats carry the device's id when it sent one.
 */
export async function findDeviceItemFacets(
    userId: string,
): Promise<{ calendars: DeviceDataChoice[]; mailboxes: string[]; chats: DeviceDataChoice[] }> {
    const rows = await getCollection()
        .find(
            { userId, source: { $in: ['calendar', 'mail', 'imessage'] } },
            {
                projection: {
                    source: 1,
                    occurredAt: 1,
                    'item.calendar': 1,
                    'item.mailbox': 1,
                    'item.thread': 1,
                    'item.extra.calendarId': 1,
                    'item.extra.chatId': 1,
                },
            },
        )
        .toArray();
    type Seen = { choice: DeviceDataChoice; at: number };
    const latest: Record<'calendar' | 'mail' | 'imessage', Map<string, Seen>> = {
        calendar: new Map(),
        mail: new Map(),
        imessage: new Map(),
    };
    for (const row of rows) {
        const seen = latest[row.source as keyof typeof latest];
        const item = row.item as Partial<MacDataItem> | undefined;
        const name =
            row.source === 'calendar'
                ? item?.calendar
                : row.source === 'mail'
                  ? item?.mailbox
                  : item?.thread;
        if (!name || !seen) continue;
        const rawId = row.source === 'calendar' ? item?.extra?.calendarId : item?.extra?.chatId;
        const id = typeof rawId === 'string' && rawId ? rawId : undefined;
        const key = id ? `id:${id}` : `name:${name}`;
        const previous = seen.get(key);
        // Keep the name from the most recent item (a chat that was renamed).
        if (!previous || row.occurredAt >= previous.at) {
            seen.set(key, { choice: id ? { id, name } : { name }, at: row.occurredAt });
        }
    }
    const ordered = (map: Map<string, Seen>, max: number) => {
        const values = [...map.values()];
        // An older item without an id is the same calendar or chat as one with it.
        const namesWithId = new Set(values.filter((v) => v.choice.id).map((v) => v.choice.name));
        return values
            .filter((v) => v.choice.id || !namesWithId.has(v.choice.name))
            .sort((a, b) => b.at - a.at)
            .slice(0, max)
            .map((v) => v.choice);
    };
    return {
        calendars: ordered(latest.calendar, 100),
        mailboxes: ordered(latest.mail, 100).map((choice) => choice.name),
        chats: ordered(latest.imessage, 200),
    };
}

/** The user's own contact card, if their Mac uploaded one. */
export async function findMyContactCard(userId: string): Promise<MacDataItem | null> {
    const doc = await getCollection().findOne({
        userId,
        source: 'contacts',
        'item.extra.isMe': true,
    });
    return doc?.item ?? null;
}

/** Contact cards with these names (exact, as stored). */
export async function findContactsByName(userId: string, names: string[]): Promise<MacDataItem[]> {
    if (names.length === 0) return [];
    const docs = await getCollection()
        .find(
            { userId, source: 'contacts', 'item.title': { $in: names } },
            { projection: { item: 1 } },
        )
        .toArray();
    return docs.map((doc) => doc.item);
}

export async function findDeviceItem(userId: string, id: string): Promise<MacDataItem | null> {
    const doc = await getCollection().findOne({ _id: docId(userId, id) });
    return doc?.item ?? null;
}

/** Everything the search index needs for one user, vectors included. */
/** Several items by id, in one query; missing ones are left out. */
export async function findDeviceItemsByIds(userId: string, ids: string[]): Promise<MacDataItem[]> {
    if (ids.length === 0) return [];
    const docs = await getCollection()
        .find({ _id: { $in: [...new Set(ids)].map((id) => docId(userId, id)) } })
        .project<{ item: MacDataItem }>({ item: 1 })
        .toArray();
    return docs.map((doc) => doc.item);
}

export async function findDeviceItemsForIndex(userId: string): Promise<DeviceItemDocument[]> {
    return getCollection().find({ userId }).toArray();
}

export async function countDeviceItems(
    userId: string,
    deviceId?: string,
): Promise<Record<string, number>> {
    const sources: MacDataSource[] = [
        'imessage',
        'mail',
        'calendar',
        'contacts',
        'location',
        'health',
    ];
    const counts = await Promise.all(
        sources.map((source) =>
            getCollection().countDocuments({ userId, source, ...(deviceId ? { deviceId } : {}) }),
        ),
    );
    return Object.fromEntries(
        sources
            .map((source, i) => [source, counts[i]!])
            .filter(([, count]) => (count as number) > 0),
    );
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
