import { getDb } from '../db/client';
import {
    parseDataGraphItemNodeId,
    type DataGraphLinkKind,
    type DataGraphMadeBy,
    type DataGraphNodeKind,
    type DataGraphRelationKind,
} from '@maple/shared';

// The connected-data graph, stored per notebook: every document carries its notebookId
// and every lookup is by it, so one notebook's relations, people, places and topics never
// reach another's. Items themselves aren't stored here, only their node ids
// (`item:<ownerId>:<itemId>`); what a reader sees is checked against the notebook's data
// pages when the graph is read.
//
// A pair of nodes can have many relations (reasons): one document per relation in
// `graph_relations`, keyed `${notebookId}|${a}|${b}|${key}`. The older `graph_links`
// collection (one link per pair) is only read once, by the migration, and kept as it was.

/** `active` is shown; `removed` was taken out by someone and is never added again;
 * `rejected` is a pair the model judged unrelated (or already joined by a happening), so
 * it isn't asked again. */
export type GraphRelationStatus = 'active' | 'removed' | 'rejected';

export interface GraphRelationDocument {
    _id: string; // `${pair}|${key}`
    notebookId: string;
    /** `${notebookId}|${a}|${b}`, a < b: the line it belongs to. */
    pair: string;
    a: string;
    b: string;
    kind: DataGraphRelationKind;
    /** Tells this relation from others of its kind on the pair (`relationship:spouse`). */
    key: string;
    type?: string;
    /** Relationships: `to` is `from`'s `type`. Interactions: from the data's owner. */
    from?: string;
    to?: string;
    /** Interactions: the member whose data was counted (each member's tally is its own). */
    owner?: string;
    confidence: number;
    evidence: string;
    madeBy: DataGraphMadeBy;
    /** A few item node ids it rests on, newest first. */
    items?: string[];
    count?: number;
    firstAt?: number;
    lastAt?: number;
    /** Interactions: the count split by chat, mailbox or calendar, so readers who see only
     * some of them get only their share. */
    parts?: InteractionPart[];
    status: GraphRelationStatus;
    /** A removal kept from the one-link-per-pair graph: nothing joins this pair again. */
    blocksPair?: boolean;
    createdAt: Date;
    updatedAt: Date;
    removedBy?: string;
    /** Model relations: when their items were last looked up, and since when one is missing. */
    checkedAt?: Date;
    goneSince?: Date;
}

/** The older one-link-per-pair document, read only by the migration. */
export interface LegacyGraphLinkDocument {
    _id: string; // `${notebookId}|${a}|${b}`
    notebookId: string;
    a: string;
    b: string;
    kind: DataGraphLinkKind;
    confidence: number;
    evidence: string;
    madeBy: 'rule' | 'model';
    status: GraphRelationStatus;
    createdAt: Date;
    updatedAt: Date;
    removedBy?: string;
    checkedAt?: Date;
    goneSince?: Date;
    /** Copied into graph_relations. */
    migratedAt?: Date;
}

export interface GraphNodeDocument {
    _id: string; // `${notebookId}|${id}`
    notebookId: string;
    id: string;
    kind: Exclude<DataGraphNodeKind, 'item'>;
    label: string;
    /** Places: the addresses seen there, normalized, to match event locations. */
    addresses?: string[];
    /** Places: the keys events match on (address, street line, name). */
    keys?: string[];
    /** People: their phones and emails, so the same person keeps the same id. */
    handles?: string[];
    /** Earlier ids of this node (two people merged into one), so removals still hold. */
    aliases?: string[];
    /** People: their contact cards' item node ids (the card's details are the person's). */
    contactIds?: string[];
    /** People: the member whose own data this is ("me" on their pages). */
    ownerId?: string;
    /** Events the model found: when. */
    at?: number;
    updatedAt: Date;
}

export interface GraphStateDocument {
    _id: string; // notebookId
    backfilledAt?: Date;
    lastRunAt?: Date;
    /** The last full pass (rules over the window, then the model). */
    lastFullRunAt?: Date;
    /** Items uploaded after this are new to the graph. */
    cursor?: Date;
    /** Items in the window the model hasn't seen yet, after the last full pass. */
    pendingItems?: number;
    /** A page was added or a filter changed: run a full pass at the next chance. */
    fullPassRequested?: boolean;
    /** Text saved while the notebook was private has been cleaned for sharing. */
    scrubbedShared?: boolean;
    /** The one-link-per-pair links were copied into relations. */
    relationsMigratedAt?: Date;
    /** Another instance is linking this notebook until then. */
    leaseUntil?: Date;
}

/** An item the model has seen in this notebook (`_id`: `${notebookId}|${nodeId}`). */
export interface GraphJudgedDocument {
    _id: string;
    notebookId: string;
    judgedAt: Date;
}

/** Model calls made for one notebook or user on one day (`_id`: `${scope}|${day}`). */
export interface GraphUsageDocument {
    _id: string;
    day: string;
    calls: number;
}

/** An item counted in the graph's interactions (`_id`: `${notebookId}|${nodeId}`). */
export interface GraphCountedDocument {
    _id: string;
    notebookId: string;
    countedAt: Date;
}

/**
 * One chat's, mailbox's or calendar's share of an interaction. Readers see a part when they
 * can see one of its sample items (page filters work by chat, mailbox and calendar).
 */
export interface InteractionPart {
    key: string;
    count: number;
    firstAt: number;
    lastAt: number;
    /** The newest items' node ids. */
    samples: string[];
}

/** A relation to save: its two ends, what it is and why. */
export interface GraphRelationInput {
    a: string;
    b: string;
    kind: DataGraphRelationKind;
    type?: string;
    from?: string;
    to?: string;
    owner?: string;
    confidence: number;
    evidence: string;
    madeBy: DataGraphMadeBy;
    items?: string[];
    count?: number;
    firstAt?: number;
    lastAt?: number;
    parts?: InteractionPart[];
}

/** One counted item: its node id, when, and which chat, mailbox or calendar it's in. */
export interface TalliedItem {
    id: string;
    at: number;
    part: string;
}

/** New messages, emails or events between the data's owner and a person. */
export interface InteractionTally {
    /** The owner's person node. */
    a: string;
    /** The other person. */
    b: string;
    /** The member whose data it is. */
    ownerId: string;
    kind: 'messages_with' | 'emails_with' | 'met_with';
    items: TalliedItem[];
}

/** Most example items kept on a relation. */
export const MAX_RELATION_ITEMS = 5;
/** Most parts an interaction keeps; the smallest share one part ("*"). */
export const MAX_INTERACTION_PARTS = 20;
const PART_SAMPLES = 2;
const OTHER_PART = '*';

const relations = () => getDb().collection<GraphRelationDocument>('graph_relations');
const legacyLinks = () => getDb().collection<LegacyGraphLinkDocument>('graph_links');
const nodes = () => getDb().collection<GraphNodeDocument>('graph_nodes');
const states = () => getDb().collection<GraphStateDocument>('graph_state');
const judged = () => getDb().collection<GraphJudgedDocument>('graph_judged');
const usage = () => getDb().collection<GraphUsageDocument>('graph_usage');
const counted = () => getDb().collection<GraphCountedDocument>('graph_counted');

/** One line per pair of nodes, whichever way round it's given. */
export function linkKey(notebookId: string, x: string, y: string): string {
    const [a, b] = x < y ? [x, y] : [y, x];
    return `${notebookId}|${a}|${b}`;
}

/**
 * Relations whose meaning doesn't depend on which way round they are. "Wife", "brother"
 * and the like say which end is which, so they keep their direction.
 */
const SYMMETRIC = new Set([
    'spouse',
    'partner',
    'sibling',
    'friend',
    'best_friend',
    'coworker',
    'colleague',
    'cousin',
    'related',
]);

export function isSymmetricRelationship(type: string | undefined): boolean {
    return SYMMETRIC.has(type ?? 'related');
}

const isInteraction = (kind: DataGraphRelationKind) =>
    kind === 'messages_with' || kind === 'emails_with' || kind === 'met_with';

/**
 * What tells a relation from the pair's others: its kind; for relationships the type (and
 * the direction, unless it's symmetric); for interactions whose data was counted.
 */
export function relationKey(
    input: Pick<GraphRelationInput, 'kind' | 'type' | 'from' | 'a' | 'b' | 'owner'>,
) {
    if (isInteraction(input.kind)) return input.owner ? `${input.kind}:${input.owner}` : input.kind;
    if (input.kind !== 'relationship') return input.kind;
    const type = input.type ?? 'related';
    if (SYMMETRIC.has(type)) return `relationship:${type}`;
    const [a] = input.a < input.b ? [input.a] : [input.b];
    return `relationship:${type}:${input.from === a ? 'ab' : 'ba'}`;
}

/** A symmetric relationship always reads from the smaller id, so it doesn't flip. */
function steady(input: GraphRelationInput): GraphRelationInput {
    if (input.kind !== 'relationship' || !isSymmetricRelationship(input.type)) return input;
    const [from, to] = input.a < input.b ? [input.a, input.b] : [input.b, input.a];
    return { ...input, from, to };
}

export function relationId(notebookId: string, input: GraphRelationInput): string {
    return `${linkKey(notebookId, input.a, input.b)}|${relationKey(input)}`;
}

const madeByRank: Record<DataGraphMadeBy, number> = { model: 0, rule: 1, user: 2 };

/** A model relation never replaces a rule's or the user's; higher confidence wins otherwise. */
function outranks(
    next: GraphRelationInput,
    current: Pick<GraphRelationDocument, 'madeBy' | 'confidence'>,
): boolean {
    if (madeByRank[next.madeBy] !== madeByRank[current.madeBy])
        return madeByRank[next.madeBy] > madeByRank[current.madeBy];
    // Rules and the user restate the truth each pass (an interaction's count changes).
    if (next.madeBy !== 'model') return true;
    return next.confidence > current.confidence;
}

const round = (n: number) => Math.round(n * 100) / 100;

function relationFields(notebookId: string, input: GraphRelationInput) {
    const [a, b] = input.a < input.b ? [input.a, input.b] : [input.b, input.a];
    return {
        notebookId,
        pair: linkKey(notebookId, a, b),
        a,
        b,
        kind: input.kind,
        key: relationKey(input),
        ...(input.type ? { type: input.type } : {}),
        ...(input.from ? { from: input.from } : {}),
        ...(input.to ? { to: input.to } : {}),
        ...(input.owner ? { owner: input.owner } : {}),
        confidence: round(input.confidence),
        evidence: input.evidence.slice(0, 200),
        madeBy: input.madeBy,
        ...(input.items?.length ? { items: input.items.slice(0, MAX_RELATION_ITEMS) } : {}),
        ...(input.count !== undefined ? { count: input.count } : {}),
        ...(input.firstAt !== undefined ? { firstAt: input.firstAt } : {}),
        ...(input.lastAt !== undefined ? { lastAt: input.lastAt } : {}),
        ...(input.parts?.length ? { parts: input.parts.slice(0, MAX_INTERACTION_PARTS) } : {}),
        status: 'active' as const,
    };
}

/** Fields a relation may stop having, to unset when it's saved again without them. */
const OPTIONAL_FIELDS = ['items', 'count', 'firstAt', 'lastAt', 'parts'] as const;

/** Whether saving would change anything someone could see. */
function differs(current: GraphRelationDocument, next: ReturnType<typeof relationFields>) {
    return (
        current.status !== 'active' ||
        current.confidence !== next.confidence ||
        current.evidence !== next.evidence ||
        current.madeBy !== next.madeBy ||
        current.from !== next.from ||
        current.to !== next.to ||
        current.count !== next.count ||
        current.firstAt !== next.firstAt ||
        current.lastAt !== next.lastAt ||
        (current.items ?? []).join(',') !== (next.items ?? []).join(',') ||
        JSON.stringify(current.parts ?? []) !== JSON.stringify(next.parts ?? [])
    );
}

/** Two inputs for the same relationship: the stronger one, resting on both's items. */
function mergeInputs(earlier: GraphRelationInput, next: GraphRelationInput): GraphRelationInput {
    const winner = outranks(next, earlier) ? next : earlier;
    if (winner.kind !== 'relationship') return winner;
    const items = [...new Set([...(earlier.items ?? []), ...(next.items ?? [])])].sort();
    return items.length ? { ...winner, items } : winner;
}

async function findByIds(notebookId: string, ids: string[]) {
    const found = new Map<string, GraphRelationDocument>();
    for (let i = 0; i < ids.length; i += 500) {
        for (const doc of await relations()
            .find({ _id: { $in: ids.slice(i, i + 500) }, notebookId })
            .toArray())
            found.set(doc._id, doc);
    }
    return found;
}

type RelationWrite = {
    updateOne: {
        filter: Record<string, unknown>;
        update: Record<string, unknown>;
        upsert: boolean;
    };
};

async function writeRelations(writes: RelationWrite[]): Promise<number> {
    if (writes.length === 0) return 0;
    for (let i = 0; i < writes.length; i += 1000) {
        try {
            await relations().bulkWrite(writes.slice(i, i + 1000) as never, { ordered: false });
        } catch (error) {
            // A racing insert of the same relation: the other one stands.
            if ((error as { code?: number }).code !== 11000) throw error;
        }
    }
    return writes.length;
}

/**
 * Saves relations. One someone removed stays removed; a pair the model rejected can still
 * be related by a rule (or the model, if it changes its mind). Returns how many changed.
 */
export async function saveGraphRelations(
    notebookId: string,
    inputs: GraphRelationInput[],
): Promise<number> {
    const byId = new Map<string, GraphRelationInput>();
    for (const raw of inputs) {
        if (raw.a === raw.b) continue;
        const input = steady(raw);
        const id = relationId(notebookId, input);
        const earlier = byId.get(id);
        byId.set(id, earlier ? mergeInputs(earlier, input) : input);
    }
    if (byId.size === 0) return 0;
    const existing = await findByIds(notebookId, [...byId.keys()]);
    const now = new Date();
    const writes: RelationWrite[] = [];
    for (const [id, input] of byId) {
        const current = existing.get(id);
        if (current?.status === 'removed') continue;
        if (current?.status === 'active' && !outranks(input, current)) continue;
        const fields = relationFields(notebookId, input);
        if (current && !differs(current, fields)) continue;
        const unset: Record<string, ''> = {};
        for (const key of OPTIONAL_FIELDS)
            if (current?.[key] !== undefined && fields[key as keyof typeof fields] === undefined)
                unset[key] = '';
        writes.push({
            updateOne: {
                filter: { _id: id, notebookId, status: { $ne: 'removed' } },
                update: {
                    $set: { ...fields, updatedAt: now },
                    ...(Object.keys(unset).length ? { $unset: unset } : {}),
                    $setOnInsert: { createdAt: now, checkedAt: now },
                },
                upsert: !current,
            },
        });
    }
    return writeRelations(writes);
}

export function interactionEvidence(kind: InteractionTally['kind'], count: number): string {
    const noun = kind === 'messages_with' ? 'message' : kind === 'emails_with' ? 'email' : 'event';
    return `${count} ${noun}${count === 1 ? '' : 's'}${kind === 'met_with' ? ' together' : ''}`;
}

/** Adds items to an interaction's parts (oldest first, so the newest end up as samples). */
export function addToParts(parts: InteractionPart[], items: TalliedItem[]): InteractionPart[] {
    const out = parts.map((part) => ({ ...part, samples: [...part.samples] }));
    for (const item of [...items].sort((x, y) => x.at - y.at)) {
        let part = out.find((p) => p.key === item.part);
        if (!part && out.length >= MAX_INTERACTION_PARTS - 1)
            part = out.find((p) => p.key === OTHER_PART);
        if (!part) {
            const key = out.length >= MAX_INTERACTION_PARTS - 1 ? OTHER_PART : item.part;
            part = { key, count: 0, firstAt: item.at, lastAt: item.at, samples: [] };
            out.push(part);
        }
        part.count++;
        part.firstAt = Math.min(part.firstAt, item.at);
        if (item.at >= part.lastAt) {
            part.lastAt = item.at;
            part.samples = [item.id, ...part.samples.filter((id) => id !== item.id)];
        } else if (!part.samples.includes(item.id)) {
            part.samples.push(item.id);
        }
        part.samples = part.samples.slice(0, PART_SAMPLES);
    }
    return out;
}

/** A whole window's items as parts: the biggest chats, mailboxes or calendars keep their own. */
function buildParts(items: TalliedItem[]): InteractionPart[] {
    const sizes = new Map<string, number>();
    for (const item of items) sizes.set(item.part, (sizes.get(item.part) ?? 0) + 1);
    const own = new Set(
        [...sizes]
            .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
            .slice(0, MAX_INTERACTION_PARTS - 1)
            .map(([key]) => key),
    );
    return addToParts(
        [],
        items.map((item) => (own.has(item.part) ? item : { ...item, part: OTHER_PART })),
    ).sort((x, y) => (x.key < y.key ? -1 : 1));
}

/** The totals of some parts: a count, the first and last time. */
export function partTotals(parts: InteractionPart[]) {
    return {
        count: parts.reduce((sum, part) => sum + part.count, 0),
        firstAt: Math.min(...parts.map((part) => part.firstAt)),
        lastAt: Math.max(...parts.map((part) => part.lastAt)),
    };
}

function interactionFields(
    notebookId: string,
    tally: Pick<InteractionTally, 'a' | 'b' | 'kind' | 'ownerId'>,
    parts: InteractionPart[],
    items: string[],
) {
    const totals = partTotals(parts);
    return relationFields(notebookId, {
        a: tally.a,
        b: tally.b,
        kind: tally.kind,
        from: tally.a,
        owner: tally.ownerId,
        confidence: 1,
        evidence: interactionEvidence(tally.kind, totals.count),
        madeBy: 'rule',
        items: items.slice(0, MAX_RELATION_ITEMS),
        ...totals,
        parts,
    });
}

/** The relation an interaction tally is saved as (its id, before anything is saved). */
export function interactionRelation(
    tally: Pick<InteractionTally, 'a' | 'b' | 'kind' | 'ownerId'>,
): GraphRelationInput {
    return {
        a: tally.a,
        b: tally.b,
        kind: tally.kind,
        from: tally.a,
        owner: tally.ownerId,
        confidence: 1,
        evidence: '',
        madeBy: 'rule',
    };
}

/** A tally of a whole window as a relation: the count is the tally's. */
export function interactionInput(tally: InteractionTally): GraphRelationInput {
    const unique = [...new Map(tally.items.map((item) => [item.id, item])).values()];
    const sorted = unique.sort((x, y) => y.at - x.at);
    const parts = buildParts(sorted);
    return {
        ...interactionRelation(tally),
        evidence: interactionEvidence(tally.kind, sorted.length),
        items: sorted.slice(0, MAX_RELATION_ITEMS).map((item) => item.id),
        ...partTotals(parts),
        parts,
    };
}

/**
 * Adds newly uploaded messages, emails or events to the pairs' interactions, one relation
 * per pair and member. The caller passes only items not counted before (see
 * `findCountedItems`), so an item uploaded again, or an event in the future, is never
 * counted twice. Removed interactions stay removed.
 */
export async function addInteractions(
    notebookId: string,
    tallies: InteractionTally[],
): Promise<number> {
    const byId = new Map<string, InteractionTally>();
    for (const tally of tallies) {
        if (tally.a === tally.b || tally.items.length === 0) continue;
        const id = relationId(notebookId, interactionRelation(tally));
        const earlier = byId.get(id);
        byId.set(id, earlier ? { ...earlier, items: [...earlier.items, ...tally.items] } : tally);
    }
    if (byId.size === 0) return 0;
    const existing = await findByIds(notebookId, [...byId.keys()]);
    const now = new Date();
    const writes: RelationWrite[] = [];
    for (const [id, tally] of byId) {
        const current = existing.get(id);
        if (current?.status === 'removed') continue;
        const base = current?.status === 'active' ? current : null;
        const fresh = [...new Map(tally.items.map((item) => [item.id, item])).values()];
        // Older relations without parts count as one part of their own.
        const before: InteractionPart[] =
            base?.parts ??
            (base?.count
                ? [
                      {
                          key: OTHER_PART,
                          count: base.count,
                          firstAt: base.firstAt ?? 0,
                          lastAt: base.lastAt ?? 0,
                          samples: (base.items ?? []).slice(0, PART_SAMPLES),
                      },
                  ]
                : []);
        const parts = addToParts(before, fresh);
        const items = [
            ...fresh.sort((x, y) => y.at - x.at).map((item) => item.id),
            ...(base?.items ?? []),
        ];
        const fields = interactionFields(notebookId, tally, parts, [...new Set(items)]);
        writes.push({
            updateOne: {
                filter: { _id: id, notebookId, status: { $ne: 'removed' } },
                update: { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
                upsert: !current,
            },
        });
    }
    return writeRelations(writes);
}

/** Records pairs the model judged unrelated, so they aren't sent to it again. */
export async function rejectGraphPairs(
    notebookId: string,
    pairs: Array<[string, string]>,
): Promise<void> {
    const now = new Date();
    const writes: RelationWrite[] = pairs
        .filter(([x, y]) => x !== y)
        .map(([x, y]) => {
            const input: GraphRelationInput = {
                a: x,
                b: y,
                kind: 'related',
                confidence: 0,
                evidence: '',
                madeBy: 'model',
            };
            return {
                updateOne: {
                    filter: { _id: relationId(notebookId, input), notebookId },
                    update: {
                        $setOnInsert: {
                            ...relationFields(notebookId, input),
                            status: 'rejected',
                            createdAt: now,
                            updatedAt: now,
                        },
                    },
                    upsert: true,
                },
            };
        });
    await writeRelations(writes);
}

/** The notebook's relations with these statuses (active by default), most recently changed first. */
export async function findGraphRelations(
    notebookId: string,
    statuses: GraphRelationStatus[] = ['active'],
    limit = 10_000,
): Promise<GraphRelationDocument[]> {
    return relations()
        .find({ notebookId, status: { $in: statuses } })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();
}

/** Which of these pairs (link keys) are already decided: related, removed or rejected. */
export async function findDecidedPairs(notebookId: string, keys: string[]): Promise<Set<string>> {
    const decided = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
        const docs = await relations()
            .find(
                { notebookId, pair: { $in: keys.slice(i, i + 500) } },
                { projection: { pair: 1 } },
            )
            .toArray();
        for (const doc of docs) decided.add(doc.pair);
    }
    return decided;
}

/** Rejected pairs this old are out of the window by now: forget them. */
export async function pruneRejectedPairs(notebookId: string, before: Date): Promise<void> {
    await relations().deleteMany({ notebookId, status: 'rejected', updatedAt: { $lt: before } });
}

/** Replaces the reason on these relations (cleaning text for a shared notebook). */
export async function setGraphRelationEvidence(
    notebookId: string,
    ids: string[],
    evidence: string,
): Promise<void> {
    if (ids.length === 0) return;
    await relations().updateMany({ _id: { $in: ids }, notebookId }, { $set: { evidence } });
}

/** Drops the active relations touching these nodes (removed ones stay, so they stay removed). */
export async function deleteGraphRelationsTouching(
    notebookId: string,
    ids: string[],
): Promise<void> {
    if (ids.length === 0) return;
    await relations().deleteMany({ notebookId, status: { $ne: 'removed' }, a: { $in: ids } });
    await relations().deleteMany({ notebookId, status: { $ne: 'removed' }, b: { $in: ids } });
}

/** Drops active relations of these kinds (relationships, once a notebook is shared). */
export async function deleteActiveRelationsOfKind(
    notebookId: string,
    kinds: DataGraphRelationKind[],
): Promise<void> {
    await relations().deleteMany({ notebookId, status: 'active', kind: { $in: kinds } });
}

// MARK: - Items gone for good

/** Active model relations whose items were looked up longest ago. */
export async function findGraphRelationsToCheck(
    notebookId: string,
    limit: number,
): Promise<GraphRelationDocument[]> {
    return relations()
        .find({ notebookId, status: 'active', madeBy: 'model' })
        .sort({ checkedAt: 1 })
        .limit(limit)
        .toArray();
}

/** Notes which relations have an item missing (and since when) and which are whole again. */
export async function markGraphRelationsChecked(
    notebookId: string,
    present: string[],
    missing: string[],
    now: Date,
): Promise<void> {
    if (present.length)
        await relations().updateMany(
            { _id: { $in: present }, notebookId },
            { $set: { checkedAt: now }, $unset: { goneSince: '' } },
        );
    if (missing.length) {
        await relations().updateMany(
            { _id: { $in: missing }, notebookId, goneSince: { $exists: false } },
            { $set: { goneSince: now } },
        );
        await relations().updateMany(
            { _id: { $in: missing }, notebookId },
            { $set: { checkedAt: now } },
        );
    }
}

/** Drops relations whose item has been missing since before `before`. */
export async function deleteGraphRelationsGoneBefore(
    notebookId: string,
    before: Date,
): Promise<void> {
    await relations().deleteMany({ notebookId, status: 'active', goneSince: { $lt: before } });
}

/** Active relations touching one node. */
export async function findGraphRelationsOf(
    notebookId: string,
    nodeId: string,
    limit = 50,
): Promise<GraphRelationDocument[]> {
    const [asA, asB] = await Promise.all([
        relations().find({ notebookId, a: nodeId, status: 'active' }).limit(limit).toArray(),
        relations().find({ notebookId, b: nodeId, status: 'active' }).limit(limit).toArray(),
    ]);
    return [...asA, ...asB];
}

/** Active relations on these lines (link keys). */
export async function findGraphRelationsForPairs(
    notebookId: string,
    pairs: string[],
): Promise<GraphRelationDocument[]> {
    if (pairs.length === 0) return [];
    return relations()
        .find({ notebookId, pair: { $in: pairs.slice(0, 500) }, status: 'active' })
        .limit(2_000)
        .toArray();
}

/** Takes one relation out for good: it's never added again for the same pair. */
export async function removeGraphRelation(
    notebookId: string,
    id: string,
    userId: string,
): Promise<boolean> {
    const doc = await relations().findOne({ _id: id, notebookId, status: 'active' });
    if (!doc) return false;
    const removal = {
        $set: { status: 'removed' as const, removedBy: userId, updatedAt: new Date() },
    };
    // Readers see two members' tallies of the same pair as one reason: both go.
    if (isInteraction(doc.kind))
        await relations().updateMany(
            { notebookId, pair: doc.pair, kind: doc.kind, status: 'active' },
            removal,
        );
    else await relations().updateOne({ _id: id, notebookId, status: 'active' }, removal);
    return true;
}

/**
 * Takes out every reason on one line, for good: the pair is blocked, so no reason (a new
 * email, an event together) brings the line back.
 */
export async function removeGraphPair(
    notebookId: string,
    pair: string,
    userId: string,
): Promise<boolean> {
    const result = await relations().updateMany(
        { notebookId, pair, status: 'active' },
        {
            $set: {
                status: 'removed',
                blocksPair: true,
                removedBy: userId,
                updatedAt: new Date(),
            },
        },
    );
    return result.matchedCount > 0;
}

/**
 * Drops relations the rules or About me made that the latest pass didn't make again
 * (their items changed or left, a relation was taken out of About me).
 */
export async function deleteStaleRuleRelations(
    notebookId: string,
    keep: Set<string>,
): Promise<number> {
    const current = await relations()
        .find(
            { notebookId, madeBy: { $in: ['rule', 'user'] }, status: 'active' },
            { projection: { _id: 1 } },
        )
        .limit(50_000)
        .toArray();
    return deleteGraphRelations(
        notebookId,
        current.map((doc) => doc._id).filter((id) => !keep.has(id)),
    );
}

/** Drops these relations unless someone removed them (removed ones must stay removed). */
export async function deleteGraphRelations(notebookId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 500) {
        const result = await relations().deleteMany({
            _id: { $in: ids.slice(i, i + 500) },
            notebookId,
            status: { $ne: 'removed' },
        });
        deleted += result.deletedCount;
    }
    return deleted;
}

// MARK: - Migration from one link per pair

/** A legacy link between a contact card and a person. */
const isCardLink = (link: Pick<LegacyGraphLinkDocument, 'a' | 'b'>) =>
    [link.a, link.b].some((end) => parseDataGraphItemNodeId(end)?.itemId.startsWith('contacts:'));
const isEventLink = (link: Pick<LegacyGraphLinkDocument, 'a' | 'b'>) =>
    [link.a, link.b].some((end) => parseDataGraphItemNodeId(end)?.itemId.startsWith('calendar:'));

/**
 * The relation an older link becomes, or null when it has none of its own now: a contact
 * card is its person's details, and messages and emails are counted in the person's
 * interactions. Removals always stay, and keep the whole pair apart, as they did.
 */
export function legacyLinkToRelation(
    link: LegacyGraphLinkDocument,
): (GraphRelationInput & { status: GraphRelationStatus }) | null {
    const removed = link.status === 'removed';
    let kind: DataGraphRelationKind = link.status === 'rejected' ? 'related' : link.kind;
    if (link.kind === 'person' && link.status !== 'rejected') {
        if (isEventLink(link) && !isCardLink(link)) kind = 'attendee';
        else if (!removed) return null;
    }
    return {
        a: link.a,
        b: link.b,
        kind,
        confidence: link.confidence,
        evidence: link.evidence,
        madeBy: link.madeBy,
        status: link.status,
    };
}

/**
 * Copies older links into relations. A removal always wins: it replaces an active
 * relation with the same id, and nothing else on its pair stays. Anything else is copied
 * only where there's no relation yet. The old documents are marked as copied, never
 * deleted.
 */
async function copyLegacyLinks(notebookId: string, legacy: LegacyGraphLinkDocument[]) {
    const writes: RelationWrite[] = [];
    const blocked = new Set<string>();
    for (const link of legacy) {
        const relation = legacyLinkToRelation(link);
        if (!relation) continue;
        const { status: _active, ...fields } = relationFields(notebookId, relation);
        void _active;
        const kept = {
            ...(link.checkedAt ? { checkedAt: link.checkedAt } : {}),
            ...(link.goneSince ? { goneSince: link.goneSince } : {}),
            createdAt: link.createdAt,
        };
        const removed = relation.status === 'removed';
        if (removed) blocked.add(fields.pair);
        writes.push({
            updateOne: {
                filter: { _id: relationId(notebookId, relation), notebookId },
                update: removed
                    ? {
                          $set: {
                              status: 'removed',
                              blocksPair: true,
                              updatedAt: link.updatedAt,
                              ...(link.removedBy ? { removedBy: link.removedBy } : {}),
                          },
                          $setOnInsert: { ...fields, ...kept },
                      }
                    : {
                          $setOnInsert: {
                              ...fields,
                              ...kept,
                              status: relation.status,
                              updatedAt: link.updatedAt,
                          },
                      },
                upsert: true,
            },
        });
    }
    await writeRelations(writes);
    const pairs = [...blocked];
    for (let i = 0; i < pairs.length; i += 500)
        await relations().deleteMany({
            notebookId,
            pair: { $in: pairs.slice(i, i + 500) },
            status: { $ne: 'removed' },
        });
    for (let i = 0; i < legacy.length; i += 1000)
        await legacyLinks().updateMany(
            { _id: { $in: legacy.slice(i, i + 1000).map((link) => link._id) }, notebookId },
            { $set: { migratedAt: new Date() } },
        );
}

/** Most older removals copied in one go (a notebook has far fewer than this). */
const MAX_LEGACY_REMOVALS = 50_000;

/**
 * Copies the notebook's one-link-per-pair links into relations. Removals go first, all of
 * them (they're few), so nothing the rules or the model save can bring one back; then the
 * rest, a batch at a time. True once every link is copied.
 */
export async function migrateLegacyGraphLinks(
    notebookId: string,
    batch = 5_000,
    maxBatches = 10,
): Promise<boolean> {
    // Every removal, copied or not: one copied earlier must still win over an active
    // relation saved since.
    await copyLegacyLinks(
        notebookId,
        await legacyLinks()
            .find({ notebookId, status: 'removed' })
            .limit(MAX_LEGACY_REMOVALS)
            .toArray(),
    );
    for (let i = 0; i < maxBatches; i++) {
        const legacy = await legacyLinks()
            .find({ notebookId, migratedAt: { $exists: false } })
            .limit(batch)
            .toArray();
        if (legacy.length === 0) break;
        await copyLegacyLinks(notebookId, legacy);
    }
    const left = await legacyLinks().findOne(
        { notebookId, migratedAt: { $exists: false } },
        { projection: { _id: 1 } },
    );
    return !left;
}

// MARK: - Nodes (people, places, topics, events)

export type GraphNodeInput = Pick<
    GraphNodeDocument,
    | 'id'
    | 'kind'
    | 'label'
    | 'addresses'
    | 'keys'
    | 'handles'
    | 'aliases'
    | 'contactIds'
    | 'ownerId'
    | 'at'
>;

export async function saveGraphNodes(notebookId: string, inputs: GraphNodeInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const now = new Date();
    for (let i = 0; i < inputs.length; i += 1000) {
        await nodes().bulkWrite(
            inputs.slice(i, i + 1000).map((input) => {
                const unset: Record<string, ''> = {};
                if (input.kind === 'person') {
                    if (!input.contactIds?.length) unset['contactIds'] = '';
                    if (!input.ownerId) unset['ownerId'] = '';
                }
                return {
                    updateOne: {
                        filter: { _id: `${notebookId}|${input.id}`, notebookId },
                        update: {
                            $set: {
                                notebookId,
                                id: input.id,
                                kind: input.kind,
                                label: input.label.slice(0, 120),
                                ...(input.addresses
                                    ? { addresses: input.addresses.slice(0, 20) }
                                    : {}),
                                ...(input.keys ? { keys: input.keys.slice(0, 40) } : {}),
                                ...(input.handles ? { handles: input.handles.slice(0, 40) } : {}),
                                ...(input.aliases?.length
                                    ? { aliases: input.aliases.slice(0, 40) }
                                    : {}),
                                ...(input.contactIds?.length
                                    ? { contactIds: input.contactIds.slice(0, 10) }
                                    : {}),
                                ...(input.ownerId ? { ownerId: input.ownerId } : {}),
                                ...(input.at !== undefined ? { at: input.at } : {}),
                                updatedAt: now,
                            },
                            ...(Object.keys(unset).length ? { $unset: unset } : {}),
                        },
                        upsert: true,
                    },
                };
            }),
            { ordered: false },
        );
    }
}

export async function findGraphNodes(
    notebookId: string,
    kinds?: GraphNodeDocument['kind'][],
): Promise<GraphNodeDocument[]> {
    return nodes()
        .find({ notebookId, ...(kinds ? { kind: { $in: kinds } } : {}) })
        .limit(20_000)
        .toArray();
}

export async function deleteGraphNodes(notebookId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await nodes().deleteMany({ _id: { $in: ids.map((id) => `${notebookId}|${id}`) }, notebookId });
}

// MARK: - Linking state

export async function findGraphState(notebookId: string): Promise<GraphStateDocument | null> {
    return states().findOne({ _id: notebookId });
}

/**
 * Claims the notebook for one linking pass, so several API instances don't link it at
 * once. False when another pass holds it.
 */
export async function claimGraphPass(notebookId: string, now: Date, leaseMs: number) {
    const until = new Date(now.getTime() + leaseMs);
    try {
        const result = await states().updateOne(
            {
                _id: notebookId,
                $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
            },
            { $set: { leaseUntil: until } },
            { upsert: true },
        );
        return result.matchedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        // The upsert raced another instance's claim of a new notebook.
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
    }
}

export async function finishGraphPass(
    notebookId: string,
    changes: Pick<
        GraphStateDocument,
        | 'backfilledAt'
        | 'cursor'
        | 'lastRunAt'
        | 'lastFullRunAt'
        | 'pendingItems'
        | 'scrubbedShared'
        | 'relationsMigratedAt'
    >,
    options: { full?: boolean } = {},
): Promise<void> {
    const set = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    await states().updateOne(
        { _id: notebookId },
        {
            $set: set,
            $unset: { leaseUntil: '', ...(options.full ? { fullPassRequested: '' } : {}) },
        },
        { upsert: true },
    );
}

/** Asks for a full pass soon (a data page was added, or its filter changed). */
export async function requestFullGraphPass(notebookId: string): Promise<void> {
    await states().updateOne(
        { _id: notebookId },
        { $set: { fullPassRequested: true } },
        { upsert: true },
    );
}

// MARK: - What the model has seen

/** Which of these item nodes the model has already seen in the notebook. */
export async function findJudgedItems(notebookId: string, nodeIds: string[]): Promise<Set<string>> {
    const seen = new Set<string>();
    const prefix = `${notebookId}|`;
    for (let i = 0; i < nodeIds.length; i += 500) {
        const docs = await judged()
            .find(
                { _id: { $in: nodeIds.slice(i, i + 500).map((id) => prefix + id) }, notebookId },
                { projection: { _id: 1 } },
            )
            .toArray();
        for (const doc of docs) seen.add(doc._id.slice(prefix.length));
    }
    return seen;
}

export async function markItemsJudged(
    notebookId: string,
    nodeIds: string[],
    now: Date,
): Promise<void> {
    if (nodeIds.length === 0) return;
    await judged().bulkWrite(
        nodeIds.map((id) => ({
            updateOne: {
                filter: { _id: `${notebookId}|${id}`, notebookId },
                update: { $set: { notebookId, judgedAt: now } },
                upsert: true,
            },
        })),
        { ordered: false },
    );
}

/** Items seen this long ago have left the window: forget them. */
export async function pruneJudgedItems(notebookId: string, before: Date): Promise<void> {
    await judged().deleteMany({ notebookId, judgedAt: { $lt: before } });
}

// MARK: - What the interactions have counted

/** Which of these item nodes the notebook's interactions already count. */
export async function findCountedItems(
    notebookId: string,
    nodeIds: string[],
): Promise<Set<string>> {
    const seen = new Set<string>();
    const prefix = `${notebookId}|`;
    const ids = [...new Set(nodeIds)];
    for (let i = 0; i < ids.length; i += 500) {
        const docs = await counted()
            .find(
                { _id: { $in: ids.slice(i, i + 500).map((id) => prefix + id) }, notebookId },
                { projection: { _id: 1 } },
            )
            .toArray();
        for (const doc of docs) seen.add(doc._id.slice(prefix.length));
    }
    return seen;
}

/** Notes items as counted; only the ones not noted yet are written. */
export async function markItemsCounted(
    notebookId: string,
    nodeIds: string[],
    now: Date,
): Promise<void> {
    const known = await findCountedItems(notebookId, nodeIds);
    const fresh = [...new Set(nodeIds)].filter((id) => !known.has(id));
    for (let i = 0; i < fresh.length; i += 1000) {
        await counted().bulkWrite(
            fresh.slice(i, i + 1000).map((id) => ({
                updateOne: {
                    filter: { _id: `${notebookId}|${id}`, notebookId },
                    update: { $setOnInsert: { notebookId, countedAt: now } },
                    upsert: true,
                },
            })),
            { ordered: false },
        );
    }
}

/** Items counted this long ago have left the window: forget them. */
export async function pruneCountedItems(notebookId: string, before: Date): Promise<void> {
    await counted().deleteMany({ notebookId, countedAt: { $lt: before } });
}

// MARK: - Model budget

/**
 * Counts one model call against a daily cap. False when the cap is reached (the call
 * must not be made).
 */
export async function reserveGraphCall(scope: string, day: string, cap: number): Promise<boolean> {
    try {
        const result = await usage().updateOne(
            { _id: `${scope}|${day}`, calls: { $lt: cap } },
            { $inc: { calls: 1 }, $set: { day } },
            { upsert: true },
        );
        return result.matchedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
        // At the cap the filter misses and the upsert hits the existing day.
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
    }
}

/** Gives back a reserved call that wasn't made. */
export async function releaseGraphCall(scope: string, day: string): Promise<void> {
    await usage().updateOne({ _id: `${scope}|${day}`, calls: { $gt: 0 } }, { $inc: { calls: -1 } });
}

export async function pruneGraphUsage(beforeDay: string): Promise<void> {
    await usage().deleteMany({ day: { $lt: beforeDay } });
}

export async function releaseGraphPass(notebookId: string): Promise<void> {
    await states().updateOne({ _id: notebookId }, { $unset: { leaseUntil: '' } });
}
