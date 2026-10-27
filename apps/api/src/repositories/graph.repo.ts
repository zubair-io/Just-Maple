import { getDb } from '../db/client';
import type { DataGraphLinkKind, DataGraphNodeKind } from '@maple/shared';

// The connected-data graph, stored per notebook: every document carries its notebookId
// and every lookup is by it, so one notebook's links, people, places and topics never
// reach another's. Items themselves aren't stored here, only their node ids
// (`item:<ownerId>:<itemId>`); what a reader sees is checked against the notebook's data
// pages when the graph is read.

/** `active` is shown; `removed` was taken out by someone and is never added again;
 * `rejected` is a pair the model judged unrelated, so it isn't asked again. */
export type GraphLinkStatus = 'active' | 'removed' | 'rejected';

export interface GraphLinkDocument {
    _id: string; // `${notebookId}|${a}|${b}`, a < b
    notebookId: string;
    a: string;
    b: string;
    kind: DataGraphLinkKind;
    confidence: number;
    evidence: string;
    madeBy: 'rule' | 'model';
    status: GraphLinkStatus;
    createdAt: Date;
    updatedAt: Date;
    removedBy?: string;
    /** Model links: when their items were last looked up, and since when one is missing. */
    checkedAt?: Date;
    goneSince?: Date;
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

/** A link to save: its two ends and why. */
export interface GraphLinkInput {
    a: string;
    b: string;
    kind: DataGraphLinkKind;
    confidence: number;
    evidence: string;
    madeBy: 'rule' | 'model';
}

const links = () => getDb().collection<GraphLinkDocument>('graph_links');
const nodes = () => getDb().collection<GraphNodeDocument>('graph_nodes');
const states = () => getDb().collection<GraphStateDocument>('graph_state');
const judged = () => getDb().collection<GraphJudgedDocument>('graph_judged');
const usage = () => getDb().collection<GraphUsageDocument>('graph_usage');

/** One link per pair of nodes, whichever way round it's given. */
export function linkKey(notebookId: string, x: string, y: string): string {
    const [a, b] = x < y ? [x, y] : [y, x];
    return `${notebookId}|${a}|${b}`;
}

/** Rules are certain; a model link never replaces one. Higher confidence wins otherwise. */
function outranks(next: GraphLinkInput, current: GraphLinkDocument): boolean {
    if (current.madeBy === 'rule' && next.madeBy === 'model') return false;
    if (next.madeBy === 'rule' && current.madeBy === 'model') return true;
    return next.confidence > current.confidence;
}

/**
 * Saves links. A pair someone removed stays removed; a pair the model rejected can still
 * be linked by a rule (or the model, if it changes its mind). Returns how many changed.
 */
export async function saveGraphLinks(
    notebookId: string,
    inputs: GraphLinkInput[],
): Promise<number> {
    const byKey = new Map<string, GraphLinkInput>();
    for (const input of inputs) {
        if (input.a === input.b) continue;
        const key = linkKey(notebookId, input.a, input.b);
        const earlier = byKey.get(key);
        if (!earlier || outranks(input, { ...earlier, status: 'active' } as GraphLinkDocument))
            byKey.set(key, input);
    }
    if (byKey.size === 0) return 0;
    const existing = new Map<string, GraphLinkDocument>();
    const keys = [...byKey.keys()];
    for (let i = 0; i < keys.length; i += 500) {
        for (const doc of await links()
            .find({ _id: { $in: keys.slice(i, i + 500) }, notebookId })
            .toArray())
            existing.set(doc._id, doc);
    }
    const now = new Date();
    const writes = [];
    for (const [key, input] of byKey) {
        const current = existing.get(key);
        if (current?.status === 'removed') continue;
        if (current?.status === 'active' && !outranks(input, current)) continue;
        const [a, b] = input.a < input.b ? [input.a, input.b] : [input.b, input.a];
        writes.push({
            updateOne: {
                filter: { _id: key, notebookId, status: { $ne: 'removed' as const } },
                update: {
                    $set: {
                        notebookId,
                        a,
                        b,
                        kind: input.kind,
                        confidence: Math.round(input.confidence * 100) / 100,
                        evidence: input.evidence.slice(0, 200),
                        madeBy: input.madeBy,
                        status: 'active' as const,
                        updatedAt: now,
                    },
                    $setOnInsert: { createdAt: now, checkedAt: now },
                },
                upsert: !current,
            },
        });
    }
    if (writes.length === 0) return 0;
    try {
        await links().bulkWrite(writes, { ordered: false });
    } catch (error) {
        // A racing insert of the same pair: the other one stands.
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    return writes.length;
}

/** Records pairs the model judged unrelated, so they aren't sent to it again. */
export async function rejectGraphPairs(
    notebookId: string,
    pairs: Array<[string, string]>,
): Promise<void> {
    const now = new Date();
    for (const [x, y] of pairs) {
        const [a, b] = x < y ? [x, y] : [y, x];
        await links()
            .updateOne(
                { _id: linkKey(notebookId, x, y), notebookId },
                {
                    $setOnInsert: {
                        notebookId,
                        a,
                        b,
                        kind: 'related',
                        confidence: 0,
                        evidence: '',
                        madeBy: 'model',
                        status: 'rejected',
                        createdAt: now,
                        updatedAt: now,
                    },
                },
                { upsert: true },
            )
            .catch((error) => {
                if ((error as { code?: number }).code !== 11000) throw error;
            });
    }
}

/** The notebook's links with these statuses (active by default), most recently changed first. */
export async function findGraphLinks(
    notebookId: string,
    statuses: GraphLinkStatus[] = ['active'],
    limit = 10_000,
): Promise<GraphLinkDocument[]> {
    return links()
        .find({ notebookId, status: { $in: statuses } })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();
}

/** Which of these pairs (link keys) are already decided: linked, removed or rejected. */
export async function findDecidedPairs(notebookId: string, keys: string[]): Promise<Set<string>> {
    const decided = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
        const docs = await links()
            .find({ _id: { $in: keys.slice(i, i + 500) }, notebookId }, { projection: { _id: 1 } })
            .toArray();
        for (const doc of docs) decided.add(doc._id);
    }
    return decided;
}

/** Rejected pairs this old are out of the window by now: forget them. */
export async function pruneRejectedPairs(notebookId: string, before: Date): Promise<void> {
    await links().deleteMany({ notebookId, status: 'rejected', updatedAt: { $lt: before } });
}

/** Replaces the reason on these links (cleaning text for a shared notebook). */
export async function setGraphLinkEvidence(
    notebookId: string,
    ids: string[],
    evidence: string,
): Promise<void> {
    if (ids.length === 0) return;
    await links().updateMany({ _id: { $in: ids }, notebookId }, { $set: { evidence } });
}

/** Drops the active links touching these nodes (removed ones stay, so they stay removed). */
export async function deleteGraphLinksTouching(notebookId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await links().deleteMany({
        notebookId,
        status: { $ne: 'removed' },
        $or: [{ a: { $in: ids } }, { b: { $in: ids } }],
    });
}

// MARK: - Items gone for good

/** Active model links whose items were looked up longest ago. */
export async function findGraphLinksToCheck(
    notebookId: string,
    limit: number,
): Promise<GraphLinkDocument[]> {
    return links()
        .find({ notebookId, status: 'active', madeBy: 'model' })
        .sort({ checkedAt: 1 })
        .limit(limit)
        .toArray();
}

/** Notes which links have an item missing (and since when) and which are whole again. */
export async function markGraphLinksChecked(
    notebookId: string,
    present: string[],
    missing: string[],
    now: Date,
): Promise<void> {
    if (present.length)
        await links().updateMany(
            { _id: { $in: present }, notebookId },
            { $set: { checkedAt: now }, $unset: { goneSince: '' } },
        );
    if (missing.length) {
        await links().updateMany(
            { _id: { $in: missing }, notebookId, goneSince: { $exists: false } },
            { $set: { goneSince: now } },
        );
        await links().updateMany(
            { _id: { $in: missing }, notebookId },
            { $set: { checkedAt: now } },
        );
    }
}

/** Drops links whose item has been missing since before `before`. */
export async function deleteGraphLinksGoneBefore(notebookId: string, before: Date): Promise<void> {
    await links().deleteMany({ notebookId, status: 'active', goneSince: { $lt: before } });
}

/** Active links touching one node. */
export async function findGraphLinksOf(
    notebookId: string,
    nodeId: string,
    limit = 50,
): Promise<GraphLinkDocument[]> {
    const [asA, asB] = await Promise.all([
        links().find({ notebookId, a: nodeId, status: 'active' }).limit(limit).toArray(),
        links().find({ notebookId, b: nodeId, status: 'active' }).limit(limit).toArray(),
    ]);
    return [...asA, ...asB];
}

/** Takes a link out for good: it's never added again for the same pair. */
export async function removeGraphLink(
    notebookId: string,
    id: string,
    userId: string,
): Promise<boolean> {
    const result = await links().updateOne(
        { _id: id, notebookId, status: 'active' },
        { $set: { status: 'removed', removedBy: userId, updatedAt: new Date() } },
    );
    return result.matchedCount > 0;
}

/** Drops rule links the latest pass didn't make again (their items changed or left). */
export async function deleteStaleRuleLinks(notebookId: string, keep: Set<string>): Promise<number> {
    const current = await links()
        .find({ notebookId, madeBy: 'rule', status: 'active' }, { projection: { _id: 1 } })
        .limit(50_000)
        .toArray();
    return deleteGraphLinks(
        notebookId,
        current.map((doc) => doc._id).filter((id) => !keep.has(id)),
    );
}

/** Drops these links unless someone removed them (removed ones must stay removed). */
export async function deleteGraphLinks(notebookId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await links().deleteMany({
        _id: { $in: ids },
        notebookId,
        status: { $ne: 'removed' },
    });
    return result.deletedCount;
}

// MARK: - Nodes (people, places, topics)

export async function saveGraphNodes(
    notebookId: string,
    inputs: Array<
        Pick<
            GraphNodeDocument,
            'id' | 'kind' | 'label' | 'addresses' | 'keys' | 'handles' | 'aliases'
        >
    >,
): Promise<void> {
    if (inputs.length === 0) return;
    const now = new Date();
    await nodes().bulkWrite(
        inputs.map((input) => ({
            updateOne: {
                filter: { _id: `${notebookId}|${input.id}`, notebookId },
                update: {
                    $set: {
                        notebookId,
                        id: input.id,
                        kind: input.kind,
                        label: input.label.slice(0, 120),
                        ...(input.addresses ? { addresses: input.addresses.slice(0, 20) } : {}),
                        ...(input.keys ? { keys: input.keys.slice(0, 40) } : {}),
                        ...(input.handles ? { handles: input.handles.slice(0, 40) } : {}),
                        ...(input.aliases?.length ? { aliases: input.aliases.slice(0, 40) } : {}),
                        updatedAt: now,
                    },
                },
                upsert: true,
            },
        })),
        { ordered: false },
    );
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
