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
}

export interface GraphNodeDocument {
    _id: string; // `${notebookId}|${id}`
    notebookId: string;
    id: string;
    kind: Exclude<DataGraphNodeKind, 'item'>;
    label: string;
    /** Places: the addresses seen there, normalized, to match event locations. */
    addresses?: string[];
    updatedAt: Date;
}

export interface GraphStateDocument {
    _id: string; // notebookId
    backfilledAt?: Date;
    lastRunAt?: Date;
    /** Items uploaded after this are new to the graph. */
    cursor?: Date;
    /** While backfilling: items that happened before this (seconds) still need the model. */
    backfillBefore?: number;
    /** Another instance is linking this notebook until then. */
    leaseUntil?: Date;
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
                    $setOnInsert: { createdAt: now },
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

/** Every link in the notebook with these statuses (active by default). */
export async function findGraphLinks(
    notebookId: string,
    statuses: GraphLinkStatus[] = ['active'],
    limit = 20_000,
): Promise<GraphLinkDocument[]> {
    return links()
        .find({ notebookId, status: { $in: statuses } })
        .limit(limit)
        .toArray();
}

/** The pairs already decided in the notebook (any status), as link keys. */
export async function findDecidedPairs(notebookId: string): Promise<Set<string>> {
    const docs = await links()
        .find({ notebookId }, { projection: { _id: 1 } })
        .limit(50_000)
        .toArray();
    return new Set(docs.map((doc) => doc._id));
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

/** Drops active links whose items no longer show in the notebook (cleanup on read). */
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
    inputs: Array<Pick<GraphNodeDocument, 'id' | 'kind' | 'label' | 'addresses'>>,
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
    changes: Pick<GraphStateDocument, 'backfilledAt' | 'cursor' | 'lastRunAt' | 'backfillBefore'>,
): Promise<void> {
    const set = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    await states().updateOne(
        { _id: notebookId },
        { $set: set, $unset: { leaseUntil: '' } },
        { upsert: true },
    );
}

export async function releaseGraphPass(notebookId: string): Promise<void> {
    await states().updateOne({ _id: notebookId }, { $unset: { leaseUntil: '' } });
}
