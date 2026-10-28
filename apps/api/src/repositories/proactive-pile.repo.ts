import { randomUUID } from 'crypto';
import type { Collection } from 'mongodb';
import type { MacDataChangeBatch } from '@maple/shared';
import { getDb } from '../db/client';

/**
 * The pending pile: news a proactive bot decided can wait, one pile per chat. Kept in
 * the database (not memory) so a restart or another API instance doesn't lose it. Items
 * leave the pile when a post, a max-wait summary or the morning brief covers them.
 *
 * Several API instances can touch one pile at once (the Mac's and the iPhone's uploads
 * may land on different ones), so:
 * - every change is a compare-and-set on the pile's `version` (a fresh random token each
 *   write), retried on conflict, so no change overwrites another;
 * - each item carries `rev`, bumped when a newer version of it arrives, and only the
 *   exact versions that were posted are taken out;
 * - one pass at a time works on a pile, under a short lease (`acquirePileLease`).
 *
 * Also the triage budget: how many triage model calls a chat used per day.
 */

export type PileEntry = MacDataChangeBatch['entries'][number];

export interface PileItem {
    /** The device item's id; a newer version of the same item replaces the older. */
    key: string;
    entry: PileEntry;
    /** When it joined the pile (the first version, so waiting time isn't reset). */
    addedAt: Date;
    /** Bumped for each newer version, so a post only removes the version it covered. */
    rev: number;
    /** A triage (or the code check that held it back) has seen this version. */
    triaged?: boolean;
    /** A triage has seen this version as unanswered past its reply delay. */
    replyChecked?: boolean;
    /** Must go out now (a calendar clash, or the triage said now), even after a failed post. */
    urgent?: boolean;
    /**
     * The version that made it urgent. A newer version inherits the urgency (the urgent
     * one may not have been told yet), and loses it once a post covers that version.
     */
    urgentRev?: number;
    /** Found in code, told with the item: calendar clashes it creates or clears. */
    notes?: string[];
}

/** Items beyond the cap, folded into counts so nothing disappears unseen. */
export interface PileOverflow {
    count: number;
    /** How many per source ("mail": 12). */
    sources: Record<string, number>;
    /** When the oldest folded item joined: the max-wait clock still counts it. */
    oldestAt: Date;
}

interface PileDocument {
    _id: string; // the chat's page id
    userId: string;
    items: PileItem[];
    overflow?: PileOverflow;
    /** The last triage's view of the pile as a whole. */
    urgency: number;
    headline?: string;
    /** Changes with every write; writes only land on the version they read. */
    version: string;
    updatedAt: Date;
}

export interface Pile {
    pageId: string;
    items: PileItem[];
    overflow?: PileOverflow;
    /** When the oldest item (folded ones included) joined: the max-wait clock. */
    oldestAt: Date;
    urgency: number;
    headline?: string;
}

/** Items kept one by one; older ones that can wait are folded into `overflow`. */
export const MAX_PILE_ITEMS = 60;

function piles(): Collection<PileDocument> {
    return getDb().collection<PileDocument>('proactive_piles');
}

function toPile(doc: PileDocument): Pile {
    const oldest = Math.min(
        ...doc.items.map((item) => +item.addedAt),
        doc.overflow ? +doc.overflow.oldestAt : Infinity,
    );
    return {
        pageId: doc._id,
        items: doc.items,
        ...(doc.overflow ? { overflow: doc.overflow } : {}),
        oldestAt: new Date(Number.isFinite(oldest) ? oldest : +doc.updatedAt),
        urgency: doc.urgency,
        ...(doc.headline ? { headline: doc.headline } : {}),
    };
}

const isEmpty = (doc: Pick<PileDocument, 'items' | 'overflow'>) =>
    doc.items.length === 0 && !doc.overflow?.count;

export async function getPile(pageId: string): Promise<Pile | null> {
    const doc = await piles().findOne({ _id: pageId });
    return doc && !isEmpty(doc) ? toPile(doc) : null;
}

/** The piles of these chats that have anything in them, by page id. */
export async function getPiles(pageIds: string[]): Promise<Map<string, Pile>> {
    if (pageIds.length === 0) return new Map();
    const docs = await piles()
        .find({ _id: { $in: pageIds } })
        .toArray();
    return new Map(docs.filter((doc) => !isEmpty(doc)).map((doc) => [doc._id, toPile(doc)]));
}

type PileState = Pick<PileDocument, 'items' | 'overflow' | 'urgency' | 'headline'>;

const MAX_ATTEMPTS = 10;

/**
 * Applies `change` to the pile with compare-and-set, retrying when another write got in
 * first. `change` returns the new state, or null to leave the pile as it is.
 */
async function changePile(
    pageId: string,
    userId: string | undefined,
    change: (current: PileState | null) => PileState | null,
    now = new Date(),
): Promise<Pile | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const doc = await piles().findOne({ _id: pageId });
        const next = change(doc && !isEmpty(doc) ? doc : null);
        if (!next) return doc && !isEmpty(doc) ? toPile(doc) : null;
        const fields = {
            items: next.items,
            urgency: next.urgency,
            ...(next.headline ? { headline: next.headline } : {}),
            ...(next.overflow?.count ? { overflow: next.overflow } : {}),
        };
        if (!doc) {
            if (isEmpty(next) || !userId) return null;
            const created: PileDocument = {
                _id: pageId,
                userId,
                ...fields,
                version: randomUUID(),
                updatedAt: now,
            };
            try {
                await piles().insertOne(created);
                return toPile(created);
            } catch (error) {
                if ((error as { code?: number }).code === 11000) continue;
                throw error;
            }
        }
        if (isEmpty(next)) {
            const removed = await piles().deleteOne({ _id: pageId, version: doc.version });
            if (removed.deletedCount === 1) return null;
            continue;
        }
        const updated: PileDocument = {
            _id: pageId,
            userId: doc.userId,
            ...fields,
            version: randomUUID(),
            updatedAt: now,
        };
        const result = await piles().replaceOne({ _id: pageId, version: doc.version }, updated);
        if (result.matchedCount === 1) return toPile(updated);
    }
    throw new Error(`Pending pile for page ${pageId} kept changing; giving up`);
}

/**
 * Newer versions of the same item replace older ones but keep their place in line and
 * their age; a newer version needs triage again. Past `MAX_PILE_ITEMS`, the oldest items
 * that aren't urgent are folded into `overflow` (counts by source), never dropped.
 */
export function mergeIntoPile(
    state: Pick<PileState, 'items' | 'overflow'>,
    entries: PileEntry[],
    now: Date,
    marks: { urgent?: Set<string>; notes?: Map<string, string[]> } = {},
): Pick<PileState, 'items' | 'overflow'> {
    const byKey = new Map(state.items.map((item) => [item.key, item]));
    for (const entry of entries) {
        const key = entry.item.id;
        const earlier = byKey.get(key);
        const notes = [...(earlier?.notes ?? []), ...(marks.notes?.get(key) ?? [])];
        const rev = earlier ? earlier.rev + 1 : 0;
        // A new reason makes this version the urgent one; otherwise the earlier one stays.
        const urgentRev = marks.urgent?.has(key)
            ? rev
            : earlier?.urgent
              ? (earlier.urgentRev ?? earlier.rev)
              : undefined;
        byKey.set(key, {
            key,
            // An item added and then changed before anyone was told is still new.
            entry: earlier?.entry.kind === 'added' ? { ...entry, kind: 'added' } : entry,
            addedAt: earlier?.addedAt ?? now,
            rev,
            ...(urgentRev !== undefined ? { urgent: true, urgentRev } : {}),
            ...(notes.length ? { notes: [...new Set(notes)] } : {}),
        });
    }
    const items = [...byKey.values()].sort((a, b) => +a.addedAt - +b.addedAt);
    let overflow = state.overflow
        ? { ...state.overflow, sources: { ...state.overflow.sources } }
        : undefined;
    while (items.length > MAX_PILE_ITEMS) {
        const index = items.findIndex((item) => !item.urgent);
        if (index < 0) break; // everything left is urgent: keep it all
        const [folded] = items.splice(index, 1);
        const source = folded!.entry.item.source;
        overflow = {
            count: (overflow?.count ?? 0) + 1,
            sources: { ...overflow?.sources, [source]: (overflow?.sources[source] ?? 0) + 1 },
            oldestAt:
                overflow && overflow.oldestAt < folded!.addedAt
                    ? overflow.oldestAt
                    : folded!.addedAt,
        };
    }
    return { items, ...(overflow ? { overflow } : {}) };
}

/** Adds new items to the pile (see `mergeIntoPile`). */
export function addToPile(
    pageId: string,
    userId: string,
    entries: PileEntry[],
    now = new Date(),
    marks: { urgent?: Set<string>; notes?: Map<string, string[]> } = {},
): Promise<Pile | null> {
    return changePile(
        pageId,
        userId,
        (current) => ({
            urgency: current?.urgency ?? 0,
            ...(current?.headline ? { headline: current.headline } : {}),
            ...mergeIntoPile(current ?? { items: [] }, entries, now, marks),
        }),
        now,
    );
}

const sameVersion = (covered: PileItem[]) => {
    const revs = new Map(covered.map((item) => [item.key, item.rev]));
    return (item: PileItem) => revs.get(item.key) === item.rev;
};

/**
 * Records a triage: the versions it saw are marked triaged (and urgent when it said now),
 * the ones it dropped leave, and its view of the pile is kept. Newer versions that came
 * in meanwhile are untouched. `replyChecked` names the seen items it looked at as overdue
 * replies, so they aren't looked at again for that.
 */
export function markTriaged(
    pageId: string,
    seen: PileItem[],
    verdict: { now: boolean; urgency: number; headline?: string; drop: string[] },
    replyChecked: Set<string> = new Set(),
): Promise<Pile | null> {
    const wasSeen = sameVersion(seen);
    const dropped = new Set(verdict.drop);
    return changePile(pageId, undefined, (current) => {
        if (!current) return null;
        return {
            ...current,
            items: current.items
                .filter((item) => !(wasSeen(item) && dropped.has(item.key)))
                .map((item) =>
                    wasSeen(item)
                        ? {
                              ...item,
                              triaged: true,
                              ...(replyChecked.has(item.key) ? { replyChecked: true } : {}),
                              ...(verdict.now && !item.urgent
                                  ? { urgent: true, urgentRev: item.rev }
                                  : {}),
                          }
                        : item,
                ),
            urgency: verdict.urgency,
            ...(verdict.headline ? { headline: verdict.headline } : {}),
        };
    });
}

/**
 * Takes covered items out of the pile: exactly the versions that were covered (a newer
 * version that arrived since stays), and `overflowCovered` of the folded count.
 */
export function removeFromPile(
    pageId: string,
    covered: PileItem[],
    overflowCovered = 0,
): Promise<Pile | null> {
    const wasCovered = sameVersion(covered);
    const told = new Map(covered.map((item) => [item.key, item]));
    return changePile(pageId, undefined, (current) => {
        if (!current) return null;
        const items = current.items
            .filter((item) => !wasCovered(item))
            .map((item) => {
                // A newer version of a told item: what the told version carried was said.
                const said = told.get(item.key);
                if (!said) return item;
                const { urgent, urgentRev, notes, ...rest } = item;
                const stillUrgent = urgent && (urgentRev ?? item.rev) > said.rev;
                const left = (notes ?? []).filter((note) => !said.notes?.includes(note));
                return {
                    ...rest,
                    ...(stillUrgent ? { urgent, urgentRev } : {}),
                    ...(left.length ? { notes: left } : {}),
                };
            });
        const left = (current.overflow?.count ?? 0) - overflowCovered;
        const touched = current.items.some((item) => told.has(item.key));
        if (!touched && overflowCovered === 0) return null;
        return {
            ...current,
            items,
            overflow:
                left > 0 && current.overflow ? { ...current.overflow, count: left } : undefined,
        };
    });
}

export async function clearPile(pageId: string): Promise<void> {
    await piles().deleteOne({ _id: pageId });
}

// MARK: - Lease: one pass per pile at a time

interface LeaseDocument {
    _id: string; // the chat's page id
    holder: string;
    until: Date;
}

/** Longer than a pass takes (a model run with tools); a crashed holder frees it then. */
export const PILE_LEASE_MS = 5 * 60 * 1000;

function leases(): Collection<LeaseDocument> {
    return getDb().collection<LeaseDocument>('proactive_pile_leases');
}

/** True when `holder` now holds the pile's lease (it was free, or expired). */
export async function acquirePileLease(
    pageId: string,
    holder: string,
    now = new Date(),
    ms = PILE_LEASE_MS,
): Promise<boolean> {
    const until = new Date(now.getTime() + ms);
    try {
        await leases().insertOne({ _id: pageId, holder, until });
        return true;
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    const taken = await leases().updateOne(
        { _id: pageId, until: { $lte: now } },
        { $set: { holder, until } },
    );
    return taken.modifiedCount === 1;
}

export async function releasePileLease(pageId: string, holder: string): Promise<void> {
    await leases().deleteOne({ _id: pageId, holder });
}

// MARK: - Triage budget

interface BudgetDocument {
    _id: string; // `${pageId}:${day}`
    calls: number;
    createdAt: Date;
}

const BUDGET_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

function budgets(): Collection<BudgetDocument> {
    return getDb().collection<BudgetDocument>('proactive_triage_budget');
}

/**
 * Uses one of the chat's triage calls for `day`. False once `limit` calls were used: the
 * filter then matches nothing and the upsert collides with the existing record.
 */
export async function takeTriageCall(
    pageId: string,
    day: string,
    limit: number,
    now = new Date(),
): Promise<boolean> {
    try {
        await budgets().updateOne(
            { _id: `${pageId}:${day}`, calls: { $lt: limit } },
            { $inc: { calls: 1 }, $setOnInsert: { createdAt: now } },
            { upsert: true },
        );
        return true;
    } catch (error) {
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
    }
}

export async function purgeOldTriageBudgets(now = new Date()): Promise<number> {
    const result = await budgets().deleteMany({
        createdAt: { $lt: new Date(now.getTime() - BUDGET_KEEP_MS) },
    });
    return result.deletedCount;
}
