import { afterEach, describe, expect, it, vi } from 'vitest';
import { Binary, Collection, ObjectId } from 'mongodb';
import * as Y from 'yjs';
import { testDb, mongoAvailable } from '../../__tests__/setup';
import { getConnectionGraph, reindexAllLinks } from '../link.service';
import { bulkPublishPagesForNotebook } from '../../repositories/page.repo';

const { slugSequence } = vi.hoisted(() => ({ slugSequence: [] as string[] }));
vi.mock('nanoid', async (original) => {
    const actual = await original<typeof import('nanoid')>();
    return {
        ...actual,
        customAlphabet: (...args: Parameters<typeof actual.customAlphabet>) => {
            const generate = actual.customAlphabet(...args);
            return () => slugSequence.shift() ?? generate();
        },
    };
});
vi.mock('yjs', async (original) => {
    const actual = await original<typeof Y>();
    return { ...actual, applyUpdate: vi.fn(actual.applyUpdate) };
});

const owner = new ObjectId();
const notebook = new ObjectId();
const content = (ids: string[]) => ({
    type: 'doc',
    content: ids.map((id) => ({ type: 'pageLink', attrs: { pageId: id, title: id } })),
});
function page(id: string, extra = {}) {
    return {
        id,
        userId: owner,
        notebookId: notebook,
        title: id,
        type: 'memo',
        content: content([]),
        isTrashed: false,
        updatedAt: new Date(),
        ...extra,
    };
}
function memoState(link: string) {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');
    const heading = new Y.XmlElement('heading');
    const title = new Y.XmlText();
    title.insert(0, 'Card title');
    heading.insert(0, [title]);
    const node = new Y.XmlElement('pageLink');
    node.setAttribute('pageId', link);
    node.setAttribute('title', link);
    fragment.insert(0, [heading, node]);
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return new Binary(Buffer.from(state));
}

describe.runIf(mongoAvailable)('issue performance regressions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('reindexes a notebook with bounded writes and no per-source lookups, preserving backlinks and scope', async () => {
        await testDb!.collection('pages').insertMany([
            ...Array.from({ length: 20 }, (_, i) =>
                page('source-' + i, { content: content(['target']) }),
            ),
            page('target'),
            page('old-target', {
                linksMeta: {
                    backlinks: [{ pageId: 'removed', title: 'removed', type: 'inline' }],
                },
            }),
            page('removed', {
                content: content([]),
                linksMeta: {
                    forwardLinks: [{ pageId: 'old-target', title: 'Old', type: 'inline' }],
                },
            }),
            page('outsider', { userId: new ObjectId(), content: content(['target']) }),
        ]);
        const findOne = vi.spyOn(Collection.prototype, 'findOne');
        const bulk = vi.spyOn(Collection.prototype, 'bulkWrite');
        expect(await reindexAllLinks(owner.toString(), notebook.toString())).toBe(23);
        expect(findOne).not.toHaveBeenCalled();
        expect(bulk).toHaveBeenCalledTimes(1);
        const target = await testDb!.collection('pages').findOne({ id: 'target' });
        expect(target?.linksMeta.backlinks).toHaveLength(20);
        expect(target?.linksMeta.backlinks.map((v: { pageId: string }) => v.pageId)).not.toContain(
            'outsider',
        );
        expect(
            (await testDb!.collection('pages').findOne({ id: 'old-target' }))?.linksMeta.backlinks,
        ).toEqual([]);
        await reindexAllLinks(owner.toString(), notebook.toString());
        expect(
            (await testDb!.collection('pages').findOne({ id: 'target' }))?.linksMeta.backlinks,
        ).toHaveLength(20);
    });

    it('publishes many pages with batched slug checks and unique reserved slugs', async () => {
        await testDb!
            .collection('pages')
            .insertMany(Array.from({ length: 25 }, (_, i) => page('publish-' + i)));
        const findOne = vi.spyOn(Collection.prototype, 'findOne');
        const bulk = vi.spyOn(Collection.prototype, 'bulkWrite');
        expect(await bulkPublishPagesForNotebook(notebook.toString())).toBe(25);
        expect(findOne).not.toHaveBeenCalled();
        expect(bulk).toHaveBeenCalledTimes(1);
        const pages = await testDb!.collection('pages').find({ isPublished: true }).toArray();
        expect(new Set(pages.map((p) => p.publishedSlug)).size).toBe(25);
        expect(pages.every((p) => p.publishedContent && p.publishedTitle === p.title)).toBe(true);
    });

    it('retries existing slug collisions and prevents duplicates inside the publish batch', async () => {
        await testDb!.collection('pages').insertMany([
            page('already-published', {
                notebookId: notebook.toString(),
                isPublished: true,
                publishedSlug: 'taken',
            }),
            page('a'),
            page('b'),
            page('c'),
        ]);
        slugSequence.push('taken', 'duplicate', 'duplicate', 'second', 'third');
        expect(await bulkPublishPagesForNotebook(notebook.toString())).toBe(3);
        const published = await testDb!
            .collection('pages')
            .find({ id: { $in: ['a', 'b', 'c'] } })
            .toArray();
        expect(new Set(published.map((page) => page.publishedSlug))).toEqual(
            new Set(['duplicate', 'second', 'third']),
        );
    });

    it('persists legacy memo indexes and invalidates them when the memo revision changes', async () => {
        await testDb!.collection('pages').insertMany([page('legacy'), page('target')]);
        await testDb!.collection('memos').insertOne({
            id: 'legacy',
            pageId: 'legacy',
            version: 1,
            updatedAt: new Date(1),
            state: memoState('target'),
        });
        const first = await getConnectionGraph(owner.toString());
        expect(first.edges).toContainEqual(
            expect.objectContaining({ source: 'legacy', target: 'target' }),
        );
        const cached = await testDb!.collection('memos').findOne({ id: 'legacy' });
        expect(cached?.graphMetadata.version).toBe(1);
        const apply = vi.mocked(Y.applyUpdate);
        apply.mockClear();
        expect(await getConnectionGraph(owner.toString())).toEqual(first);
        expect(apply).not.toHaveBeenCalled();
        await testDb!.collection('memos').updateOne(
            { id: 'legacy' },
            {
                $set: { state: memoState('elsewhere'), updatedAt: new Date(2) },
                $inc: { version: 1 },
            },
        );
        const changed = await getConnectionGraph(owner.toString());
        expect(changed.edges).not.toContainEqual(
            expect.objectContaining({ source: 'legacy', target: 'target' }),
        );
        expect(
            (await testDb!.collection('memos').findOne({ id: 'legacy' }))?.graphMetadata.version,
        ).toBe(2);
    });

    it('does not attach a decoded graph index to a concurrently newer revision', async () => {
        await testDb!.collection('pages').insertMany([page('legacy'), page('target')]);
        await testDb!.collection('memos').insertOne({
            id: 'legacy',
            pageId: 'legacy',
            version: 1,
            updatedAt: new Date(1),
            state: memoState('target'),
        });
        const original = Collection.prototype.bulkWrite;
        vi.spyOn(Collection.prototype, 'bulkWrite').mockImplementationOnce(async function (
            this: Collection,
            operations,
            options,
        ) {
            await this.updateOne(
                { id: 'legacy' },
                { $inc: { version: 1 }, $set: { updatedAt: new Date(2) } },
            );
            return original.call(this, operations, options);
        });
        await getConnectionGraph(owner.toString());
        const memo = await testDb!.collection('memos').findOne({ id: 'legacy' });
        expect(memo?.version).toBe(2);
        expect(memo?.graphMetadata).toBeUndefined();
        await getConnectionGraph(owner.toString());
        expect(
            (await testDb!.collection('memos').findOne({ id: 'legacy' }))?.graphMetadata.version,
        ).toBe(2);
    });

    it('chunks large reindex plans instead of issuing a database call per page', async () => {
        await testDb!
            .collection('pages')
            .insertMany(Array.from({ length: 1001 }, (_, i) => page('batch-' + i)));
        const bulk = vi.spyOn(Collection.prototype, 'bulkWrite');
        expect(await reindexAllLinks(owner.toString())).toBe(1001);
        expect(bulk).toHaveBeenCalledTimes(3);
        expect(bulk.mock.calls.every(([operations]) => operations.length <= 500)).toBe(true);
    });

    it('caches kanban cards and keeps their parent edge and title', async () => {
        await testDb!.collection('pages').insertOne(page('board', { type: 'kanban' }));
        await testDb!.collection('memos').insertOne({
            id: 'card',
            pageId: 'board',
            version: 1,
            updatedAt: new Date(1),
            state: memoState('missing'),
        });
        const first = await getConnectionGraph(owner.toString());
        expect(first.nodes).toContainEqual(
            expect.objectContaining({ id: 'card', label: 'Card title' }),
        );
        expect(first.edges).toContainEqual(
            expect.objectContaining({ source: 'board', target: 'card' }),
        );
        const apply = vi.mocked(Y.applyUpdate);
        apply.mockClear();
        expect(await getConnectionGraph(owner.toString())).toEqual(first);
        expect(apply).not.toHaveBeenCalled();
    });
});
