import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import {
    acquirePileLease,
    addToPile,
    clearPile,
    getPile,
    getPiles,
    markTriaged,
    mergeIntoPile,
    releasePileLease,
    removeFromPile,
    takeTriageCall,
    MAX_PILE_ITEMS,
} from '../proactive-pile.repo';
import {
    createTopLevelBotMessage,
    findMessageById,
    markMessageHasThread,
    reviseBotMessage,
} from '../message.repo';

const entry = (id: string, kind = 'added', snippet = id) => ({
    kind,
    item: { id, source: 'mail' as const, when: '2026-10-28T09:00:00-04:00', snippet, score: 0 },
});
const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('mergeIntoPile', () => {
    it('replaces an item with its newer version but keeps its place and age', () => {
        const t1 = new Date('2026-10-28T10:00:00Z');
        const t2 = new Date('2026-10-28T11:00:00Z');
        const first = mergeIntoPile({ items: [] }, [entry('a'), entry('b')], t1);
        const merged = mergeIntoPile(first, [entry('a', 'changed', 'a v2'), entry('c')], t2).items;
        expect(merged.map((i) => [i.key, i.entry.item.snippet, i.addedAt, i.rev])).toEqual([
            ['a', 'a v2', t1, 1],
            ['b', 'b', t1, 0],
            ['c', 'c', t2, 0],
        ]);
        // Still new to the user: it was added before anyone was told.
        expect(merged[0]!.entry.kind).toBe('added');
    });

    it('folds what is past the cap into counts, oldest first, never urgent items', () => {
        const t1 = new Date('2026-10-28T10:00:00Z');
        const t2 = new Date('2026-10-28T11:00:00Z');
        const old = Array.from({ length: 10 }, (_, n) => entry(`old${n}`));
        const first = mergeIntoPile({ items: [] }, old, t1, { urgent: new Set(['old0']) });
        const many = Array.from({ length: MAX_PILE_ITEMS }, (_, n) => entry(`new${n}`));
        const merged = mergeIntoPile(first, many, t2);
        expect(merged.items).toHaveLength(MAX_PILE_ITEMS);
        expect(merged.overflow).toEqual({ count: 10, sources: { mail: 10 }, oldestAt: t1 });
        // The urgent one stays, even though it's the oldest.
        expect(merged.items[0]!.key).toBe('old0');
    });
});

describe.runIf(mongoAvailable)('the pending pile in the database', () => {
    it('adds, reads and empties a pile', async () => {
        const t = new Date('2026-10-28T10:00:00Z');
        const pile = await addToPile('page', 'u1', [entry('a'), entry('b')], t);
        expect((await getPile('page'))!.oldestAt).toEqual(t);
        expect((await getPiles(['page', 'other'])).size).toBe(1);
        await removeFromPile('page', pile!.items);
        expect(await getPile('page')).toBeNull();
    });

    it('keeps every item when several instances add at the same moment', async () => {
        await Promise.all(
            Array.from({ length: 8 }, (_, n) => addToPile('page', 'u1', [entry(`m${n}`)])),
        );
        expect((await getPile('page'))!.items.map((i) => i.key).sort()).toEqual(
            Array.from({ length: 8 }, (_, n) => `m${n}`).sort(),
        );
    });

    it('takes out only the versions that were covered', async () => {
        const covered = (await addToPile('page', 'u1', [entry('a'), entry('b')]))!.items;
        // While the summary was written, "a" changed.
        await addToPile('page', 'u1', [entry('a', 'changed', 'a v2')]);
        await removeFromPile('page', covered);
        expect((await getPile('page'))!.items.map((i) => i.entry.item.snippet)).toEqual(['a v2']);
    });

    it('a newer version loses the urgency and notes its told version carried', async () => {
        const marks = { urgent: new Set(['cal']), notes: new Map([['cal', ['Clash A']]]) };
        const told = (await addToPile('page', 'u1', [entry('cal')], new Date(), marks))!.items;
        await addToPile('page', 'u1', [entry('cal', 'changed', 'v2')]);
        // Before it is told, the newer version inherits the urgency.
        expect((await getPile('page'))!.items[0]).toMatchObject({ urgent: true, rev: 1 });
        await removeFromPile('page', told);
        const left = (await getPile('page'))!.items[0]!;
        expect(left.urgent).toBeUndefined();
        expect(left.notes).toBeUndefined();
    });

    it('records a triage only on the versions it saw', async () => {
        const seen = (await addToPile('page', 'u1', [entry('a'), entry('b')]))!.items;
        await addToPile('page', 'u1', [entry('c')]);
        await markTriaged('page', seen, { now: true, urgency: 3, drop: ['b'] });
        const pile = (await getPile('page'))!;
        expect(pile.items.map((i) => [i.key, !!i.triaged, !!i.urgent])).toEqual([
            ['a', true, true],
            ['c', false, false],
        ]);
        expect(pile.urgency).toBe(3);
    });

    it('lets one pass at a time hold the lease, and frees it when it expires', async () => {
        const t = new Date('2026-10-28T10:00:00Z');
        expect(await acquirePileLease('page', 'one', t)).toBe(true);
        expect(await acquirePileLease('page', 'two', t)).toBe(false);
        // A crashed holder: free again once the lease runs out.
        expect(await acquirePileLease('page', 'two', new Date(+t + 6 * 60_000))).toBe(true);
        await releasePileLease('page', 'one'); // not the holder any more: no effect
        expect(await acquirePileLease('page', 'three', new Date(+t + 6 * 60_000))).toBe(false);
        await releasePileLease('page', 'two');
        expect(await acquirePileLease('page', 'three', t)).toBe(true);
    });

    it('clears a pile', async () => {
        await addToPile('page', 'u1', [entry('a')]);
        await clearPile('page');
        expect(await getPile('page')).toBeNull();
    });

    it('allows a set number of triage calls per chat per day', async () => {
        expect(await takeTriageCall('page', '2026-10-28', 2)).toBe(true);
        expect(await takeTriageCall('page', '2026-10-28', 2)).toBe(true);
        expect(await takeTriageCall('page', '2026-10-28', 2)).toBe(false);
        expect(await takeTriageCall('page', '2026-10-29', 2)).toBe(true);
        expect(await takeTriageCall('other', '2026-10-28', 2)).toBe(true);
    });
});

describe.runIf(mongoAvailable)('revising a bot post', () => {
    const botId = new ObjectId().toString();
    const userId = new ObjectId().toString();

    const post = (text = 'Practice at 5') =>
        createTopLevelBotMessage({
            pageId: 'page',
            userId,
            userBotId: botId,
            content: doc(text),
            proactiveMeta: { kind: 'news', urgency: 1 },
        });
    const stored = async (id: string) =>
        (await testDb!.collection('messages').findOne({ id }))!.content;

    it('rewrites the post and keeps the first version and the history', async () => {
        const message = await post();
        const once = await reviseBotMessage(message.id, botId, {
            content: doc('Practice at 6'),
            proactiveMeta: { kind: 'news', urgency: 2 },
        });
        expect(once).toMatchObject({ id: message.id, proactiveMeta: { kind: 'news', urgency: 2 } });
        expect(once!.revisedAt).toBeDefined();
        expect(once!.editedAt).toBeUndefined();
        const twice = await reviseBotMessage(message.id, botId, { content: doc('Cancelled') });
        expect(twice!.revisions!.map((r) => r.content.content![0]!.content![0]!.text)).toEqual([
            'Practice at 5',
            'Practice at 6',
        ]);
        expect(twice!.revisions![0]!.at).toBe(message.createdAt);
        expect((await findMessageById(message.id))!.content).toEqual(doc('Cancelled'));
    });

    it("refuses another bot's post, or one with replies", async () => {
        const message = await post();
        expect(
            await reviseBotMessage(message.id, new ObjectId().toString(), { content: doc('x') }),
        ).toBeNull();
        await markMessageHasThread(message.id);
        expect(await reviseBotMessage(message.id, botId, { content: doc('x') })).toBeNull();
        expect(await stored(message.id)).toEqual(doc('Practice at 5'));
    });

    it('refuses a post the owner read while the revision was written', async () => {
        const message = await post();
        const revised = await reviseBotMessage(
            message.id,
            botId,
            { content: doc('Practice at 6') },
            { stillUnread: async (postedAt) => postedAt.toISOString() !== message.createdAt },
        );
        expect(revised).toBeNull();
        expect(await stored(message.id)).toEqual(doc('Practice at 5'));
    });

    it('refuses a post that is no longer the latest in the chat', async () => {
        const message = await post();
        await createTopLevelBotMessage({
            pageId: 'page',
            userId: new ObjectId().toString(),
            userBotId: new ObjectId().toString(),
            content: doc('Someone else posted'),
        });
        expect(await reviseBotMessage(message.id, botId, { content: doc('x') })).toBeNull();
        expect(await stored(message.id)).toEqual(doc('Practice at 5'));
    });

    it('lets only one of two revisions written at the same time land', async () => {
        const message = await post();
        // Both get past every check before either writes.
        let arrived = 0;
        let release!: () => void;
        const bothThere = new Promise<void>((resolve) => (release = resolve));
        const guard = {
            stillUnread: async () => {
                if (++arrived === 2) release();
                await bothThere;
                return true;
            },
        };
        const results = await Promise.all([
            reviseBotMessage(message.id, botId, { content: doc('Version A') }, guard),
            reviseBotMessage(message.id, botId, { content: doc('Version B') }, guard),
        ]);
        const landed = results.filter(Boolean);
        expect(landed).toHaveLength(1);
        expect(await stored(message.id)).toEqual(landed[0]!.content);
        expect(landed[0]!.revisions).toHaveLength(1);
    });
});
