import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import {
    getPile,
    getPiles,
    mergeIntoPile,
    removeFromPile,
    savePile,
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
        const first = mergeIntoPile([], [entry('a'), entry('b')], t1);
        const merged = mergeIntoPile(first, [entry('a', 'changed', 'a v2'), entry('c')], t2);
        expect(merged.map((i) => [i.key, i.entry.item.snippet, i.addedAt])).toEqual([
            ['a', 'a v2', t1],
            ['b', 'b', t1],
            ['c', 'c', t2],
        ]);
        // Still new to the user: it was added before anyone was told.
        expect(merged[0]!.entry.kind).toBe('added');
    });

    it('keeps at most the newest items', () => {
        const many = Array.from({ length: MAX_PILE_ITEMS + 5 }, (_, n) => entry(`m${n}`));
        const merged = mergeIntoPile([], many, new Date());
        expect(merged).toHaveLength(MAX_PILE_ITEMS);
    });
});

describe.runIf(mongoAvailable)('the pending pile in the database', () => {
    it('saves, reads and empties a pile', async () => {
        const t = new Date('2026-10-28T10:00:00Z');
        const items = mergeIntoPile([], [entry('a'), entry('b')], t);
        await savePile('page', 'u1', items, { urgency: 1, headline: 'Two emails' }, t);
        const pile = await getPile('page');
        expect(pile).toMatchObject({ pageId: 'page', urgency: 1, headline: 'Two emails' });
        expect(pile!.oldestAt).toEqual(t);
        expect((await getPiles(['page', 'other'])).size).toBe(1);

        await removeFromPile('page', items);
        expect(await getPile('page')).toBeNull();
    });

    it('keeps a newer version of a covered item', async () => {
        const t = new Date('2026-10-28T10:00:00Z');
        const covered = mergeIntoPile([], [entry('a'), entry('b')], t);
        await savePile('page', 'u1', covered, { urgency: 1 }, t);
        // While the summary was written, "a" changed.
        const newer = mergeIntoPile(covered, [entry('a', 'changed', 'a v2')], t);
        await savePile('page', 'u1', newer, { urgency: 1 }, t);
        await removeFromPile('page', covered);
        expect((await getPile('page'))!.items.map((i) => i.entry.item.snippet)).toEqual(['a v2']);
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
        const stored = await testDb!.collection('messages').findOne({ id: message.id });
        expect(stored!.content).toEqual(doc('Practice at 5'));
    });
});
