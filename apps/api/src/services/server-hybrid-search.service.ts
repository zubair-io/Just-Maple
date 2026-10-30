import type { MacDataItem, MacDataSource, MacDataSearchHit } from '@maple/shared';
import { getDb, getSqliteDatabase } from '../db/client';
import type { DeviceItemDocument } from '../repositories/device-item.repo';
import { dataPageSlicesFor, type DataPageSlice } from './device-data-access.service';
import { hit } from './device-search.service';
import { fuseRanks, parseHybridQuery } from './hybrid-query';
import { serverSearchWorker } from './server-search-worker.service';

interface Scope {
    userId: string;
    notebookId: string;
    timeZone: string;
}
interface SearchInput {
    query: string;
    sources?: MacDataSource[];
    from?: number;
    to?: number;
    limit?: number;
}
interface Candidate {
    doc: Pick<DeviceItemDocument, '_id' | 'userId' | 'source' | 'revision'> & {
        contentHash: string;
        occurredAt: number;
    };
    slice: DataPageSlice;
}
interface VectorEntry {
    id: string;
    chunk: number;
    documentId: string;
    revision: string;
    contentHash: string;
    vector: string;
}
interface CachedOwner {
    epoch: number;
    keys: Map<string, { documentId: string; revision: string; contentHash: string }>;
    bytes: number;
    loadedAt: number;
}
const cachedOwners = new Map<string, CachedOwner>();
const loadingOwners = new Map<string, Promise<CachedOwner>>();
const MAX_CACHE_BYTES = 1024 * 1024 * 1024;
let activeSearches = 0;
// Bound the whole retrieval, including candidate scans, before allocating maps.
// LLMs can issue several tools in parallel; semantic-only admission was too late.
let runningRequests = 0;
const waitingRequests: Array<() => void> = [];

async function acquireSearchSlot(): Promise<void> {
    if (runningRequests < 2) {
        runningRequests++;
        return;
    }
    if (waitingRequests.length >= 4) throw new Error('search_overloaded');
    await new Promise<void>((resolve) => waitingRequests.push(resolve));
}

function releaseSearchSlot(): void {
    const next = waitingRequests.shift();
    if (next) next();
    else runningRequests--;
}

const identity = (owner: string, item: MacDataItem) =>
    JSON.stringify([owner, item.source, item.id]);
export const itemReference = (owner: string, item: MacDataItem) =>
    'maple:item:' + Buffer.from(identity(owner, item)).toString('base64url');
export function decodeItemReference(value: string): [string, MacDataSource, string] | null {
    if (!value.startsWith('maple:item:') || value.length > 4096) return null;
    try {
        const decoded: unknown = JSON.parse(
            Buffer.from(value.slice(11), 'base64url').toString('utf8'),
        );
        return Array.isArray(decoded) &&
            decoded.length === 3 &&
            decoded.every((v) => typeof v === 'string')
            ? (decoded as [string, MacDataSource, string])
            : null;
    } catch {
        return null;
    }
}
function deadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('semantic_timeout')), milliseconds);
        work.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}
async function loadOwner(owner: string, epoch: number): Promise<CachedOwner> {
    const cached = cachedOwners.get(owner);
    if (cached && (cached.epoch === epoch || Date.now() - cached.loadedAt < 3000)) return cached;
    const loading = loadingOwners.get(owner);
    if (loading) return loading;
    const promise = (async () => {
        const db = getSqliteDatabase();
        if (!db) throw new Error('sqlite_unavailable');
        await serverSearchWorker.request({ op: 'begin', owner });
        const keys = new Map<
            string,
            { documentId: string; revision: string; contentHash: string }
        >();
        let count = 0;
        let after: { id: string; chunk: number } | null = null;
        for (;;) {
            const entries = await db.request<VectorEntry[]>('search.vectorBatch', undefined, [
                owner,
                after,
            ]);
            if (!entries.length) break;
            if ((count + entries.length) * 4096 > MAX_CACHE_BYTES)
                throw new Error('vector_capacity');
            await serverSearchWorker.request({
                op: 'load',
                owner,
                entries: entries.map(({ id, vector }) => ({ id, vector })),
            });
            entries.forEach((row) =>
                keys.set(row.id, {
                    documentId: row.documentId,
                    revision: row.revision,
                    contentHash: row.contentHash,
                }),
            );
            count += entries.length;
            const last = entries[entries.length - 1]!;
            after = { id: last.documentId, chunk: last.chunk };
        }
        await serverSearchWorker.request({ op: 'finish', owner, version: epoch });
        // Backfill may advance during the bounded load. Per-row revision checks
        // exclude changed sources; coverage reports rows not loaded yet.
        const result = { epoch, keys, bytes: keys.size * 4096, loadedAt: Date.now() };
        cachedOwners.delete(owner);
        cachedOwners.set(owner, result);
        while (
            [...cachedOwners.values()].reduce((sum, row) => sum + row.bytes, 0) > MAX_CACHE_BYTES
        ) {
            const victim = cachedOwners.keys().next().value;
            if (victim === undefined) break;
            cachedOwners.delete(victim);
        }
        return result;
    })().finally(() => loadingOwners.delete(owner));
    loadingOwners.set(owner, promise);
    return promise;
}
async function allowedCandidates(
    slices: DataPageSlice[],
    input: SearchInput,
): Promise<Map<string, Candidate>> {
    const candidates = new Map<string, Candidate>();
    for (const owner of [...new Set(slices.map((slice) => slice.ownerId))]) {
        const ownSlices = slices.filter((slice) => slice.ownerId === owner);
        const sources = [...new Set(ownSlices.map((slice) => slice.source))];
        let after = 0;
        for (;;) {
            // Never serialize the entire archive at once. Apply every sharing filter
            // to its metadata facts, then retain only identity/version and sort keys.
            const docs = await getSqliteDatabase()!.request<
                Array<Omit<Candidate['doc'], 'occurredAt'> & { item: MacDataItem; cursor: number }>
            >('search.candidates', undefined, [owner, sources, input.from, input.to, after]);
            for (const { item, cursor, ...doc } of docs) {
                const slice = ownSlices.find(
                    (slice) => slice.source === doc.source && slice.match(item),
                );
                if (slice)
                    candidates.set(String(doc._id), {
                        doc: { ...doc, occurredAt: item.occurredAt },
                        slice,
                    });
                after = cursor;
            }
            if (docs.length < 500) break;
        }
    }
    return candidates;
}

/** Authorized union is ranked once; current permissions and source revisions are rechecked before hydration. */
export async function searchServerDataPages(ctx: Scope, input: SearchInput) {
    await acquireSearchSlot();
    try {
        return await searchAuthorizedDataPages(ctx, input);
    } finally {
        releaseSearchSlot();
    }
}

async function searchAuthorizedDataPages(ctx: Scope, input: SearchInput) {
    const db = getSqliteDatabase();
    if (!db) throw new Error('Server search requires SQLite');
    const current = await dataPageSlicesFor(ctx.userId, ctx.notebookId);
    const slices = current.filter(
        (slice) => !input.sources?.length || input.sources.includes(slice.source),
    );
    const allowed = await allowedCandidates(slices, input);
    const limit = Math.min(25, Math.max(1, input.limit ?? 12));
    const parsed = parseHybridQuery(input.query);
    let lexical: string[] = [],
        semantic: string[] = [],
        fallbackReason: string | undefined;
    let embeddedEligible: number | null = null;
    let mode: 'hybrid' | 'lexical' | 'chronological' = 'lexical';
    if (!input.query.trim()) {
        mode = 'chronological';
        lexical = [...allowed]
            .sort((a, b) => a[1].doc.occurredAt - b[1].doc.occurredAt || a[0].localeCompare(b[0]))
            .map(([id]) => id);
    } else if (parsed.expression) {
        if (parsed.requiredExpression || parsed.excludedExpression) {
            const hard = await db.request<Array<{ id: string }>>('search.hardFilter', undefined, [
                parsed.requiredExpression,
                parsed.excludedExpression,
                [...allowed.keys()],
            ]);
            const eligible = new Set(hard.map((row) => row.id));
            for (const id of allowed.keys()) if (!eligible.has(id)) allowed.delete(id);
        }
        lexical = (
            await db.request<Array<{ id: string; score: number }>>('search.lexical', undefined, [
                parsed.expression,
                [...allowed.keys()],
                100,
            ])
        ).map((row) => row.id);
        if (allowed.size) {
            if (activeSearches >= 4) fallbackReason = 'semantic_overloaded';
            else if (serverSearchWorker.state !== 'ready') {
                fallbackReason = 'worker_' + serverSearchWorker.state;
                serverSearchWorker.start();
            } else {
                activeSearches++;
                try {
                    semantic = await deadline(
                        (async () => {
                            const { epoch } = await db.request<{ epoch: number }>('search.epoch');
                            const scopes = [];
                            const keys = new Map<string, string>();
                            for (const owner of [
                                ...new Set([...allowed.values()].map((row) => row.doc.userId)),
                            ]) {
                                const cached = await loadOwner(owner, epoch);
                                const ids = [...cached.keys]
                                    .filter(
                                        ([, entry]) =>
                                            allowed.get(entry.documentId)?.doc.revision ===
                                                entry.revision &&
                                            allowed.get(entry.documentId)?.doc.contentHash ===
                                                entry.contentHash,
                                    )
                                    .map(([id, entry]) => {
                                        keys.set(id, entry.documentId);
                                        return id;
                                    });
                                if (ids.length) scopes.push({ owner, version: cached.epoch, ids });
                            }
                            if (!scopes.length) throw new Error('embeddings_pending');
                            embeddedEligible = new Set(keys.values()).size;
                            const result = await serverSearchWorker.request<{
                                hits: Array<{ id: string; score: number }>;
                            }>({ op: 'search', text: input.query, scopes, limit: 100 });
                            const threshold = Number(process.env.SEARCH_SEMANTIC_MIN_SCORE ?? 0.35);
                            return [
                                ...new Set(
                                    result.hits
                                        .filter((row) => row.score >= threshold)
                                        .map((row) => keys.get(row.id))
                                        .filter((id): id is string => !!id),
                                ),
                            ];
                        })(),
                        2000,
                    );
                    mode = 'hybrid';
                } catch (error) {
                    const reason = (error as Error).message;
                    fallbackReason = [
                        'semantic_timeout',
                        'semantic_overloaded',
                        'embeddings_pending',
                        'index_changing',
                        'vector_capacity',
                    ].includes(reason)
                        ? reason
                        : 'worker_unavailable';
                    if (reason.includes('cache_') || reason.includes('worker_'))
                        cachedOwners.clear();
                } finally {
                    activeSearches--;
                }
            }
        }
    }
    const ranked =
        mode === 'chronological'
            ? lexical.slice(0, 200).map((id) => ({ id, score: 0 }))
            : fuseRanks(lexical, semantic);
    // Re-resolve membership and filters after native work and re-read content/revision.
    const freshSlices = await dataPageSlicesFor(ctx.userId, ctx.notebookId);
    const ids = ranked.map((row) => row.id);
    const fresh = ids.length
        ? await getDb()
              .collection<DeviceItemDocument>('device_items')
              .find({ _id: { $in: ids } }, { projection: { vectors: 0 } })
              .toArray()
        : [];
    const byId = new Map(fresh.map((doc) => [String(doc._id), doc]));
    const versions = new Map(
        (
            await db.request<Array<{ id: string; contentHash: string }>>(
                'search.versions',
                undefined,
                [ids],
            )
        ).map((row) => [row.id, row.contentHash]),
    );
    const results: Array<
        MacDataSearchHit & { reference: string; page: string; sharedBy?: string }
    > = [];
    for (const row of ranked) {
        const original = allowed.get(row.id),
            doc = byId.get(row.id);
        if (
            !original ||
            !doc ||
            versions.get(row.id) !== original.doc.contentHash ||
            doc.revision !== original.doc.revision ||
            doc.userId !== original.doc.userId
        )
            continue;
        const slice = freshSlices.find(
            (slice) =>
                slice.pageId === original.slice.pageId &&
                slice.ownerId === doc.userId &&
                slice.source === doc.source &&
                slice.match(doc.item),
        );
        if (!slice) continue;
        results.push({
            ...hit(doc.item, row.score, parsed.terms, ctx.timeZone),
            reference: itemReference(doc.userId, doc.item),
            page: slice.title,
            ...(slice.ownerId !== ctx.userId ? { sharedBy: slice.ownerName } : {}),
        });
        if (results.length >= limit) break;
    }
    return {
        results,
        search: {
            mode,
            ...(fallbackReason ? { fallbackReason } : {}),
            modelGeneration: 'bge-m3-5617a9f-cls-l2-512-v1',
            coverage: { eligible: allowed.size, embedded: embeddedEligible },
        },
    };
}
