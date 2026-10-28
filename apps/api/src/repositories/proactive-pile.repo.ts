import type { Collection } from 'mongodb';
import type { MacDataChangeBatch } from '@maple/shared';
import { getDb } from '../db/client';

/**
 * The pending pile: news a proactive bot decided can wait, one pile per chat. Kept in
 * the database (not memory) so a restart or another API instance doesn't lose it. Items
 * leave the pile when a post, a max-wait summary or the morning brief covers them.
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
}

interface PileDocument {
    _id: string; // the chat's page id
    userId: string;
    items: PileItem[];
    /** When the oldest item joined: the max-wait clock. */
    oldestAt: Date;
    /** The last triage's view of the pile as a whole. */
    urgency: number;
    headline?: string;
    updatedAt: Date;
}

export interface Pile {
    pageId: string;
    items: PileItem[];
    oldestAt: Date;
    urgency: number;
    headline?: string;
}

/** A pile never grows past this; the oldest items go first. */
export const MAX_PILE_ITEMS = 60;

function piles(): Collection<PileDocument> {
    return getDb().collection<PileDocument>('proactive_piles');
}

function toPile(doc: PileDocument): Pile {
    return {
        pageId: doc._id,
        items: doc.items,
        oldestAt: doc.oldestAt,
        urgency: doc.urgency,
        ...(doc.headline ? { headline: doc.headline } : {}),
    };
}

export async function getPile(pageId: string): Promise<Pile | null> {
    const doc = await piles().findOne({ _id: pageId });
    return doc && doc.items.length ? toPile(doc) : null;
}

/** The piles of these chats that have anything in them, by page id. */
export async function getPiles(pageIds: string[]): Promise<Map<string, Pile>> {
    if (pageIds.length === 0) return new Map();
    const docs = await piles()
        .find({ _id: { $in: pageIds } })
        .toArray();
    return new Map(docs.filter((doc) => doc.items.length).map((doc) => [doc._id, toPile(doc)]));
}

/** Newer versions of the same item replace older ones but keep their place in line. */
export function mergeIntoPile(items: PileItem[], entries: PileEntry[], now: Date): PileItem[] {
    const byKey = new Map(items.map((item) => [item.key, item]));
    for (const entry of entries) {
        const earlier = byKey.get(entry.item.id);
        byKey.set(entry.item.id, {
            key: entry.item.id,
            // An item added and then changed before anyone was told is still new.
            entry: earlier?.entry.kind === 'added' ? { ...entry, kind: 'added' } : entry,
            addedAt: earlier?.addedAt ?? now,
        });
    }
    return [...byKey.values()].sort((a, b) => +a.addedAt - +b.addedAt).slice(-MAX_PILE_ITEMS);
}

export async function savePile(
    pageId: string,
    userId: string,
    items: PileItem[],
    view: { urgency: number; headline?: string },
    now = new Date(),
): Promise<void> {
    if (items.length === 0) {
        await piles().deleteOne({ _id: pageId });
        return;
    }
    const oldestAt = items.reduce((min, item) => (item.addedAt < min ? item.addedAt : min), now);
    await piles().replaceOne(
        { _id: pageId },
        {
            userId,
            items,
            oldestAt,
            urgency: view.urgency,
            ...(view.headline ? { headline: view.headline } : {}),
            updatedAt: now,
        },
        { upsert: true },
    );
}

/**
 * Takes covered items out of the pile: each key, as long as the version in the pile is
 * the one that was covered (one that arrived since stays).
 */
export async function removeFromPile(pageId: string, covered: PileItem[]): Promise<void> {
    const doc = await piles().findOne({ _id: pageId });
    if (!doc) return;
    const done = new Map(covered.map((item) => [item.key, JSON.stringify(item.entry)]));
    const left = doc.items.filter((item) => done.get(item.key) !== JSON.stringify(item.entry));
    if (left.length === 0) {
        await piles().deleteOne({ _id: pageId, updatedAt: doc.updatedAt });
        return;
    }
    await piles().updateOne(
        { _id: pageId, updatedAt: doc.updatedAt },
        {
            $set: {
                items: left,
                oldestAt: left.reduce((min, i) => (i.addedAt < min ? i.addedAt : min), new Date()),
                updatedAt: new Date(),
            },
        },
    );
}

export async function clearPile(pageId: string): Promise<void> {
    await piles().deleteOne({ _id: pageId });
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
