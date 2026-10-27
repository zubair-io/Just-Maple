import {
    dataGraphItemNodeId,
    isNotebookShared,
    parseDataGraphItemNodeId,
    type DataGraph,
    type DataGraphLink,
    type DataGraphNode,
    type MacDataItem,
    type TravelEstimate,
} from '@maple/shared';
import {
    claimGraphPass,
    deleteGraphLinksGoneBefore,
    deleteGraphLinksTouching,
    deleteGraphNodes,
    deleteStaleRuleLinks,
    findDecidedPairs,
    findGraphLinks,
    findGraphLinksOf,
    findGraphLinksToCheck,
    findGraphNodes,
    findGraphState,
    findJudgedItems,
    finishGraphPass,
    linkKey,
    markGraphLinksChecked,
    markItemsJudged,
    pruneGraphUsage,
    pruneJudgedItems,
    pruneRejectedPairs,
    rejectGraphPairs,
    releaseGraphCall,
    releaseGraphPass,
    requestFullGraphPass,
    reserveGraphCall,
    saveGraphLinks,
    saveGraphNodes,
    setGraphLinkEvidence,
    type GraphLinkDocument,
    type GraphLinkInput,
    type GraphNodeDocument,
} from '../repositories/graph.repo';
import { findDeviceItemsByIds, findDeviceItemsForGraph } from '../repositories/device-item.repo';
import { findTravelEstimates } from '../repositories/travel-estimate.repo';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import {
    findDeviceDataPagesInNotebook,
    findGraphNotebookIds,
    findGraphPage,
} from '../repositories/page.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import {
    dataPageSlicesFor,
    notebookDataSlices,
    type DataPageSlice,
} from './device-data-access.service';
import { sharedRefusal } from './about-me.service';
import {
    incrementalRuleLinks,
    modelCandidates,
    ruleGraph,
    topicNodeId,
    type Candidate,
    type GraphItem,
    type GraphNodeInput,
    type KnownHubs,
    type RuleGraph,
} from './graph-rules';
import {
    graphModelAvailable,
    judgeGraphBatch,
    type GraphJudgeItem,
    type GraphJudgeRequest,
} from './graph-model.service';
import { formatInZone } from '../utils/time-zone';

/**
 * The connected-data graph of one notebook.
 *
 * 1. A notebook opts in by adding its Graph page. From then on, a background pass links
 *    the items its data pages share (each page through its filter, as every member sees
 *    it) over the last 30 days (and the next 30 for events).
 * 2. Rules make certain links (same place, same time, driving time, one person across
 *    phones and emails). A full pass rebuilds them at most every 15 minutes; between
 *    full passes, new uploads are linked to the people and places already known.
 * 3. A batched model pass judges likely pairs and sorts items into topics. It remembers
 *    which items it has seen, so items that arrive later (a new page, a wider filter, a
 *    big upload) are judged in later passes, within a daily budget.
 * 4. Links, people, places and topics belong to the notebook. They're built and read only
 *    from that notebook's pages; the same email in two notebooks is linked separately.
 * 5. Reading checks every item against the pages again, so an item a filter stops
 *    sharing drops out at once. Nothing is deleted on read: model links go only once an
 *    item has been gone from the device data for 30 days.
 * 6. In a shared notebook, reads hide private topics and reasons and travel links, even
 *    ones saved while it was private; the first pass after it's shared scrubs them.
 * 7. Someone can remove a link; it is never made again for the same pair, even when a
 *    person's id changes because two of them merged.
 */

const DAY = 24 * 60 * 60;
const WINDOW_DAYS = 30;
/** Upcoming events are linked too (an appointment booked at the office). */
const UPCOMING_DAYS = 30;
const MAX_ITEMS_PER_PAGE = 1_500;
const MAX_ITEMS = 4_000;
const BODY_CHARS = 400;
/** Model links below this are not saved. */
export const AUTO_LINK_CONFIDENCE = 0.75;
const TOPIC_CONFIDENCE = 0.7;
const PAIRS_PER_CALL = 30;
const TOPIC_ITEMS_PER_CALL = 40;
/** Model calls per pass: a backfill works through its items over several passes. */
const CALLS_PER_PASS = 4;
/** Model calls a day, per notebook and per person who added a Graph page. */
export const NOTEBOOK_DAILY_CALLS = 40;
export const USER_DAILY_CALLS = 100;
const LEASE_MS = 10 * 60 * 1000;
/** Full passes from the background job are at least this far apart. */
const FULL_PASS_GAP_MS = 15 * 60 * 1000;
/** A full pass runs this often even without uploads (filters change, items expire). */
const REFRESH_MS = 30 * 60 * 1000;
/** A model link goes once one of its items has been missing this long. */
const GONE_DAYS = 30;
const LINKS_CHECKED_PER_PASS = 500;
/** Rejected pairs and seen items this old have left the window. */
const FORGET_DAYS = 90;
/** At most this many items in the viewer, and links read for it. */
export const MAX_GRAPH_ITEMS = 2_000;
const MAX_LINKS_READ = 10_000;

export interface GraphPassResult {
    items: number;
    ruleLinks: number;
    modelLinks: number;
    modelCalls: number;
    /** Items in the window the model still has to see. */
    pending: number;
    backfilled: boolean;
}

// MARK: - Linking

/** Everything the notebook's data pages share in the window, newest first. */
async function loadNotebookItems(
    slices: DataPageSlice[],
    from: number,
    to: number,
    updatedSince?: Date,
): Promise<GraphItem[]> {
    const seen = new Set<string>();
    const items: GraphItem[] = [];
    for (const slice of slices) {
        const contacts = slice.source === 'contacts';
        const found = await findDeviceItemsForGraph(slice.ownerId, slice.source, {
            ...(contacts ? {} : { from, to }),
            ...(updatedSince ? { updatedSince } : {}),
            limit: MAX_ITEMS_PER_PAGE,
            bodyChars: BODY_CHARS,
        });
        for (const item of found) {
            const nodeId = dataGraphItemNodeId(slice.ownerId, item.id);
            // Two pages can show the same item; it's one node.
            if (seen.has(nodeId) || !slice.match(item)) continue;
            seen.add(nodeId);
            items.push({ nodeId, ownerId: slice.ownerId, pageId: slice.pageId, item });
        }
    }
    return items.sort((a, b) => b.item.occurredAt - a.item.occurredAt).slice(0, MAX_ITEMS);
}

/** Driving times to the notebook's events, keyed `${ownerId}:${eventId}`. */
async function travelFor(items: GraphItem[]): Promise<Map<string, TravelEstimate>> {
    const byOwner = new Map<string, string[]>();
    for (const entry of items) {
        if (entry.item.source !== 'calendar') continue;
        byOwner.set(entry.ownerId, [...(byOwner.get(entry.ownerId) ?? []), entry.item.id]);
    }
    const travel = new Map<string, TravelEstimate>();
    for (const [ownerId, ids] of byOwner) {
        for (const [eventId, estimate] of await findTravelEstimates(ownerId, ids))
            travel.set(`${ownerId}:${eventId}`, estimate);
    }
    return travel;
}

/** Words a shared notebook never keeps on a link or topic (the About me rule). */
function isPrivateMatter(text: string): boolean {
    return !!sharedRefusal({ key: '', value: text, kind: 'current' });
}

/**
 * What readers of the notebook may see of a link, as it is now (it may have been saved
 * while the notebook was private). In a shared notebook: no travel (it says where someone
 * was), and no private reasons. Null hides the link.
 */
function linkForReaders(link: GraphLinkDocument, shared: boolean): GraphLinkDocument | null {
    if (!shared) return link;
    if (link.kind === 'travel') return null;
    return isPrivateMatter(link.evidence) ? { ...link, evidence: 'Related' } : link;
}

/** A person, place or topic readers may see; private topics stay out of shared notebooks. */
function hubForReaders(hub: GraphNodeDocument, shared: boolean): boolean {
    return !(shared && hub.kind === 'topic' && isPrivateMatter(hub.label));
}

/** Cleans what was saved while the notebook was private, now that it's shared. */
async function scrubForSharing(notebookId: string): Promise<void> {
    const privateTopics = (await findGraphNodes(notebookId, ['topic']))
        .filter((topic) => isPrivateMatter(topic.label))
        .map((topic) => topic.id);
    await deleteGraphLinksTouching(notebookId, privateTopics);
    await deleteGraphNodes(notebookId, privateTopics);
    const stored = await findGraphLinks(notebookId, ['active', 'removed'], 50_000);
    await setGraphLinkEvidence(
        notebookId,
        stored
            .filter((link) => link.kind === 'travel' || isPrivateMatter(link.evidence))
            .map((link) => link._id),
        'Related',
    );
}

/** People and places stored for the notebook, as the rules look them up. */
function knownHubs(stored: GraphNodeDocument[]): KnownHubs {
    const personOf = new Map<string, string>();
    const people = new Map<string, string>();
    for (const node of stored) {
        if (node.kind !== 'person') continue;
        people.set(node.id, node.label);
        for (const handle of node.handles ?? []) {
            const earlier = personOf.get(handle);
            if (!earlier || node.id < earlier) personOf.set(handle, node.id);
        }
    }
    return { personOf, people, places: stored.filter((node) => node.kind === 'place') };
}

/**
 * Whether a link would bring back one someone removed: the same pair, or the same item
 * and a person who has since been merged into another id.
 */
async function removalCheck(
    notebookId: string,
    hubs: Array<Pick<GraphNodeInput, 'id' | 'aliases'>>,
): Promise<(a: string, b: string) => boolean> {
    const current = new Map<string, string>();
    for (const hub of hubs) for (const alias of hub.aliases ?? []) current.set(alias, hub.id);
    const canonical = (id: string) => current.get(id) ?? id;
    const pair = (x: string, y: string) => {
        const [a, b] = [canonical(x), canonical(y)].sort();
        return `${a}|${b}`;
    };
    const removed = new Set(
        (await findGraphLinks(notebookId, ['removed'], 5_000)).map((link) => pair(link.a, link.b)),
    );
    return (a, b) => removed.has(pair(a, b));
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY * 1000);
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/**
 * One full linking pass for a notebook with a Graph page: rule links over the whole
 * window, then the model over a bounded batch of items it hasn't seen. Null when the
 * notebook has no Graph page or another pass is running.
 */
export async function runGraphPass(
    notebookId: string,
    now = new Date(),
): Promise<GraphPassResult | null> {
    const page = await findGraphPage(notebookId);
    if (!page) return null;
    if (!(await claimGraphPass(notebookId, now, LEASE_MS))) return null;
    try {
        const state = await findGraphState(notebookId);
        const notebook = await findNotebookByIdUnsafe(notebookId);
        const shared = isNotebookShared(notebook);
        const slices = await notebookDataSlices(notebookId);
        const nowSeconds = now.getTime() / 1000;
        const items = await loadNotebookItems(
            slices,
            nowSeconds - WINDOW_DAYS * DAY,
            nowSeconds + UPCOMING_DAYS * DAY,
        );

        // Rules: certain links, rebuilt over the whole window. People and places keep the
        // ids they had.
        const stored = await findGraphNodes(notebookId, ['person', 'place']);
        const storedById = new Map(stored.map((node) => [node.id, node]));
        const rules = ruleGraph(items, {
            travel: shared ? new Map() : await travelFor(items),
            shared,
            known: knownHubs(stored),
        });
        const merged = new Set<string>();
        const nodes = rules.nodes.map((node) => {
            if (node.kind !== 'person') return node;
            const aliases = new Set([
                ...(storedById.get(node.id)?.aliases ?? []),
                ...(node.aliases ?? []).flatMap((id) => [
                    id,
                    ...(storedById.get(id)?.aliases ?? []),
                ]),
            ]);
            for (const id of node.aliases ?? []) merged.add(id);
            aliases.delete(node.id);
            return { ...node, aliases: [...aliases] };
        });
        const removed = await removalCheck(notebookId, [...stored, ...nodes]);
        await saveGraphNodes(notebookId, nodes);
        // People merged into another keep no node of their own (their id is an alias now).
        await deleteGraphNodes(notebookId, [...merged]);
        const ruleLinks = await saveGraphLinks(
            notebookId,
            rules.links.filter((link) => !removed(link.a, link.b)),
        );
        await deleteStaleRuleLinks(
            notebookId,
            new Set(rules.links.map((link) => linkKey(notebookId, link.a, link.b))),
        );
        if (shared && !state?.scrubbedShared) await scrubForSharing(notebookId);

        const model = await modelPass(notebookId, items, rules, {
            shared,
            userId: page.userId,
            now,
        });
        await checkGoneItems(notebookId, now);
        await pruneRejectedPairs(notebookId, daysAgo(now, FORGET_DAYS));
        await pruneJudgedItems(notebookId, daysAgo(now, FORGET_DAYS));

        const backfilled = model.pending === 0;
        await finishGraphPass(
            notebookId,
            {
                lastRunAt: now,
                lastFullRunAt: now,
                // Uploads from here on are linked by the next incremental pass.
                cursor: now,
                pendingItems: model.pending,
                scrubbedShared: shared,
                ...(backfilled && !state?.backfilledAt ? { backfilledAt: now } : {}),
            },
            { full: true },
        );
        return {
            items: items.length,
            ruleLinks,
            modelLinks: model.links,
            modelCalls: model.calls,
            pending: model.pending,
            backfilled,
        };
    } catch (error) {
        await releaseGraphPass(notebookId).catch(() => {});
        throw error;
    }
}

/**
 * Between full passes: links what was uploaded since the last pass to the people and
 * places the notebook already has. Rules only, no model. Null when there's nothing to
 * do it against yet, or another pass is running.
 */
export async function runIncrementalGraphPass(
    notebookId: string,
    now = new Date(),
): Promise<{ items: number; ruleLinks: number } | null> {
    if (!(await findGraphPage(notebookId))) return null;
    const state = await findGraphState(notebookId);
    if (!state?.lastFullRunAt || !state.cursor) return null;
    if (!(await claimGraphPass(notebookId, now, LEASE_MS))) return null;
    try {
        const slices = await notebookDataSlices(notebookId);
        const nowSeconds = now.getTime() / 1000;
        const fresh = await loadNotebookItems(
            slices,
            nowSeconds - WINDOW_DAYS * DAY,
            nowSeconds + UPCOMING_DAYS * DAY,
            state.cursor,
        );
        // Only people and places the last full pass still found.
        const lastFull = state.lastFullRunAt;
        const stored = (await findGraphNodes(notebookId, ['person', 'place'])).filter(
            (node) => node.updatedAt >= lastFull,
        );
        const rules = incrementalRuleLinks(fresh, knownHubs(stored));
        const removed = await removalCheck(notebookId, stored);
        await saveGraphNodes(notebookId, rules.nodes);
        const ruleLinks = await saveGraphLinks(
            notebookId,
            rules.links.filter((link) => !removed(link.a, link.b)),
        );
        await finishGraphPass(notebookId, { lastRunAt: now, cursor: now });
        return { items: fresh.length, ruleLinks };
    } catch (error) {
        await releaseGraphPass(notebookId).catch(() => {});
        throw error;
    }
}

/** Takes one model call from today's budget for the notebook and the Graph page's owner. */
async function reserveModelCall(notebookId: string, userId: string, now: Date) {
    const day = dayOf(now);
    if (!(await reserveGraphCall(`notebook:${notebookId}`, day, NOTEBOOK_DAILY_CALLS)))
        return false;
    if (await reserveGraphCall(`user:${userId}`, day, USER_DAILY_CALLS)) return true;
    await releaseGraphCall(`notebook:${notebookId}`, day);
    return false;
}

/**
 * Asks the model about items it hasn't seen, newest first, a batch per call: likely
 * pairs involving them, and their topics. Saves confident links and topics, and notes
 * the items as seen only once their call succeeded.
 */
async function modelPass(
    notebookId: string,
    items: GraphItem[],
    rules: RuleGraph,
    options: { shared: boolean; userId: string; now: Date },
): Promise<{ links: number; calls: number; pending: number }> {
    if (!graphModelAvailable()) return { links: 0, calls: 0, pending: 0 };
    const judgeable = items.filter(
        (entry) => entry.item.source !== 'contacts' && entry.item.source !== 'health',
    );
    const seen = await findJudgedItems(
        notebookId,
        judgeable.map((entry) => entry.nodeId),
    );
    const pending = judgeable.filter((entry) => !seen.has(entry.nodeId));
    if (pending.length === 0) return { links: 0, calls: 0, pending: 0 };

    const topics = await findGraphNodes(notebookId, ['topic']);
    const topicNames = new Map(topics.map((topic) => [topic.id, topic.label]));
    const people = new Map(
        rules.nodes.filter((n) => n.kind === 'person').map((n) => [n.id, n.label]),
    );
    const zones = new Map<string, string>();
    const zoneOf = async (ownerId: string) => {
        if (!zones.has(ownerId))
            zones.set(ownerId, (await collectorTimeZone(ownerId).catch(() => undefined)) ?? 'UTC');
        return zones.get(ownerId)!;
    };

    let saved = 0;
    let calls = 0;
    let processed = 0;
    const asked = new Set<string>();
    for (let call = 0; call < CALLS_PER_PASS; call++) {
        const chunk = pending.slice(call * TOPIC_ITEMS_PER_CALL, (call + 1) * TOPIC_ITEMS_PER_CALL);
        if (chunk.length === 0) break;
        if (!(await reserveModelCall(notebookId, options.userId, options.now))) break;

        // Pairs involving this batch, minus those already decided (asked about only these).
        const likely = modelCandidates(
            notebookId,
            items,
            new Set(chunk.map((entry) => entry.nodeId)),
            { rules, decided: asked },
            PAIRS_PER_CALL * 4,
        );
        const decided = await findDecidedPairs(
            notebookId,
            likely.map((pair) => linkKey(notebookId, pair.a.nodeId, pair.b.nodeId)),
        );
        const pairs = likely
            .filter((pair) => !decided.has(linkKey(notebookId, pair.a.nodeId, pair.b.nodeId)))
            .slice(0, PAIRS_PER_CALL);
        for (const pair of pairs) asked.add(linkKey(notebookId, pair.a.nodeId, pair.b.nodeId));

        const numbered = new Map<string, number>();
        const entries: GraphItem[] = [];
        const number = (entry: GraphItem) => {
            if (!numbered.has(entry.nodeId)) {
                numbered.set(entry.nodeId, entries.length);
                entries.push(entry);
            }
            return numbered.get(entry.nodeId)!;
        };
        const request: GraphJudgeRequest = {
            pairs: pairs.map((pair: Candidate, p) => ({ p, a: number(pair.a), b: number(pair.b) })),
            items: [],
            topics: [...topicNames.values()].slice(0, 100),
            shared: options.shared,
        };
        chunk.forEach(number);
        for (const entry of entries) {
            request.items.push(
                await describeForModel(entry, numbered.get(entry.nodeId)!, {
                    zone: await zoneOf(entry.ownerId),
                    people: [...(rules.peopleOf.get(entry.nodeId) ?? [])]
                        .map((id) => people.get(id))
                        .filter((name): name is string => !!name),
                }),
            );
        }
        calls++;
        const judgement = await judgeGraphBatch(request).catch((error) => {
            console.error('[Graph] Model pass failed:', error);
            return null;
        });
        if (!judgement) break;

        const links: GraphLinkInput[] = [];
        const rejected: Array<[string, string]> = [];
        for (const verdict of judgement.pairs) {
            const pair = pairs[verdict.p];
            if (!pair) continue;
            if (verdict.related && verdict.confidence >= AUTO_LINK_CONFIDENCE) {
                const reason = verdict.reason || 'Related';
                links.push({
                    a: pair.a.nodeId,
                    b: pair.b.nodeId,
                    kind: 'related',
                    confidence: verdict.confidence,
                    evidence: options.shared && isPrivateMatter(reason) ? 'Related' : reason,
                    madeBy: 'model',
                });
            } else {
                rejected.push([pair.a.nodeId, pair.b.nodeId]);
            }
        }
        const newTopics = [];
        for (const topic of judgement.topics) {
            if (topic.confidence < TOPIC_CONFIDENCE) continue;
            if (options.shared && isPrivateMatter(topic.name)) continue;
            const id = topicNodeId(topic.name);
            const known = topicNames.has(id);
            // A new topic needs two items; an existing one takes a single new item.
            if (!known && topic.items.length < 2) continue;
            if (!known) {
                topicNames.set(id, topic.name);
                newTopics.push({ id, kind: 'topic' as const, label: topic.name });
            }
            for (const n of topic.items) {
                const entry = entries[n];
                if (!entry) continue;
                links.push({
                    a: entry.nodeId,
                    b: id,
                    kind: 'topic',
                    confidence: topic.confidence,
                    evidence: `Part of ${topicNames.get(id)}`,
                    madeBy: 'model',
                });
            }
        }
        await saveGraphNodes(notebookId, newTopics);
        saved += await saveGraphLinks(notebookId, links);
        await rejectGraphPairs(notebookId, rejected);
        await markItemsJudged(
            notebookId,
            chunk.map((entry) => entry.nodeId),
            options.now,
        );
        processed += chunk.length;
    }
    return { links: saved, calls, pending: pending.length - processed };
}

/**
 * Looks up the items of the model links checked longest ago. A link whose item is gone
 * from the device data (not just hidden by a filter) goes after 30 days; model links
 * can't be rebuilt, so a filter change or a source moving devices never removes them.
 */
async function checkGoneItems(notebookId: string, now: Date): Promise<void> {
    const batch = await findGraphLinksToCheck(notebookId, LINKS_CHECKED_PER_PASS);
    if (batch.length === 0) return;
    const byOwner = new Map<string, Set<string>>();
    for (const link of batch) {
        for (const end of [link.a, link.b]) {
            const parsed = parseDataGraphItemNodeId(end);
            if (!parsed) continue;
            byOwner.set(
                parsed.ownerId,
                (byOwner.get(parsed.ownerId) ?? new Set()).add(parsed.itemId),
            );
        }
    }
    const found = new Set<string>();
    for (const [ownerId, ids] of byOwner)
        for (const item of await findDeviceItemsByIds(ownerId, [...ids], 0))
            found.add(dataGraphItemNodeId(ownerId, item.id));
    const missing = (link: GraphLinkDocument) =>
        [link.a, link.b].some((end) => end.startsWith('item:') && !found.has(end));
    await markGraphLinksChecked(
        notebookId,
        batch.filter((link) => !missing(link)).map((link) => link._id),
        batch.filter(missing).map((link) => link._id),
        now,
    );
    await deleteGraphLinksGoneBefore(notebookId, daysAgo(now, GONE_DAYS));
}

async function describeForModel(
    entry: GraphItem,
    n: number,
    context: { zone: string; people: string[] },
): Promise<GraphJudgeItem> {
    const { item } = entry;
    return {
        n,
        source: item.source === 'location' ? 'visit' : item.source,
        when: formatInZone(new Date(item.occurredAt * 1000), context.zone),
        ...(item.title ? { title: item.title.slice(0, 150) } : {}),
        text: item.body.slice(0, 300),
        ...(item.location ? { location: item.location.slice(0, 150) } : {}),
        ...(context.people.length ? { people: context.people.slice(0, 6) } : {}),
    };
}

// MARK: - Background job

let dirtyUsers = new Set<string>();
let soonTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * New uploads from this user: within a minute or so, link them to the people and places
 * their notebooks already have (rules only; the model waits for the next full pass).
 */
export function markGraphDirty(userId: string, delayMs = 60_000): void {
    dirtyUsers.add(userId);
    if (soonTimer) return;
    soonTimer = setTimeout(() => {
        soonTimer = null;
        void graphTick();
    }, delayMs);
    soonTimer.unref?.();
}

/** A data page was added to the notebook or its filter changed: items to judge may be new. */
export function requestGraphPass(notebookId: string): void {
    void requestFullGraphPass(notebookId).catch((error) =>
        console.error('[Graph] Could not ask for a pass:', error),
    );
}

/**
 * Runs what each notebook needs: a full pass (rules, then the model) at most every 15
 * minutes, when it's never run, has items the model hasn't seen, was asked for one, or
 * hasn't run for 30 minutes; otherwise, after uploads, a rules-only incremental pass.
 */
export async function graphTick(now = new Date()): Promise<void> {
    if (running) return;
    running = true;
    const dirty = dirtyUsers;
    dirtyUsers = new Set();
    try {
        await pruneGraphUsage(dayOf(daysAgo(now, 7))).catch(() => {});
        for (const notebookId of await findGraphNotebookIds()) {
            try {
                const state = await findGraphState(notebookId);
                const sinceFull = state?.lastFullRunAt
                    ? now.getTime() - state.lastFullRunAt.getTime()
                    : Infinity;
                const full =
                    sinceFull >= REFRESH_MS ||
                    (sinceFull >= FULL_PASS_GAP_MS &&
                        (!!state?.fullPassRequested ||
                            (graphModelAvailable() && (state?.pendingItems ?? 0) > 0)));
                if (full) {
                    await runGraphPass(notebookId, now);
                } else if (dirty.size) {
                    const pages = await findDeviceDataPagesInNotebook(notebookId);
                    if (pages.some((page) => dirty.has(page.userId)))
                        await runIncrementalGraphPass(notebookId, now);
                }
            } catch (error) {
                console.error(`[Graph] Linking notebook ${notebookId} failed:`, error);
            }
        }
    } finally {
        running = false;
    }
}

export function startGraphLinking(intervalMs = 5 * 60 * 1000): () => void {
    const timer = setInterval(() => void graphTick(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

// MARK: - Reading

/** Each visible item's node, with the page that shows it. */
async function visibleItems(
    ids: string[],
    slices: DataPageSlice[],
): Promise<{ visible: Map<string, { item: MacDataItem; slice: DataPageSlice }> }> {
    const byOwner = new Map<string, string[]>();
    for (const id of ids) {
        const parsed = parseDataGraphItemNodeId(id);
        if (parsed)
            byOwner.set(parsed.ownerId, [...(byOwner.get(parsed.ownerId) ?? []), parsed.itemId]);
    }
    const visible = new Map<string, { item: MacDataItem; slice: DataPageSlice }>();
    for (const [ownerId, itemIds] of byOwner) {
        const owned = slices.filter((slice) => slice.ownerId === ownerId);
        for (const item of await findDeviceItemsByIds(ownerId, itemIds, 240)) {
            const slice = owned.find((s) => s.source === item.source && s.match(item));
            if (slice) visible.set(dataGraphItemNodeId(ownerId, item.id), { item, slice });
        }
    }
    return { visible };
}

/**
 * The notebook's graph as this person may see it: only items its data pages show them
 * now, and people, places and topics linked to those. Empty for non-members.
 */
export async function getDataGraph(
    notebookId: string,
    viewerId: string,
    options: { from?: number; to?: number } = {},
): Promise<DataGraph> {
    const status = async () => {
        const state = await findGraphState(notebookId);
        return {
            ...(state?.backfilledAt ? { backfilledAt: state.backfilledAt.toISOString() } : {}),
            ...(state?.lastRunAt ? { lastRunAt: state.lastRunAt.toISOString() } : {}),
            modelLinks: graphModelAvailable(),
        };
    };
    const slices = await dataPageSlicesFor(viewerId, notebookId);
    if (slices.length === 0) return { nodes: [], links: [], status: await status() };

    const shared = isNotebookShared(await findNotebookByIdUnsafe(notebookId));
    const [stored, allHubs] = await Promise.all([
        findGraphLinks(notebookId, ['active'], MAX_LINKS_READ),
        findGraphNodes(notebookId),
    ]);
    const links = stored
        .map((link) => linkForReaders(link, shared))
        .filter((link): link is GraphLinkDocument => !!link);
    const hubs = allHubs.filter((hub) => hubForReaders(hub, shared));
    const itemIds = new Set<string>();
    for (const link of links) {
        if (link.a.startsWith('item:')) itemIds.add(link.a);
        if (link.b.startsWith('item:')) itemIds.add(link.b);
    }
    // Hidden items (another filter, deleted) just aren't shown; nothing is deleted here.
    const { visible } = await visibleItems([...itemIds], slices);

    // Date range, then the newest items up to the viewer's limit.
    const inRange = [...visible].filter(([, { item }]) => {
        if (item.source === 'contacts') return true;
        if (options.from !== undefined && (item.endAt ?? item.occurredAt) < options.from)
            return false;
        return options.to === undefined || item.occurredAt <= options.to;
    });
    inRange.sort((a, b) => b[1].item.occurredAt - a[1].item.occurredAt);
    const kept = new Map(inRange.slice(0, MAX_GRAPH_ITEMS));
    const hubById = new Map(hubs.map((hub) => [hub.id, hub]));
    const shows = (id: string) => kept.has(id) || (!id.startsWith('item:') && hubById.has(id));

    const outLinks: DataGraphLink[] = [];
    const linked = new Set<string>();
    for (const link of links) {
        if (!shows(link.a) || !shows(link.b)) continue;
        // Every link has an item at one end at least.
        if (!kept.has(link.a) && !kept.has(link.b)) continue;
        linked.add(link.a);
        linked.add(link.b);
        outLinks.push({
            id: link._id,
            source: link.a,
            target: link.b,
            kind: link.kind,
            confidence: link.confidence,
            evidence: link.evidence,
            madeBy: link.madeBy,
        });
    }
    const nodes: DataGraphNode[] = [];
    for (const id of linked) {
        const entry = kept.get(id);
        if (entry) {
            nodes.push(itemNode(id, entry.item, entry.slice, viewerId));
            continue;
        }
        const hub = hubById.get(id)!;
        nodes.push({ id, kind: hub.kind, label: hub.label });
    }
    return {
        nodes,
        links: outLinks,
        status: await status(),
        ...(inRange.length > kept.size || stored.length >= MAX_LINKS_READ
            ? { truncated: true }
            : {}),
    };
}

function itemNode(
    id: string,
    item: MacDataItem,
    slice: DataPageSlice,
    viewerId: string,
): DataGraphNode {
    const label =
        item.title?.trim() ||
        item.sender?.replace(/<[^>]+>/, '').trim() ||
        item.location?.trim() ||
        item.source;
    return {
        id,
        kind: 'item',
        label: label.slice(0, 120),
        source: item.source,
        itemId: item.id,
        pageId: slice.pageId,
        ...(slice.ownerId !== viewerId ? { ownerName: slice.ownerName } : {}),
        ...(item.source !== 'contacts' ? { at: item.occurredAt } : {}),
        ...(item.endAt !== undefined ? { endAt: item.endAt } : {}),
        ...(item.body ? { snippet: item.body.slice(0, 200) } : {}),
        ...(item.location ? { location: item.location } : {}),
    };
}

// MARK: - Bots

export interface LinkedForBot {
    id?: string;
    kind: string;
    source?: string;
    title?: string;
    when?: string;
    link: string;
    via?: string;
}

/**
 * What an item a bot reads is linked to in this notebook: linked items its pages share
 * with this reader, the people, places and topics, and a few other items in the same
 * topic or place. Never anything from another notebook.
 */
export async function linkedForBot(
    notebookId: string,
    slices: DataPageSlice[],
    ownerId: string,
    itemId: string,
    timeZone: string,
    limit = 10,
): Promise<LinkedForBot[]> {
    const nodeId = dataGraphItemNodeId(ownerId, itemId);
    const shared = isNotebookShared(await findNotebookByIdUnsafe(notebookId));
    const readable = (links: GraphLinkDocument[]) =>
        links
            .map((link) => linkForReaders(link, shared))
            .filter((link): link is GraphLinkDocument => !!link);
    const direct = readable(await findGraphLinksOf(notebookId, nodeId, 40));
    if (direct.length === 0) return [];
    const hubs = new Map(
        (await findGraphNodes(notebookId))
            .filter((hub) => hubForReaders(hub, shared))
            .map((hub) => [hub.id, hub]),
    );
    const other = (link: GraphLinkDocument, from: string) => (link.a === from ? link.b : link.a);

    // A few more items through each topic or place.
    const viaHub = new Map<string, { hub: string; link: GraphLinkDocument }>();
    for (const link of direct) {
        const hubId = other(link, nodeId);
        const hub = hubs.get(hubId);
        if (!hub || hub.kind === 'person') continue;
        const around = readable(await findGraphLinksOf(notebookId, hubId, 8));
        for (const next of around.slice(0, 4)) {
            const id = other(next, hubId);
            if (id !== nodeId && !viaHub.has(id)) viaHub.set(id, { hub: hub.label, link: next });
        }
    }
    const itemIds = [...direct.map((link) => other(link, nodeId)), ...viaHub.keys()].filter((id) =>
        id.startsWith('item:'),
    );
    const { visible } = await visibleItems([...new Set(itemIds)], slices);
    const describe = (item: MacDataItem) => ({
        id: item.id,
        source: item.source,
        ...(item.title ? { title: item.title.slice(0, 120) } : {}),
        when: formatInZone(new Date(item.occurredAt * 1000), timeZone),
    });

    const out: LinkedForBot[] = [];
    for (const link of direct.sort((a, b) => b.confidence - a.confidence)) {
        const id = other(link, nodeId);
        const entry = visible.get(id);
        if (entry) out.push({ kind: 'item', ...describe(entry.item), link: link.evidence });
        else if (hubs.has(id))
            out.push({ kind: hubs.get(id)!.kind, title: hubs.get(id)!.label, link: link.evidence });
    }
    for (const [id, { hub, link }] of viaHub) {
        const entry = visible.get(id);
        if (entry && !out.some((o) => o.id === entry.item.id))
            out.push({ kind: 'item', ...describe(entry.item), link: link.evidence, via: hub });
    }
    return out.slice(0, limit);
}
