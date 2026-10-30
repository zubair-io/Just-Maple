import type { Collection } from 'mongodb';
import { getDb, getSqliteDatabase } from '../db/client';
import {
    messageMetadata,
    matchingMessageIds,
    invalidateMessageMetadata,
} from './message-history.repo';
import {
    DEVICE_DATA_RETENTION_DAYS,
    normalizePersonHandle,
    deviceChoiceKey,
    isHomeStateItemId,
    deviceItemThreadKey,
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
    /** Messages: the conversation, so a thread's messages can be read without a scan. */
    threadKey?: string;
    /** Sticky archive decision, made from this owner’s contacts, never a client flag. */
    retainedContactMail?: boolean;
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

/** Contact identities for presentation. The caller must apply current viewer/page permissions. */
export async function findDeviceContactItems(userId: string): Promise<MacDataItem[]> {
    const docs = await getCollection()
        .find({ userId, source: 'contacts' }, { projection: { item: 1 } })
        .toArray();
    return docs.map((doc) => doc.item);
}

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
    const emails = items.some((item) => item.source === 'mail')
        ? contactEmails([
              ...(await findDeviceContactItems(userId)),
              ...items.filter((item) => item.source === 'contacts'),
          ])
        : new Set<string>();
    await getCollection().bulkWrite(
        items.map((raw) => {
            const item = { ...raw, body: raw.body.slice(0, MAX_BODY_CHARS) };
            const threadKey = deviceItemThreadKey(item);
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
                            ...(threadKey ? { threadKey } : {}),
                            ...(isContactMail(item, emails) ? { retainedContactMail: true } : {}),
                            updatedAt: now,
                        },
                    },
                    upsert: true,
                },
            };
        }),
        { ordered: false },
    );
    invalidateMessageMetadata(userId);
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
    // Older collectors can still send reconciliation removals. Archived contact mail
    // survives those; explicit “forget device/source” uses deleteDeviceItems instead.
    await retainContactMail(userId);
    const result = await getCollection().deleteMany({
        retainedContactMail: { $ne: true },
        _id: { $in: ids.map((id) => docId(userId, id)) },
        deviceId: scope.deviceId,
        source: { $in: scope.sources },
    });
    invalidateMessageMetadata(userId);
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
    // Full-history message reads must not hydrate every document through the compatibility adapter.
    if (
        getSqliteDatabase() &&
        query.sources?.length === 1 &&
        query.sources[0] === 'imessage' &&
        !query.conditions
    ) {
        const matches = await matchingMessageIds(userId, query.search ?? '');
        const rows = (await messageMetadata(userId)).filter(
            (item) =>
                (query.from === undefined || item.occurredAt >= query.from) &&
                (query.to === undefined || item.occurredAt <= query.to) &&
                (!matches || matches.has(item.id)) &&
                (!query.match || query.match(item)),
        );
        const direction = query.order === 'asc' ? 1 : -1;
        rows.sort(
            (a, b) =>
                (a.occurredAt - b.occurredAt) * direction || a.id.localeCompare(b.id) * direction,
        );
        const offset = Math.max(0, query.offset ?? 0);
        const limit = Math.min(500, Math.max(1, query.limit ?? 100));
        const ids = rows.slice(offset, offset + limit).map((item) => item.id);
        const byId = new Map(
            (await findDeviceItemsByIds(userId, ids)).map((item) => [item.id, item]),
        );
        return {
            items: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
            total: rows.length,
        };
    }
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
    const sqlite = getSqliteDatabase();
    const rows = sqlite
        ? await sqlite.request<Pick<DeviceItemDocument, 'source' | 'occurredAt' | 'item'>[]>(
              'device.facets',
              undefined,
              [userId],
          )
        : await getCollection()
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
        // A person's iMessage, SMS and RCS chats are one chat.
        const key = id ? `id:${deviceChoiceKey(row.source, { id, name })}` : `name:${name}`;
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

/**
 * The user's Home entities' current states without bodies, for the filter panel and the
 * read tool. Exposure is checked by the caller.
 */
export async function findHomeStateItems(userId: string): Promise<MacDataItem[]> {
    const docs = await getCollection()
        .find({ userId, source: 'home' }, { projection: { id: 1, item: 1 } })
        .toArray();
    return docs.filter((doc) => isHomeStateItemId(doc.id)).map((doc) => doc.item);
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

/**
 * Items for linking in the graph: one source in a time window (or uploaded since a
 * moment), newest first, at most `limit`. Bodies are cut to `bodyChars` right away so a
 * big backfill stays small in memory.
 */
export async function findDeviceItemsForGraph(
    userId: string,
    source: MacDataSource,
    query: { from?: number; to?: number; updatedSince?: Date; limit: number; bodyChars: number },
): Promise<MacDataItem[]> {
    const filter: Record<string, unknown> = { userId, source };
    if (query.from !== undefined || query.to !== undefined) {
        filter.occurredAt = {
            ...(query.from !== undefined ? { $gte: query.from } : {}),
            ...(query.to !== undefined ? { $lte: query.to } : {}),
        };
    }
    if (query.updatedSince) filter.updatedAt = { $gt: query.updatedSince };
    const docs = await getCollection()
        .find(filter, { projection: { item: 1 } })
        .sort({ occurredAt: -1 })
        .limit(Math.max(1, query.limit))
        .toArray();
    return docs.map((doc) => ({ ...doc.item, body: doc.item.body.slice(0, query.bodyChars) }));
}

const HEAD_PROJECTION = { 'item.body': 0, vectors: 0, searchText: 0 } as const;

/**
 * Messages in these threads since `since`, without bodies: each thread's newest
 * `perThread`, plus the user's own newest `perThread`, so a reply isn't lost behind a
 * busy stretch from the other side. Messages stored before threads had keys are found
 * by a scan, which empties as they age out of the window.
 */
export async function findThreadMessageHeads(
    userId: string,
    threadKeys: string[],
    since: number,
    perThread = 50,
): Promise<MacDataItem[]> {
    const heads = new Map<string, MacDataItem>();
    const add = (docs: DeviceItemDocument[]) => {
        for (const doc of docs) heads.set(doc._id, { ...doc.item, body: '' });
    };
    const newest = (filter: Record<string, unknown>, limit: number) =>
        getCollection()
            .find(
                { userId, occurredAt: { $gte: since }, ...filter },
                { projection: HEAD_PROJECTION },
            )
            .sort({ occurredAt: -1 })
            .limit(limit)
            .toArray();
    for (const threadKey of threadKeys) {
        add(await newest({ threadKey }, perThread));
        add(await newest({ threadKey, 'item.isFromMe': true }, perThread));
    }
    const wanted = new Set(threadKeys);
    const legacy = await newest({ source: 'imessage', threadKey: { $exists: false } }, 5_000);
    add(legacy.filter((doc) => wanted.has(deviceItemThreadKey(doc.item) ?? '')));
    return [...heads.values()].sort((a, b) => b.occurredAt - a.occurredAt);
}

/**
 * The newest items of one source matching `filter`, without bodies: at most `limit`,
 * since `since`. Sorted and limited by the database, so a big mailbox isn't read.
 */
export async function findRecentItemHeads(
    userId: string,
    source: MacDataSource,
    filter: Record<string, unknown>,
    since: number,
    limit: number,
): Promise<MacDataItem[]> {
    const docs = await getCollection()
        .find(
            { ...filter, userId, source, occurredAt: { $gte: since } },
            { projection: HEAD_PROJECTION },
        )
        .sort({ occurredAt: -1 })
        .limit(limit)
        .toArray();
    return docs.map((doc) => ({ ...doc.item, body: '' }));
}

/**
 * Several items by id, in batches of 500; missing ones are left out. `bodyChars` cuts
 * bodies short for big batches.
 */
export async function findDeviceItemsByIds(
    userId: string,
    ids: string[],
    bodyChars?: number,
): Promise<MacDataItem[]> {
    const unique = [...new Set(ids)];
    const items: MacDataItem[] = [];
    for (let i = 0; i < unique.length; i += 500) {
        const docs = await getCollection()
            .find(
                { _id: { $in: unique.slice(i, i + 500).map((id) => docId(userId, id)) } },
                { projection: { item: 1 } },
            )
            .toArray();
        for (const doc of docs)
            items.push(
                bodyChars === undefined
                    ? doc.item
                    : { ...doc.item, body: doc.item.body.slice(0, bodyChars) },
            );
    }
    return items;
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
    const sqlite = getSqliteDatabase();
    if (sqlite)
        return sqlite.request<Record<string, number>>('device.counts', undefined, [
            userId,
            deviceId,
        ]);
    const sources: MacDataSource[] = [
        'imessage',
        'mail',
        'calendar',
        'contacts',
        'location',
        'health',
        'home',
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
    invalidateMessageMetadata(userId);
    return result.deletedCount;
}

/** Addresses can belong to several cards and still qualify for retention. */
function contactEmails(contacts: MacDataItem[]): Set<string> {
    const emails = new Set<string>();
    for (const contact of contacts) {
        const entries = contact.extra?.['emails'];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const raw = typeof entry === 'string' ? entry : entry?.value;
            const email = typeof raw === 'string' ? normalizePersonHandle(raw) : null;
            if (email?.includes('@')) emails.add(email);
        }
    }
    return emails;
}

function isContactMail(item: MacDataItem, emails: Set<string>): boolean {
    if (item.source !== 'mail') return false;
    const sender = normalizePersonHandle(item.sender);
    return sender !== null && emails.has(sender);
}

/** Promote already imported mail too, without reading or backfilling the mail source.
 * The decision is sticky: later card edits cannot expire previously archived mail.
 */
export async function retainContactMail(userId?: string): Promise<number> {
    const owners = userId
        ? [userId]
        : [
              ...new Set(
                  (
                      await getCollection()
                          .find({ source: 'contacts' }, { projection: { userId: 1 } })
                          .toArray()
                  ).map((doc) => doc.userId),
              ),
          ];
    let retained = 0;
    for (const owner of owners) {
        const emails = contactEmails(await findDeviceContactItems(owner));
        if (!emails.size) continue;
        let after = '';
        while (true) {
            const batch = await getCollection()
                .find(
                    {
                        userId: owner,
                        source: 'mail',
                        retainedContactMail: { $ne: true },
                        _id: { $gt: after },
                    },
                    { projection: { _id: 1, item: 1 } },
                )
                .sort({ _id: 1 })
                .limit(500)
                .toArray();
            if (!batch.length) break;
            const ids = batch
                .filter((doc) => isContactMail(doc.item, emails))
                .map((doc) => doc._id);
            if (ids.length) {
                retained += (
                    await getCollection().updateMany(
                        { _id: { $in: ids } },
                        { $set: { retainedContactMail: true } },
                    )
                ).modifiedCount;
            }
            after = batch[batch.length - 1]!._id;
        }
    }
    return retained;
}

/** iMessages, contacts and archived contact mail have no automatic expiry.
 * Other sources keep the rolling window, with ongoing event/current Home exceptions.
 */
export async function purgeExpiredDeviceItems(now = Date.now()): Promise<string[]> {
    await retainContactMail();
    const cutoff = now / 1000 - DEVICE_DATA_RETENTION_DAYS * 24 * 60 * 60;
    const expired = await getCollection()
        .find(
            {
                source: { $nin: ['contacts', 'imessage'] },
                retainedContactMail: { $ne: true },
                occurredAt: { $lt: cutoff },
            },
            { projection: { _id: 1, id: 1, userId: 1, source: 1, endAt: 1 } },
        )
        .toArray();
    const doomed = expired.filter(
        (doc) =>
            (doc.source !== 'calendar' || (doc.endAt ?? 0) < cutoff) &&
            (doc.source !== 'home' || !isHomeStateItemId(doc.id)),
    );
    if (doomed.length === 0) return [];
    await getCollection().deleteMany({ _id: { $in: doomed.map((doc) => doc._id) } });
    return [...new Set(doomed.map((doc) => doc.userId))];
}
