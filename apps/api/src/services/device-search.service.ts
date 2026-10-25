import type { MacDataItem, MacDataSearchHit, MacDataSource } from '@maple/shared';
import { findDeviceItemsForIndex, type DeviceItemDocument } from '../repositories/device-item.repo';
import { redisPubSub } from './redis.service';
import { formatInZone } from '../utils/time-zone';

/**
 * Search over a user's uploaded device data: keyword matches plus meaning.
 *
 * Items arrive with vectors from Apple's on-device sentence model, so a query has to be
 * embedded by the same model: the caller passes a vector from one of the user's devices
 * when one is online, otherwise ranking falls back to keywords alone.
 *
 * Each API instance keeps one user's items in memory and reloads them when the user's
 * data version (bumped on every upload, in Redis) changes.
 */

export interface DeviceSearchRequest {
    sources: MacDataSource[];
    query?: string;
    from?: number;
    to?: number;
    limit?: number;
}

interface IndexedItem {
    item: MacDataItem;
    text: string;
    vectors: Float32Array[];
}

interface UserIndex {
    version: string;
    items: IndexedItem[];
    loadedAt: number;
}

const SNIPPET_LENGTH = 500;
const MAX_CACHED_USERS = 50;
const versionKey = (userId: string) => `devicedata:version:${userId}`;
const STOP_WORDS = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'what',
    'when',
    'where',
    'who',
    'how',
    'does',
    'do',
    'did',
    'for',
    'to',
    'of',
    'in',
    'on',
    'at',
    'and',
    'or',
    'my',
    'me',
    'i',
    'any',
    'there',
    'this',
    'that',
    'with',
    'about',
    'it',
    'be',
    'time',
]);

const indexes = new Map<string, UserIndex>();

/** Marks a user's data as changed so every instance reloads it on the next search. */
export async function bumpDeviceDataVersion(userId: string): Promise<void> {
    indexes.delete(userId);
    await redisPubSub
        .setKey(versionKey(userId), String(Date.now()), 7 * 24 * 60 * 60)
        .catch(() => {});
}

export async function searchDeviceData(
    userId: string,
    request: DeviceSearchRequest,
    timeZone: string,
    queryVector?: number[] | null,
): Promise<MacDataSearchHit[]> {
    const limit = Math.min(Math.max(request.limit ?? 12, 1), 25);
    const query = request.query?.trim() ?? '';
    const terms = keywordTerms(query);
    const index = await loadIndex(userId);
    const rows = index.items.filter(
        ({ item }) =>
            request.sources.includes(item.source) &&
            (request.from === undefined || item.occurredAt >= request.from) &&
            (request.to === undefined || item.occurredAt <= request.to),
    );

    // No query: list what falls in the date range, soonest first.
    if (!query) {
        return rows
            .sort((a, b) => a.item.occurredAt - b.item.occurredAt)
            .slice(0, limit)
            .map(({ item }) => hit(item, 0, [], timeZone));
    }

    const qv = queryVector?.length ? Float32Array.from(queryVector) : null;
    const scored: Array<{ item: MacDataItem; score: number }> = [];
    for (const row of rows) {
        const keyword = keywordScore(terms, row.text);
        let semantic = 0;
        if (qv) {
            for (const vector of row.vectors) {
                if (vector.length !== qv.length) continue;
                let dot = 0;
                for (let i = 0; i < vector.length; i++) dot += vector[i]! * qv[i]!;
                semantic = Math.max(semantic, dot);
            }
        }
        // Keywords dominate for names and numbers; meaning catches paraphrases.
        if (keyword <= 0 && semantic < 0.45) continue;
        scored.push({ item: row.item, score: semantic + keyword * 0.6 });
    }
    return scored
        .sort((a, b) =>
            a.score === b.score ? b.item.occurredAt - a.item.occurredAt : b.score - a.score,
        )
        .slice(0, limit)
        .map(({ item, score }) => hit(item, score, terms, timeZone));
}

async function loadIndex(userId: string): Promise<UserIndex> {
    const version = (await redisPubSub.getKey(versionKey(userId)).catch(() => null)) ?? '0';
    const cached = indexes.get(userId);
    if (cached && cached.version === version) return cached;
    const docs = await findDeviceItemsForIndex(userId);
    const index: UserIndex = { version, items: docs.map(toIndexed), loadedAt: Date.now() };
    indexes.set(userId, index);
    // Keep memory bounded: drop the least recently loaded users.
    if (indexes.size > MAX_CACHED_USERS) {
        const oldest = [...indexes.entries()].sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
        if (oldest) indexes.delete(oldest[0]);
    }
    return index;
}

function toIndexed(doc: DeviceItemDocument): IndexedItem {
    const usable =
        doc.vectors && doc.dimensions && doc.embeddedRevision === doc.revision
            ? decodeVectors(doc.vectors, doc.dimensions)
            : [];
    return { item: doc.item, text: doc.searchText, vectors: usable };
}

/** Base64 of little-endian float32 values, `dimensions` per chunk. */
export function decodeVectors(base64: string, dimensions: number): Float32Array[] {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length % 4 !== 0) return [];
    const floats = new Float32Array(bytes.length / 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < floats.length; i++) floats[i] = view.getFloat32(i * 4, true);
    const chunks: Float32Array[] = [];
    for (let start = 0; start + dimensions <= floats.length; start += dimensions) {
        chunks.push(floats.subarray(start, start + dimensions));
    }
    return chunks;
}

export function keywordTerms(query: string): string[] {
    return query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

/** Fraction of query terms that appear in the item's text. */
export function keywordScore(terms: string[], text: string): number {
    if (terms.length === 0) return 0;
    return terms.filter((term) => text.includes(term)).length / terms.length;
}

/** A window of the body around the first matching term, or its start. */
export function snippet(body: string, terms: string[]): string {
    const flat = body.replace(/\s+/g, ' ');
    if (flat.length <= SNIPPET_LENGTH) return flat;
    const lower = flat.toLowerCase();
    const term = terms.find((t) => lower.includes(t));
    const start = term ? Math.max(0, lower.indexOf(term) - 120) : 0;
    const end = Math.min(flat.length, start + SNIPPET_LENGTH);
    return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

export function hit(
    item: MacDataItem,
    score: number,
    terms: string[],
    timeZone: string,
): MacDataSearchHit {
    return {
        id: item.id,
        source: item.source,
        when: formatInZone(new Date(item.occurredAt * 1000), timeZone),
        ...(item.endAt !== undefined
            ? { end: formatInZone(new Date(item.endAt * 1000), timeZone) }
            : {}),
        ...(item.allDay !== undefined ? { allDay: item.allDay } : {}),
        ...(item.title ? { title: item.title } : {}),
        ...(item.sender ? { sender: item.sender } : {}),
        ...(item.participants.length ? { participants: item.participants.slice(0, 10) } : {}),
        ...(item.location ? { location: item.location } : {}),
        ...(item.calendar ? { calendar: item.calendar } : {}),
        ...(item.mailbox ? { mailbox: item.mailbox } : {}),
        snippet: snippet(item.body, terms),
        score: Math.round(score * 1000) / 1000,
    };
}
