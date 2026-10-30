import {
    dataGraphItemNodeId,
    contactIdentityIndex,
    resolveMessageSender,
    normalizePersonHandle,
    type ContactIdentityIndex,
    type MessageSender,
    dataGraphReasonWeight,
    dataGraphRelationFamily,
    isNotebookShared,
    parseDataGraphItemNodeId,
    type DataGraph,
    type DataGraphExample,
    type DataGraphLink,
    type DataGraphNode,
    type DataGraphReason,
    type MacDataItem,
    type TravelEstimate,
} from '@maple/shared';
import {
    claimGraphPass,
    deleteActiveRelationsOfKind,
    deleteGraphNodes,
    deleteGraphRelationsGoneBefore,
    deleteGraphRelationsTouching,
    deleteStaleRuleRelations,
    findCountedItems,
    findDecidedPairs,
    findGraphNodes,
    findGraphRelations,
    findGraphRelationsForPairs,
    findGraphRelationsOf,
    findGraphRelationsToCheck,
    findGraphState,
    findJudgedItems,
    finishGraphPass,
    interactionEvidence,
    interactionInput,
    interactionRelation,
    isSymmetricRelationship,
    linkKey,
    markGraphRelationsChecked,
    markItemsCounted,
    markItemsJudged,
    migrateLegacyGraphLinks,
    partTotals,
    pruneCountedItems,
    pruneGraphUsage,
    pruneJudgedItems,
    pruneRejectedPairs,
    rejectGraphPairs,
    relationId,
    relationKey,
    releaseGraphCall,
    releaseGraphPass,
    requestFullGraphPass,
    reserveGraphCall,
    saveGraphNodes,
    saveGraphRelations,
    addInteractions,
    setGraphRelationEvidence,
    MAX_RELATION_ITEMS,
    type GraphNodeDocument,
    type GraphRelationDocument,
    type GraphRelationInput,
    type InteractionTally,
} from '../repositories/graph.repo';
import { findDeviceItemsByIds, findDeviceItemsForGraph } from '../repositories/device-item.repo';
import { findTravelEstimates } from '../repositories/travel-estimate.repo';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import {
    findAboutMePage,
    findDeviceDataPagesInNotebook,
    findGraphNotebookIds,
    findGraphPage,
} from '../repositories/page.repo';
import { listEntities, listRelations } from '../repositories/profile.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import {
    dataPageSlicesFor,
    notebookDataSlices,
    type DataPageSlice,
} from './device-data-access.service';
import { sharedRefusal } from './about-me.service';
import {
    aboutMeRelationships,
    happeningNodeId,
    incrementalRuleLinks,
    isSyntheticHandle,
    matchPersonByName,
    modelCandidates,
    normalizeHandle,
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
 * 2. Two nodes are joined by one line that holds every reason they're connected:
 *    - relationships between people (spouse, child…), from contact cards and About me;
 *    - interactions: one per pair (a member and someone), counting their messages, emails
 *      and events, with the first and last time and a few examples;
 *    - item relations: same place, same time, driving time, same plan, same topic, and
 *      events (calendar ones, or happenings the model found) as hubs their items and
 *      people link to, so a party isn't a tangle of pairwise lines.
 * 3. Rules make certain relations. A full pass rebuilds them at most every 15 minutes;
 *    between full passes, new uploads are linked to the people and places already known,
 *    and added to the interactions.
 * 4. A batched model pass judges likely pairs, sorts items into topics and finds
 *    happenings. It remembers which items it has seen, so items that arrive later (a new
 *    page, a wider filter, a big upload) are judged in later passes, within a daily budget.
 * 5. Everything belongs to the notebook. It's built and read only from that notebook's
 *    pages; the same email in two notebooks is linked separately.
 * 6. Reading checks every item against the pages again, so an item a filter stops
 *    sharing drops out at once (with the reasons that rest on it). Nothing is deleted on
 *    read: model relations go only once an item has been gone from the device data for
 *    30 days.
 * 7. In a shared notebook, reads hide relationships (private facts), travel, private
 *    topics, happenings and reasons, even ones saved while it was private; the first pass
 *    after it's shared scrubs them.
 * 8. Someone can remove one reason, or a whole line; it is never made again for the same
 *    pair, even when a person's id changes because two of them merged.
 */

const DAY = 24 * 60 * 60;
const WINDOW_DAYS = 30;
/** Upcoming events are linked too (an appointment booked at the office). */
const UPCOMING_DAYS = 30;
const MAX_ITEMS_PER_PAGE = 1_500;
const MAX_ITEMS = 4_000;
/** Messages, emails and events counted per page for interactions (no bodies are read). */
const MAX_COUNTED_PER_PAGE = 10_000;
const COUNTED_SOURCES = new Set(['imessage', 'mail', 'calendar']);
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
/** A model relation goes once one of its items has been missing this long. */
const GONE_DAYS = 30;
const LINKS_CHECKED_PER_PASS = 500;
/** Rejected pairs and seen items this old have left the window. */
const FORGET_DAYS = 90;
/** At most this many items in the viewer, and relations read for it. */
export const MAX_GRAPH_ITEMS = 2_000;
const MAX_LINKS_READ = 10_000;
/** At most this many relationships from About me. */
const MAX_ABOUT_ME_RELATIONS = 500;

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
    bounds: { perPage: number; total: number; bodyChars: number } = {
        perPage: MAX_ITEMS_PER_PAGE,
        total: MAX_ITEMS,
        bodyChars: BODY_CHARS,
    },
): Promise<GraphItem[]> {
    const seen = new Set<string>();
    const items: GraphItem[] = [];
    for (const slice of slices) {
        const contacts = slice.source === 'contacts';
        const found = await findDeviceItemsForGraph(slice.ownerId, slice.source, {
            ...(contacts ? {} : { from, to }),
            ...(updatedSince ? { updatedSince } : {}),
            limit: bounds.perPage,
            bodyChars: bounds.bodyChars,
        });
        for (const item of found) {
            const nodeId = dataGraphItemNodeId(slice.ownerId, item.id);
            // Two pages can show the same item; it's one node.
            if (seen.has(nodeId) || !slice.match(item)) continue;
            seen.add(nodeId);
            items.push({ nodeId, ownerId: slice.ownerId, pageId: slice.pageId, item });
        }
    }
    return items.sort((a, b) => b.item.occurredAt - a.item.occurredAt).slice(0, bounds.total);
}

/**
 * The messages, emails and events the full pass counts: the whole window, past the cap
 * the rest of the graph has, so counting them again incrementally adds up the same.
 */
function loadCountedItems(slices: DataPageSlice[], from: number, to: number) {
    return loadNotebookItems(
        slices.filter((slice) => COUNTED_SOURCES.has(slice.source)),
        from,
        to,
        undefined,
        { perPage: MAX_COUNTED_PER_PAGE, total: Infinity, bodyChars: 0 },
    );
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
 * What readers of the notebook may see of a relation, as it is now (it may have been
 * saved while the notebook was private). In a shared notebook: no relationships (private
 * facts), no travel (it says where someone was), and no private reasons. Null hides it.
 */
function relationForReaders(
    relation: GraphRelationDocument,
    shared: boolean,
): GraphRelationDocument | null {
    if (!shared) return relation;
    if (relation.kind === 'travel' || relation.kind === 'relationship') return null;
    return isPrivateMatter(relation.evidence) ? { ...relation, evidence: 'Related' } : relation;
}

/** A hub readers may see; private topics and happenings stay out of shared notebooks. */
function hubForReaders(hub: GraphNodeDocument, shared: boolean): boolean {
    return !(
        shared &&
        (hub.kind === 'topic' || hub.kind === 'event') &&
        isPrivateMatter(hub.label)
    );
}

/** Cleans what was saved while the notebook was private, now that it's shared. */
async function scrubForSharing(notebookId: string): Promise<void> {
    const privateHubs = (await findGraphNodes(notebookId, ['topic', 'event']))
        .filter((hub) => isPrivateMatter(hub.label))
        .map((hub) => hub.id);
    await deleteGraphRelationsTouching(notebookId, privateHubs);
    await deleteGraphNodes(notebookId, privateHubs);
    await deleteActiveRelationsOfKind(notebookId, ['relationship']);
    const stored = await findGraphRelations(notebookId, ['active', 'removed'], 50_000);
    await setGraphRelationEvidence(
        notebookId,
        stored
            .filter(
                (relation) =>
                    relation.kind === 'travel' ||
                    relation.kind === 'relationship' ||
                    isPrivateMatter(relation.evidence),
            )
            .map((relation) => relation._id),
        'Related',
    );
}

/** People and places stored for the notebook, as the rules look them up. */
function knownHubs(stored: GraphNodeDocument[]): KnownHubs {
    const personOf = new Map<string, string>();
    const people = new Map<string, string>();
    const ownerPerson = new Map<string, string>();
    const cardPerson = new Map<string, string>();
    const before = new Map<string, Pick<GraphNodeDocument, 'handles' | 'contactIds'>>();
    for (const node of stored) {
        if (node.kind !== 'person') continue;
        people.set(node.id, node.label);
        before.set(node.id, { handles: node.handles ?? [], contactIds: node.contactIds ?? [] });
        if (node.ownerId) ownerPerson.set(node.ownerId, node.id);
        for (const handle of node.handles ?? []) {
            const earlier = personOf.get(handle);
            if (!earlier || node.id < earlier) personOf.set(handle, node.id);
        }
        for (const card of node.contactIds ?? []) {
            const earlier = cardPerson.get(card);
            if (!earlier || node.id < earlier) cardPerson.set(card, node.id);
        }
    }
    return {
        personOf,
        people,
        ownerPerson,
        cardPerson,
        stored: before,
        places: stored.filter((node) => node.kind === 'place'),
    };
}

/**
 * Whether a relation would bring back one someone removed: the same relation on the same
 * pair, or any relation on a pair whose older one-per-pair link was removed. Ends are
 * compared under people's current ids, so a merge doesn't undo a removal.
 */
async function removalCheck(
    notebookId: string,
    hubs: Array<Pick<GraphNodeInput, 'id' | 'aliases'>>,
    removedDocs?: GraphRelationDocument[],
): Promise<(relation: GraphRelationInput) => boolean> {
    const current = new Map<string, string>();
    for (const hub of hubs) for (const alias of hub.aliases ?? []) current.set(alias, hub.id);
    const canonical = (id: string) => current.get(id) ?? id;
    const keyOf = (relation: Pick<GraphRelationInput, 'a' | 'b' | 'kind' | 'type' | 'from'>) => {
        const a = canonical(relation.a);
        const b = canonical(relation.b);
        const pair = linkKey(notebookId, a, b);
        return {
            pair,
            relation: `${pair}|${relationKey({ ...relation, a, b, from: relation.from && canonical(relation.from) })}`,
        };
    };
    const removedRelations = new Set<string>();
    const removedPairs = new Set<string>();
    for (const doc of removedDocs ??
        (await findGraphRelations(notebookId, ['removed'], MAX_REMOVALS_READ))) {
        const key = keyOf(doc);
        removedRelations.add(key.relation);
        if (doc.blocksPair) removedPairs.add(key.pair);
    }
    return (relation) => {
        const key = keyOf(relation);
        return removedPairs.has(key.pair) || removedRelations.has(key.relation);
    };
}

/** Relationships the notebook's About me states, between people the graph has. */
async function aboutMeRelations(
    notebookId: string,
    people: GraphNodeInput[],
): Promise<GraphRelationInput[]> {
    const page = await findAboutMePage(notebookId);
    if (!page?.userId) return [];
    const scope = { userId: page.userId, notebookId };
    const [entities, relations] = await Promise.all([listEntities(scope), listRelations(scope)]);
    return aboutMeRelationships({
        ownerId: page.userId,
        entities,
        relations: relations.slice(0, MAX_ABOUT_ME_RELATIONS),
        people: people.filter((node) => node.kind === 'person'),
    });
}

/** At most this many removals are read (a notebook has far fewer). */
const MAX_REMOVALS_READ = 50_000;

const tallyRelation = (tally: InteractionTally) => interactionRelation(tally);

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY * 1000);
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/**
 * One full linking pass for a notebook with a Graph page: rule relations over the whole
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
        // Links from before relations become relations first, removals included.
        const migrated =
            state?.relationsMigratedAt ??
            ((await migrateLegacyGraphLinks(notebookId)) ? now : undefined);
        const notebook = await findNotebookByIdUnsafe(notebookId);
        const shared = isNotebookShared(notebook);
        const slices = await notebookDataSlices(notebookId);
        const nowSeconds = now.getTime() / 1000;
        const from = nowSeconds - WINDOW_DAYS * DAY;
        const to = nowSeconds + UPCOMING_DAYS * DAY;
        const items = await loadNotebookItems(slices, from, to);
        const countedItems = await loadCountedItems(slices, from, to);

        // Rules: certain relations, rebuilt over the whole window. People and places keep
        // the ids they had.
        const stored = await findGraphNodes(notebookId, ['person', 'place']);
        const storedById = new Map(stored.map((node) => [node.id, node]));
        const rules = ruleGraph(items, {
            travel: shared ? new Map() : await travelFor(items),
            shared,
            known: knownHubs(stored),
            owners: new Map(slices.map((slice) => [slice.ownerId, slice.ownerName])),
            interactionItems: countedItems,
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
        const removedDocs = await findGraphRelations(notebookId, ['removed'], MAX_REMOVALS_READ);
        const removed = await removalCheck(notebookId, [...stored, ...nodes], removedDocs);
        await saveGraphNodes(notebookId, nodes);
        // People merged into another keep no node of their own (their id is an alias now),
        // and people no longer found go, unless a removal names them (should they come
        // back, their old id keeps the removal).
        const current = new Set(nodes.map((node) => node.id));
        const aliased = new Set(nodes.flatMap((node) => node.aliases ?? []));
        const removalEnds = new Set(removedDocs.flatMap((doc) => [doc.a, doc.b]));
        const gone = stored
            .filter(
                (node) =>
                    node.kind === 'person' &&
                    !current.has(node.id) &&
                    (merged.has(node.id) || aliased.has(node.id) || !removalEnds.has(node.id)),
            )
            .map((node) => node.id);
        await deleteGraphRelationsTouching(notebookId, gone);
        await deleteGraphNodes(notebookId, [...new Set([...merged, ...gone])]);
        const made = [
            ...rules.links,
            ...rules.interactions.map(interactionInput),
            // Relationships are private facts: About me's only in a private notebook.
            ...(shared ? [] : await aboutMeRelations(notebookId, nodes)),
        ];
        const allowed = made.filter((relation) => !removed(relation));
        const ruleLinks = await saveGraphRelations(notebookId, allowed);
        // What wasn't made again goes, and so does what a removal now covers (a merged
        // person's relation that was removed under their other id).
        await deleteStaleRuleRelations(
            notebookId,
            new Set(allowed.map((relation) => relationId(notebookId, relation))),
        );
        // Every item the interactions now count, so incremental passes don't count it again.
        await markItemsCounted(
            notebookId,
            rules.interactions.flatMap((tally) => tally.items.map((item) => item.id)),
            now,
        );
        if (shared && !state?.scrubbedShared) await scrubForSharing(notebookId);

        const model = await modelPass(notebookId, items, rules, {
            shared,
            userId: page.userId,
            now,
            people: nodes.filter((node) => node.kind === 'person'),
            removed,
        });
        await checkGoneItems(notebookId, now);
        await pruneRejectedPairs(notebookId, daysAgo(now, FORGET_DAYS));
        await pruneJudgedItems(notebookId, daysAgo(now, FORGET_DAYS));
        await pruneCountedItems(notebookId, daysAgo(now, FORGET_DAYS));

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
                ...(migrated && !state?.relationsMigratedAt
                    ? { relationsMigratedAt: migrated }
                    : {}),
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
 * places the notebook already has, and adds new messages, emails and events to their
 * interactions. Rules only, no model. Null when there's nothing to do it against yet, or
 * another pass is running.
 */
export async function runIncrementalGraphPass(
    notebookId: string,
    now = new Date(),
): Promise<{ items: number; ruleLinks: number } | null> {
    if (!(await findGraphPage(notebookId))) return null;
    const state = await findGraphState(notebookId);
    if (!state?.lastFullRunAt || !state.cursor || !state.relationsMigratedAt) return null;
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
        // Only items never counted: an item uploaded again (an edited event, one in the
        // future) is already in its tally.
        const already = await findCountedItems(
            notebookId,
            rules.interactions.flatMap((tally) => tally.items.map((item) => item.id)),
        );
        const tallies = rules.interactions
            .filter((tally) => !removed(tallyRelation(tally)))
            .map((tally) => ({
                ...tally,
                items: tally.items.filter((item) => !already.has(item.id)),
            }));
        const ruleLinks =
            (await saveGraphRelations(
                notebookId,
                rules.links.filter((relation) => !removed(relation)),
            )) + (await addInteractions(notebookId, tallies));
        await markItemsCounted(
            notebookId,
            tallies.flatMap((tally) => tally.items.map((item) => item.id)),
            now,
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
 * pairs involving them, their topics, and happenings they're about. Saves confident
 * relations, topics and happenings, and notes the items as seen only once their call
 * succeeded.
 */
async function modelPass(
    notebookId: string,
    items: GraphItem[],
    rules: RuleGraph,
    options: {
        shared: boolean;
        userId: string;
        now: Date;
        people: GraphNodeInput[];
        removed: (relation: GraphRelationInput) => boolean;
    },
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

    const hubs = await findGraphNodes(notebookId, ['topic', 'event']);
    const topicNames = new Map(
        hubs.filter((hub) => hub.kind === 'topic').map((topic) => [topic.id, topic.label]),
    );
    const events: Array<{ id: string; label: string; at?: number }> = hubs.filter(
        (hub) => hub.kind === 'event',
    );
    const people = new Map(options.people.map((n) => [n.id, n.label]));
    const owners = new Set(options.people.filter((n) => n.ownerId).map((n) => n.id));
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

        const links: GraphRelationInput[] = [];
        const newHubs: GraphNodeInput[] = [];

        // Happenings first: items about the same one meet at its hub (its calendar event,
        // or a node of its own), instead of being linked pair by pair.
        const covered = new Set<string>();
        for (const happening of judgement.happenings ?? []) {
            if (happening.confidence < TOPIC_CONFIDENCE) continue;
            if (options.shared && isPrivateMatter(happening.name)) continue;
            const members = happening.items
                .map((n) => entries[n])
                .filter((entry): entry is GraphItem => !!entry);
            if (members.length < 2) continue;
            const calendar = members.find((entry) => entry.item.source === 'calendar');
            let hub: string;
            let label: string;
            if (calendar) {
                hub = calendar.nodeId;
                label = calendar.item.title?.trim() || happening.name;
            } else {
                const at = Math.min(...members.map((entry) => entry.item.occurredAt));
                hub = happeningNodeId(happening.name, at, events);
                label = happening.name;
                if (!events.some((event) => event.id === hub)) {
                    events.push({ id: hub, label, at });
                    newHubs.push({ id: hub, kind: 'event', label, at });
                }
            }
            for (const member of members) {
                for (const other of members)
                    if (other !== member)
                        covered.add(linkKey(notebookId, member.nodeId, other.nodeId));
                if (member.nodeId === hub) continue;
                links.push({
                    a: member.nodeId,
                    b: hub,
                    kind: 'part_of',
                    confidence: happening.confidence,
                    evidence: `About ${label}`,
                    madeBy: 'model',
                });
            }
            const evidence = members
                .map((entry) => entry.nodeId)
                .filter((id) => id !== hub)
                .slice(0, MAX_RELATION_ITEMS);
            const list = options.people.map((person) => ({ id: person.id, label: person.label }));
            for (const name of happening.people) {
                const person = matchPersonByName(name, list);
                if (!person || owners.has(person)) continue;
                links.push({
                    a: hub,
                    b: person,
                    kind: 'attendee',
                    confidence: happening.confidence,
                    evidence: `${people.get(person)} was there`,
                    madeBy: 'model',
                    items: evidence.length ? evidence : [hub],
                });
            }
        }

        const rejected: Array<[string, string]> = [];
        for (const verdict of judgement.pairs) {
            const pair = pairs[verdict.p];
            if (!pair) continue;
            const key = linkKey(notebookId, pair.a.nodeId, pair.b.nodeId);
            if (
                verdict.related &&
                verdict.confidence >= AUTO_LINK_CONFIDENCE &&
                !covered.has(key)
            ) {
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
                // Unrelated, or joined through a happening's hub: either way, decided.
                rejected.push([pair.a.nodeId, pair.b.nodeId]);
            }
        }
        for (const topic of judgement.topics) {
            if (topic.confidence < TOPIC_CONFIDENCE) continue;
            if (options.shared && isPrivateMatter(topic.name)) continue;
            const id = topicNodeId(topic.name);
            const known = topicNames.has(id);
            // A new topic needs two items; an existing one takes a single new item.
            if (!known && topic.items.length < 2) continue;
            if (!known) {
                topicNames.set(id, topic.name);
                newHubs.push({ id, kind: 'topic', label: topic.name });
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
        await saveGraphNodes(notebookId, newHubs);
        saved += await saveGraphRelations(
            notebookId,
            links.filter((relation) => !options.removed(relation)),
        );
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
 * Looks up the items of the model relations checked longest ago. One whose item is gone
 * from the device data (not just hidden by a filter) goes after 30 days; model relations
 * can't be rebuilt, so a filter change or a source moving devices never removes them.
 */
async function checkGoneItems(notebookId: string, now: Date): Promise<void> {
    const batch = await findGraphRelationsToCheck(notebookId, LINKS_CHECKED_PER_PASS);
    if (batch.length === 0) return;
    const byOwner = new Map<string, Set<string>>();
    for (const relation of batch) {
        for (const end of [relation.a, relation.b, ...(relation.items ?? [])]) {
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
    const missing = (relation: GraphRelationDocument) => {
        const ends = [relation.a, relation.b].filter((end) => end.startsWith('item:'));
        if (ends.length) return ends.some((end) => !found.has(end));
        // Between two hubs (someone at a happening): gone when all its items are.
        const evidence = (relation.items ?? []).filter((id) => id.startsWith('item:'));
        return evidence.length > 0 && evidence.every((id) => !found.has(id));
    };
    await markGraphRelationsChecked(
        notebookId,
        batch.filter((relation) => !missing(relation)).map((relation) => relation._id),
        batch.filter(missing).map((relation) => relation._id),
        now,
    );
    await deleteGraphRelationsGoneBefore(notebookId, daysAgo(now, GONE_DAYS));
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
                            !state?.relationsMigratedAt ||
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

type VisibleItem = { item: MacDataItem; slice: DataPageSlice };

/** Each visible item's node, with the page that shows it. */
async function visibleItems(
    ids: string[],
    slices: DataPageSlice[],
): Promise<Map<string, VisibleItem>> {
    const byOwner = new Map<string, string[]>();
    for (const id of new Set(ids)) {
        const parsed = parseDataGraphItemNodeId(id);
        if (parsed)
            byOwner.set(parsed.ownerId, [...(byOwner.get(parsed.ownerId) ?? []), parsed.itemId]);
    }
    const visible = new Map<string, VisibleItem>();
    for (const [ownerId, itemIds] of byOwner) {
        const owned = slices.filter((slice) => slice.ownerId === ownerId);
        if (owned.length === 0) continue;
        for (const item of await findDeviceItemsByIds(ownerId, itemIds, 240)) {
            const slice = owned.find((s) => s.source === item.source && s.match(item));
            if (slice) visible.set(dataGraphItemNodeId(ownerId, item.id), { item, slice });
        }
    }
    return visible;
}

const isItem = (id: string) => id.startsWith('item:');

const isInteraction = (relation: Pick<GraphRelationDocument, 'kind'>) =>
    dataGraphRelationFamily(relation.kind) === 'interaction';

/** The items to look up to tell which parts of an interaction a reader sees. */
const partSamples = (relation: GraphRelationDocument) =>
    (relation.parts ?? []).flatMap((part) => part.samples);

/**
 * An interaction as this reader sees it: only the chats, mailboxes and calendars their
 * pages show (a part is seen when one of its newest items is), with the count, first and
 * last time of those. Null when they see none of it.
 */
function interactionForReader(
    relation: GraphRelationDocument,
    visible: ReadonlyMap<string, unknown>,
): GraphRelationDocument | null {
    if (!isInteraction(relation) || !relation.parts?.length) return relation;
    const seen = relation.parts.filter((part) => part.samples.some((id) => visible.has(id)));
    if (seen.length === 0) return null;
    const totals = partTotals(seen);
    return {
        ...relation,
        ...totals,
        evidence: interactionEvidence(
            relation.kind as Parameters<typeof interactionEvidence>[0],
            totals.count,
        ),
    };
}

/**
 * Two members' tallies of the same pair (Alex's texts with Jen and Jen's with Alex) as one
 * reason: the bigger count, not the sum, since it's mostly the same conversation.
 */
function mergeTwins(relations: GraphRelationDocument[]): GraphRelationDocument[] {
    const out: GraphRelationDocument[] = [];
    const byKind = new Map<string, GraphRelationDocument>();
    for (const relation of relations) {
        if (!isInteraction(relation)) {
            out.push(relation);
            continue;
        }
        const key = `${relation.pair}|${relation.kind}`;
        const earlier = byKind.get(key);
        if (!earlier) {
            byKind.set(key, relation);
            continue;
        }
        const count = Math.max(earlier.count ?? 0, relation.count ?? 0);
        byKind.set(key, {
            ...((relation.count ?? 0) > (earlier.count ?? 0) ? relation : earlier),
            _id: earlier._id < relation._id ? earlier._id : relation._id,
            count,
            firstAt: Math.min(earlier.firstAt ?? Infinity, relation.firstAt ?? Infinity),
            lastAt: Math.max(earlier.lastAt ?? -Infinity, relation.lastAt ?? -Infinity),
            items: [...new Set([...(earlier.items ?? []), ...(relation.items ?? [])])].slice(
                0,
                MAX_RELATION_ITEMS,
            ),
            evidence: interactionEvidence(
                relation.kind as Parameters<typeof interactionEvidence>[0],
                count,
            ),
        });
    }
    return [...out, ...byKind.values()];
}

/** The other end of a relation. */
const otherEnd = (relation: Pick<GraphRelationDocument, 'a' | 'b'>, from: string) =>
    relation.a === from ? relation.b : relation.a;

/** A reason as readers see it, with the examples they may see. */
function toReason(relation: GraphRelationDocument, examples: DataGraphExample[]): DataGraphReason {
    return {
        id: relation._id,
        kind: relation.kind,
        ...(relation.type ? { type: relation.type } : {}),
        ...(relation.from ? { from: relation.from } : {}),
        ...(relation.to ? { to: relation.to } : {}),
        madeBy: relation.madeBy,
        confidence: relation.confidence,
        evidence: relation.evidence,
        ...(relation.count !== undefined ? { count: relation.count } : {}),
        ...(relation.firstAt !== undefined ? { firstAt: relation.firstAt } : {}),
        ...(relation.lastAt !== undefined ? { lastAt: relation.lastAt } : {}),
        ...(examples.length ? { examples } : {}),
    };
}

const FAMILY_RANK = { relationship: 0, interaction: 1, item: 2 } as const;

/** Relationships first ("wife"), then interactions, then the rest; strongest first in each. */
function byStrength(
    x: Pick<DataGraphReason, 'kind' | 'confidence' | 'count'>,
    y: Pick<DataGraphReason, 'kind' | 'confidence' | 'count'>,
): number {
    const family =
        FAMILY_RANK[dataGraphRelationFamily(x.kind)] - FAMILY_RANK[dataGraphRelationFamily(y.kind)];
    return family || dataGraphReasonWeight(y) - dataGraphReasonWeight(x);
}

/** One line per pair, its reasons strongest first. */
function toLink(pair: string, a: string, b: string, reasons: DataGraphReason[]): DataGraphLink {
    const sorted = [...reasons].sort(byStrength);
    const top = sorted[0]!;
    return {
        id: pair,
        source: a,
        target: b,
        reasons: sorted,
        weight:
            Math.round(sorted.reduce((sum, r) => sum + dataGraphReasonWeight(r), 0) * 100) / 100,
        kind: top.kind,
        confidence: top.confidence,
        evidence: top.evidence,
        madeBy: top.madeBy,
    };
}

const stringList = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [])
        .map((entry) =>
            typeof entry === 'string'
                ? entry
                : typeof (entry as { value?: unknown })?.value === 'string'
                  ? (entry as { value: string }).value
                  : null,
        )
        .filter((entry): entry is string => !!entry);

/** A person, with what their contact cards (the ones the reader may see) say. */
function personNode(
    hub: GraphNodeDocument,
    cards: VisibleItem[],
    shared: boolean,
    viewerId: string,
): DataGraphNode {
    const node: DataGraphNode = { id: hub.id, kind: 'person', label: hub.label };
    if (hub.ownerId) node.isOwner = true;
    const card =
        cards.find((c) => c.item.extra?.isMe === true && hub.ownerId) ??
        cards.find((c) => c.item.extra?.isMe !== true) ??
        cards[0];
    if (card) {
        node.itemId = card.item.id;
        node.pageId = card.slice.pageId;
        if (card.slice.ownerId !== viewerId) node.ownerName = card.slice.ownerName;
        const extra = card.item.extra ?? {};
        if (typeof extra['birthday'] === 'string') node.birthday = extra['birthday'];
        if (typeof extra['organization'] === 'string') node.organization = extra['organization'];
        if (typeof extra['jobTitle'] === 'string') node.jobTitle = extra['jobTitle'];
        if (!shared && Array.isArray(extra['relations'])) {
            const relations = (extra['relations'] as Array<{ label?: unknown; name?: unknown }>)
                .filter((r) => typeof r?.name === 'string')
                .slice(0, 20)
                .map((r) => ({
                    ...(typeof r.label === 'string' ? { label: r.label } : {}),
                    name: r.name as string,
                }));
            if (relations.length) node.relations = relations;
        }
    }
    const handles = new Set<string>();
    for (const c of cards)
        for (const value of [
            ...stringList(c.item.extra?.['phones']),
            ...stringList(c.item.extra?.['emails']),
        ])
            handles.add(value);
    // Without a card, a private notebook still shows how they were reached.
    if (handles.size === 0 && !shared)
        for (const handle of hub.handles ?? []) if (!isSyntheticHandle(handle)) handles.add(handle);
    if (handles.size) node.handles = [...handles].slice(0, 12);
    return node;
}

/**
 * The notebook's graph as this person may see it: only items its data pages show them
 * now, and the people, places, topics and happenings joined to those, one line per pair
 * with every reason. Empty for non-members.
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
    const [stored, allHubs, removed] = await Promise.all([
        findGraphRelations(notebookId, ['active'], MAX_LINKS_READ),
        findGraphNodes(notebookId),
        findGraphRelations(notebookId, ['removed'], 5_000),
    ]);
    const readable = stored
        .map((relation) => relationForReaders(relation, shared))
        .filter((relation): relation is GraphRelationDocument => !!relation);
    const hubById = new Map(
        allHubs.filter((hub) => hubForReaders(hub, shared)).map((hub) => [hub.id, hub]),
    );
    // A card someone unlinked from a person (before cards were people) isn't theirs.
    const unlinkedCards = new Set(
        removed.filter((doc) => doc.blocksPair).map((doc) => `${doc.a}|${doc.b}`),
    );
    const cardsOf = (hub: GraphNodeDocument) =>
        (hub.contactIds ?? []).filter(
            (card) => !unlinkedCards.has(card < hub.id ? `${card}|${hub.id}` : `${hub.id}|${card}`),
        );

    // Look up every item the relations rest on, and the people's cards.
    const itemIds = new Set<string>();
    for (const relation of readable) {
        for (const id of [
            relation.a,
            relation.b,
            ...(relation.items ?? []),
            ...partSamples(relation),
        ])
            if (isItem(id)) itemIds.add(id);
        for (const end of [relation.a, relation.b]) {
            const hub = hubById.get(end);
            if (hub?.kind === 'person') for (const card of cardsOf(hub)) itemIds.add(card);
        }
    }
    // Hidden items (another filter, deleted) just aren't shown; nothing is deleted here.
    const visible = await visibleItems([...itemIds], slices);
    const contactsByOwner = new Map<string, MacDataItem[]>();
    for (const { item, slice } of visible.values()) {
        if (item.source === 'contacts')
            contactsByOwner.set(slice.ownerId, [
                ...(contactsByOwner.get(slice.ownerId) ?? []),
                item,
            ]);
    }
    const indexes = new Map<string, ContactIdentityIndex>();
    const senderOf = (entry: VisibleItem) => {
        if (!indexes.has(entry.slice.ownerId))
            indexes.set(
                entry.slice.ownerId,
                contactIdentityIndex(contactsByOwner.get(entry.slice.ownerId) ?? []),
            );
        return resolveMessageSender(entry.item, indexes.get(entry.slice.ownerId)!);
    };
    // Interactions count only what this reader sees.
    const relations = mergeTwins(
        readable
            .map((relation) => interactionForReader(relation, visible))
            .filter((relation): relation is GraphRelationDocument => !!relation),
    );

    // Date range, then the newest items up to the viewer's limit.
    const ends = new Set(relations.flatMap((relation) => [relation.a, relation.b]));
    const inRange = [...visible].filter(([id, { item }]) => {
        if (item.source === 'contacts' || !ends.has(id)) return false;
        if (options.from !== undefined && (item.endAt ?? item.occurredAt) < options.from)
            return false;
        return options.to === undefined || item.occurredAt <= options.to;
    });
    inRange.sort((a, b) => b[1].item.occurredAt - a[1].item.occurredAt);
    const kept = new Map(inRange.slice(0, MAX_GRAPH_ITEMS));
    const spanInRange = (relation: GraphRelationDocument) => {
        if (
            options.from !== undefined &&
            relation.lastAt !== undefined &&
            relation.lastAt < options.from
        )
            return false;
        return !(
            options.to !== undefined &&
            relation.firstAt !== undefined &&
            relation.firstAt > options.to
        );
    };
    const shows = (relation: GraphRelationDocument) => {
        for (const end of [relation.a, relation.b]) {
            if (isItem(end) ? !kept.has(end) : !hubById.has(end)) return false;
        }
        if (isItem(relation.a) || isItem(relation.b)) return true;
        // Between two hubs: it rests on items the reader may see (or on About me).
        if (!spanInRange(relation)) return false;
        // Interactions were already cut to what the reader sees, examples or not.
        if (isInteraction(relation)) return true;
        const evidence = relation.items ?? [];
        return evidence.length === 0
            ? relation.madeBy === 'user'
            : evidence.some((id) => visible.has(id));
    };
    const example = (id: string): DataGraphExample | null => {
        const entry = visible.get(id);
        if (!entry) return null;
        const node = itemNode(id, entry.item, entry.slice, viewerId, senderOf(entry));
        return {
            id,
            label: node.label,
            ...(node.source ? { source: node.source } : {}),
            itemId: entry.item.id,
            pageId: entry.slice.pageId,
            ...(node.at !== undefined ? { at: node.at } : {}),
        };
    };

    const byPair = new Map<string, { a: string; b: string; reasons: DataGraphReason[] }>();
    for (const relation of relations) {
        if (!shows(relation)) continue;
        const examples = (relation.items ?? [])
            .filter((id) => id !== relation.a && id !== relation.b)
            .map(example)
            .filter((e): e is DataGraphExample => !!e);
        const line = byPair.get(relation.pair) ?? { a: relation.a, b: relation.b, reasons: [] };
        line.reasons.push(toReason(relation, examples));
        byPair.set(relation.pair, line);
    }
    const links = [...byPair].map(([pair, line]) => toLink(pair, line.a, line.b, line.reasons));
    const linked = new Set(links.flatMap((link) => [link.source, link.target]));
    const nodes: DataGraphNode[] = [];
    const peopleByContact = new Map<string, Set<string>>();
    const peopleByHandle = new Map<string, Set<string>>();
    const peopleByOwner = new Map<string, Set<string>>();
    const addPerson = (index: Map<string, Set<string>>, key: string, id: string) => {
        const ids = index.get(key) ?? new Set<string>();
        ids.add(id);
        index.set(key, ids);
    };
    for (const hub of hubById.values()) {
        if (hub.kind !== 'person' || !linked.has(hub.id)) continue;
        const cards = cardsOf(hub)
            .map((card) => visible.get(card))
            .filter((card): card is VisibleItem => !!card);
        for (const card of cards)
            addPerson(
                peopleByContact,
                dataGraphItemNodeId(card.slice.ownerId, card.item.id),
                hub.id,
            );
        for (const handle of personNode(hub, cards, shared, viewerId).handles ?? []) {
            const normalized = normalizePersonHandle(handle);
            if (normalized) addPerson(peopleByHandle, normalized, hub.id);
        }
        if (hub.ownerId) addPerson(peopleByOwner, hub.ownerId, hub.id);
    }
    for (const id of linked) {
        const entry = kept.get(id);
        if (entry) {
            const sender = senderOf(entry);
            const candidates = sender?.ambiguous
                ? undefined
                : entry.item.isFromMe
                  ? peopleByOwner.get(entry.slice.ownerId)
                  : sender?.contactId
                    ? peopleByContact.get(
                          dataGraphItemNodeId(entry.slice.ownerId, sender.contactId),
                      )
                    : sender?.handle
                      ? peopleByHandle.get(sender.handle)
                      : undefined;
            nodes.push(
                itemNode(
                    id,
                    entry.item,
                    entry.slice,
                    viewerId,
                    sender,
                    candidates?.size === 1 ? [...candidates][0] : undefined,
                ),
            );
            continue;
        }
        const hub = hubById.get(id)!;
        if (hub.kind === 'person') {
            const cards = cardsOf(hub)
                .map((card) => visible.get(card))
                .filter((c): c is VisibleItem => !!c);
            nodes.push(personNode(hub, cards, shared, viewerId));
        } else {
            nodes.push({
                id,
                kind: hub.kind,
                label: hub.label,
                ...(hub.at !== undefined ? { at: hub.at } : {}),
            });
        }
    }
    return {
        nodes,
        links,
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
    sender?: MessageSender | null,
    senderPersonId?: string,
): DataGraphNode {
    const messageLabel = sender
        ? item.source === 'mail'
            ? `${sender.name} · ${item.title?.trim() || '(no subject)'}`
            : sender.name
        : undefined;
    const label =
        messageLabel ||
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
        ...(sender ? { senderName: sender.name } : {}),
        ...(sender?.handle ? { senderHandle: sender.handle } : {}),
        ...(senderPersonId ? { senderPersonId } : {}),
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
    /** Every reason, joined ("wife; 214 messages, last today"). */
    link: string;
    reasons?: string[];
    via?: string;
}

/** "today", "yesterday", "3 days ago", or the day. */
function lastTime(at: number, timeZone: string, now = Date.now() / 1000): string {
    const day = (seconds: number) => formatInZone(new Date(seconds * 1000), timeZone).slice(0, 10);
    const date = day(at);
    if (at > now) return `next ${date}`;
    const days = Math.round((Date.parse(day(now)) - Date.parse(date)) / (DAY * 1000));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return days < 14 ? `${days} days ago` : date;
}

/** One reason in a bot's words, from the owner's side when it's about them. */
function reasonForBot(
    relation: GraphRelationDocument,
    context: { me?: string; timeZone: string },
): string {
    const mine =
        relation.from === context.me ||
        (isSymmetricRelationship(relation.type) && relation.to === context.me);
    if (relation.kind === 'relationship' && relation.type && mine)
        return relation.type.replace(/_/g, ' ');
    if (dataGraphRelationFamily(relation.kind) === 'interaction' && relation.lastAt !== undefined)
        return `${relation.evidence}, last ${lastTime(relation.lastAt, context.timeZone)}`;
    return relation.evidence;
}

/**
 * What an item a bot reads is connected to in this notebook: linked items its pages
 * share with this reader, the people in it with every reason they're connected to the
 * item's owner ("Jen — wife; 214 messages, last today"), places, topics and happenings,
 * and a few other items through those. Never anything from another notebook.
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
    const readable = (docs: GraphRelationDocument[]) =>
        docs
            .map((relation) => relationForReaders(relation, shared))
            .filter((relation): relation is GraphRelationDocument => !!relation);
    const direct = readable(await findGraphRelationsOf(notebookId, nodeId, 40));
    const hubs = new Map(
        (await findGraphNodes(notebookId))
            .filter((hub) => hubForReaders(hub, shared))
            .map((hub) => [hub.id, hub]),
    );
    const me = [...hubs.values()].find(
        (hub) => hub.kind === 'person' && hub.ownerId === ownerId,
    )?.id;

    // The people in the item, through their phones and emails.
    const self = await visibleItems([nodeId], slices);
    const read = self.get(nodeId)?.item;
    const personOf = new Map<string, string>();
    for (const hub of hubs.values())
        if (hub.kind === 'person')
            for (const handle of hub.handles ?? []) personOf.set(handle, hub.id);
    const people = new Set<string>();
    if (read && read.source !== 'contacts') {
        for (const raw of [read.sender, ...read.participants]) {
            const person = personOf.get(normalizeHandle(raw) ?? '');
            if (person && person !== me) people.add(person);
        }
    }
    for (const relation of direct) {
        const other = otherEnd(relation, nodeId);
        if (hubs.get(other)?.kind === 'person' && other !== me) people.add(other);
    }
    if (direct.length === 0 && people.size === 0) return [];

    // A few more items through each topic, place or happening.
    const viaHub = new Map<string, { hub: string; relation: GraphRelationDocument }>();
    for (const relation of direct) {
        const hubId = otherEnd(relation, nodeId);
        const hub = hubs.get(hubId);
        if (!hub || hub.kind === 'person') continue;
        const around = readable(await findGraphRelationsOf(notebookId, hubId, 8));
        for (const next of around.slice(0, 4)) {
            const id = otherEnd(next, hubId);
            if (id !== nodeId && isItem(id) && !viaHub.has(id))
                viaHub.set(id, { hub: hub.label, relation: next });
        }
    }
    const itemIds = [
        ...direct.map((relation) => otherEnd(relation, nodeId)),
        ...viaHub.keys(),
    ].filter(isItem);
    const visible = await visibleItems(itemIds, slices);
    const describe = (item: MacDataItem) => ({
        id: item.id,
        source: item.source,
        ...(item.title ? { title: item.title.slice(0, 120) } : {}),
        when: formatInZone(new Date(item.occurredAt * 1000), timeZone),
    });
    const entry = (
        base: Omit<LinkedForBot, 'link' | 'reasons'>,
        reasons: string[],
    ): LinkedForBot => ({
        ...base,
        link: [...new Set(reasons)].join('; '),
        reasons: [...new Set(reasons)],
    });

    const out: LinkedForBot[] = [];
    // People first: who they are to the owner, and how much they talk.
    const ownerRelations = me
        ? readable(
              await findGraphRelationsForPairs(
                  notebookId,
                  [...people].map((person) => linkKey(notebookId, me, person)),
              ),
          )
        : [];
    // Through the same filter the viewer has: only what this reader's pages show.
    const seenParts = await visibleItems(ownerRelations.flatMap(partSamples), slices);
    const toOwner = mergeTwins(
        ownerRelations
            .map((relation) => interactionForReader(relation, seenParts))
            .filter((relation): relation is GraphRelationDocument => !!relation),
    );
    for (const person of people) {
        const hub = hubs.get(person);
        if (!hub) continue;
        const reasons = [
            ...toOwner
                .filter((relation) => otherEnd(relation, me!) === person)
                .sort(byStrength)
                .map((relation) => reasonForBot(relation, { me, timeZone })),
            ...direct
                .filter((relation) => otherEnd(relation, nodeId) === person)
                .map((relation) => relation.evidence),
        ];
        if (reasons.length) out.push(entry({ kind: 'person', title: hub.label }, reasons));
    }
    // Then linked items and hubs, strongest first, every reason on the pair.
    const others = new Map<string, GraphRelationDocument[]>();
    for (const relation of direct) {
        const other = otherEnd(relation, nodeId);
        if (people.has(other)) continue;
        others.set(other, [...(others.get(other) ?? []), relation]);
    }
    const strength = (list: GraphRelationDocument[]) =>
        list.reduce((sum, relation) => sum + dataGraphReasonWeight(relation), 0);
    for (const [id, list] of [...others].sort((x, y) => strength(y[1]) - strength(x[1]))) {
        const reasons = list
            .sort((x, y) => y.confidence - x.confidence)
            .map((relation) => relation.evidence);
        const found = visible.get(id);
        if (found) out.push(entry({ kind: 'item', ...describe(found.item) }, reasons));
        else if (hubs.has(id))
            out.push(entry({ kind: hubs.get(id)!.kind, title: hubs.get(id)!.label }, reasons));
    }
    for (const [id, { hub, relation }] of viaHub) {
        const found = visible.get(id);
        if (found && !out.some((o) => o.id === found.item.id))
            out.push(
                entry({ kind: 'item', ...describe(found.item), via: hub }, [relation.evidence]),
            );
    }
    return out.slice(0, limit);
}
