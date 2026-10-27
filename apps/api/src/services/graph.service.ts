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
    deleteGraphLinks,
    deleteGraphNodes,
    deleteStaleRuleLinks,
    findDecidedPairs,
    findGraphLinks,
    findGraphLinksOf,
    findGraphNodes,
    findGraphState,
    finishGraphPass,
    linkKey,
    rejectGraphPairs,
    releaseGraphPass,
    saveGraphLinks,
    saveGraphNodes,
    type GraphLinkDocument,
    type GraphLinkInput,
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
    modelCandidates,
    ruleGraph,
    topicNodeId,
    type Candidate,
    type GraphItem,
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
 *    it): first the last 30 days (and the next 30 for events), then new uploads.
 * 2. Rules make certain links (same place, same time, driving time, one person across
 *    phones and emails). A batched model pass judges likely pairs and sorts items into
 *    topics; its links are saved when it is confident enough.
 * 3. Links, people, places and topics belong to the notebook. They're built and read only
 *    from that notebook's pages; the same email in two notebooks is linked separately.
 * 4. Reading checks every item against the pages again, so an item a filter stops
 *    sharing drops out at once; its links are cleaned up then.
 * 5. Someone can remove a link; it is never made again for the same pair.
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
const BACKFILL_CALLS = 4;
const INCREMENTAL_CALLS = 2;
const BACKFILL_ITEMS_PER_PASS = BACKFILL_CALLS * TOPIC_ITEMS_PER_CALL;
const LEASE_MS = 10 * 60 * 1000;
/** Rules run again this often even without uploads (filters change, items expire). */
const REFRESH_MS = 30 * 60 * 1000;
/** At most this many items in the viewer. */
export const MAX_GRAPH_ITEMS = 2_000;

export interface GraphPassResult {
    items: number;
    ruleLinks: number;
    modelLinks: number;
    modelCalls: number;
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
 * One linking pass for a notebook with a Graph page: rule links over the whole window,
 * then the model over a bounded batch of items it hasn't seen. Null when the notebook
 * has no Graph page or another pass is running.
 */
export async function runGraphPass(
    notebookId: string,
    now = new Date(),
): Promise<GraphPassResult | null> {
    if (!(await findGraphPage(notebookId))) return null;
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

        // Rules: certain links, rebuilt over the whole window every pass.
        const rules = ruleGraph(items, {
            travel: shared ? new Map() : await travelFor(items),
            shared,
        });
        await saveGraphNodes(notebookId, rules.nodes);
        const ruleLinks = await saveGraphLinks(notebookId, rules.links);
        await deleteStaleRuleLinks(
            notebookId,
            new Set(rules.links.map((link) => linkKey(notebookId, link.a, link.b))),
        );
        const ruleNodeIds = new Set(rules.nodes.map((node) => node.id));
        const staleHubs = (await findGraphNodes(notebookId, ['person', 'place']))
            .map((node) => node.id)
            .filter((id) => !ruleNodeIds.has(id));
        await deleteGraphNodes(notebookId, staleHubs);

        // The model: during the backfill, the next batch of older items; after it, what
        // was uploaded since the last pass.
        const backfilling = !state?.backfilledAt;
        let focus: GraphItem[];
        let backfillBefore: number | undefined;
        let backfilled = !backfilling;
        if (backfilling) {
            const before = state?.backfillBefore ?? Infinity;
            const pending = items.filter(
                (entry) => entry.item.source !== 'contacts' && entry.item.occurredAt < before,
            );
            focus = pending.slice(0, BACKFILL_ITEMS_PER_PASS);
            // Without a model there's nothing more to backfill: rules cover the whole window.
            backfilled = !graphModelAvailable() || pending.length <= focus.length;
            backfillBefore = focus.length ? focus.at(-1)!.item.occurredAt : before;
        } else {
            const fresh = new Set(
                (
                    await loadNotebookItems(
                        slices,
                        nowSeconds - WINDOW_DAYS * DAY,
                        nowSeconds + UPCOMING_DAYS * DAY,
                        state?.cursor,
                    )
                ).map((entry) => entry.nodeId),
            );
            focus = items.filter((entry) => fresh.has(entry.nodeId));
        }
        const model = graphModelAvailable()
            ? await modelPass(notebookId, items, focus, rules, {
                  shared,
                  maxCalls: backfilling ? BACKFILL_CALLS : INCREMENTAL_CALLS,
              })
            : { links: 0, calls: 0 };

        await finishGraphPass(notebookId, {
            lastRunAt: now,
            // The cursor stays at the backfill's start until it's done, so uploads during it
            // are linked after.
            cursor: backfilling && state?.cursor ? state.cursor : now,
            ...(backfilled && backfilling ? { backfilledAt: now } : {}),
            ...(backfilling && !backfilled && backfillBefore !== undefined
                ? { backfillBefore }
                : {}),
        });
        return {
            items: items.length,
            ruleLinks,
            modelLinks: model.links,
            modelCalls: model.calls,
            backfilled,
        };
    } catch (error) {
        await releaseGraphPass(notebookId).catch(() => {});
        throw error;
    }
}

/** Asks the model about the focus items in batches; saves confident links and topics. */
async function modelPass(
    notebookId: string,
    items: GraphItem[],
    focus: GraphItem[],
    rules: RuleGraph,
    options: { shared: boolean; maxCalls: number },
): Promise<{ links: number; calls: number }> {
    if (focus.length === 0) return { links: 0, calls: 0 };
    const focusIds = new Set(focus.map((entry) => entry.nodeId));
    const candidates = modelCandidates(
        notebookId,
        items,
        focusIds,
        { rules, decided: await findDecidedPairs(notebookId) },
        PAIRS_PER_CALL * options.maxCalls,
    );
    const topicItems = focus.filter((entry) => entry.item.source !== 'health');
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
    for (let call = 0; call < options.maxCalls; call++) {
        const pairs = candidates.slice(call * PAIRS_PER_CALL, (call + 1) * PAIRS_PER_CALL);
        const chunk = topicItems.slice(
            call * TOPIC_ITEMS_PER_CALL,
            (call + 1) * TOPIC_ITEMS_PER_CALL,
        );
        if (pairs.length === 0 && chunk.length === 0) break;
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
    }
    return { links: saved, calls };
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

/** New uploads from this user: link them in their notebooks within a minute or so. */
export function markGraphDirty(userId: string, delayMs = 60_000): void {
    dirtyUsers.add(userId);
    if (soonTimer) return;
    soonTimer = setTimeout(() => {
        soonTimer = null;
        void graphTick();
    }, delayMs);
    soonTimer.unref?.();
}

/** Runs a pass for every notebook that needs one: never linked, backfilling, stale or new uploads. */
export async function graphTick(now = new Date()): Promise<void> {
    if (running) return;
    running = true;
    const dirty = dirtyUsers;
    dirtyUsers = new Set();
    try {
        for (const notebookId of await findGraphNotebookIds()) {
            try {
                const state = await findGraphState(notebookId);
                let due =
                    !state?.backfilledAt ||
                    !state.lastRunAt ||
                    now.getTime() - state.lastRunAt.getTime() > REFRESH_MS;
                if (!due && dirty.size) {
                    const pages = await findDeviceDataPagesInNotebook(notebookId);
                    due = pages.some((page) => dirty.has(page.userId));
                }
                if (due) await runGraphPass(notebookId, now);
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
): Promise<{
    visible: Map<string, { item: MacDataItem; slice: DataPageSlice }>;
    gone: Set<string>;
}> {
    const byOwner = new Map<string, string[]>();
    for (const id of ids) {
        const parsed = parseDataGraphItemNodeId(id);
        if (parsed)
            byOwner.set(parsed.ownerId, [...(byOwner.get(parsed.ownerId) ?? []), parsed.itemId]);
    }
    const visible = new Map<string, { item: MacDataItem; slice: DataPageSlice }>();
    const found = new Set<string>();
    for (const [ownerId, itemIds] of byOwner) {
        const owned = slices.filter((slice) => slice.ownerId === ownerId);
        for (const item of await findDeviceItemsByIds(ownerId, itemIds, 240)) {
            const id = dataGraphItemNodeId(ownerId, item.id);
            found.add(id);
            const slice = owned.find((s) => s.source === item.source && s.match(item));
            if (slice) visible.set(id, { item, slice });
        }
    }
    return { visible, gone: new Set(ids.filter((id) => !found.has(id))) };
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

    const [links, hubs] = await Promise.all([
        findGraphLinks(notebookId),
        findGraphNodes(notebookId),
    ]);
    const itemIds = new Set<string>();
    for (const link of links) {
        if (link.a.startsWith('item:')) itemIds.add(link.a);
        if (link.b.startsWith('item:')) itemIds.add(link.b);
    }
    const { visible, gone } = await visibleItems([...itemIds], slices);
    void cleanUpHidden(notebookId, links, visible, gone).catch((error) =>
        console.error('[Graph] Cleanup failed:', error),
    );

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
        ...(inRange.length > kept.size ? { truncated: true } : {}),
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

/**
 * Lazily drops links to items the notebook no longer shares: deleted, or outside every
 * page's filter (checked against the notebook's pages, not just this reader's view).
 */
async function cleanUpHidden(
    notebookId: string,
    links: GraphLinkDocument[],
    visible: Map<string, unknown>,
    gone: Set<string>,
): Promise<void> {
    const hidden = new Set(gone);
    const unseen = [...new Set(links.flatMap((link) => [link.a, link.b]))].filter(
        (id) => id.startsWith('item:') && !visible.has(id) && !gone.has(id),
    );
    if (unseen.length) {
        const recheck = await visibleItems(unseen, await notebookDataSlices(notebookId));
        for (const id of unseen) if (!recheck.visible.has(id)) hidden.add(id);
    }
    if (hidden.size === 0) return;
    await deleteGraphLinks(
        notebookId,
        links.filter((link) => hidden.has(link.a) || hidden.has(link.b)).map((link) => link._id),
    );
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
    const direct = await findGraphLinksOf(notebookId, nodeId, 40);
    if (direct.length === 0) return [];
    const hubs = new Map((await findGraphNodes(notebookId)).map((hub) => [hub.id, hub]));
    const other = (link: GraphLinkDocument, from: string) => (link.a === from ? link.b : link.a);

    // A few more items through each topic or place.
    const viaHub = new Map<string, { hub: string; link: GraphLinkDocument }>();
    for (const link of direct) {
        const hubId = other(link, nodeId);
        const hub = hubs.get(hubId);
        if (!hub || hub.kind === 'person') continue;
        const around = await findGraphLinksOf(notebookId, hubId, 8);
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
