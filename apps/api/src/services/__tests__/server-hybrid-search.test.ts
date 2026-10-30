import { describe, it, expect, vi } from 'vitest';
import { parseHybridQuery, fuseRanks } from '../hybrid-query';
import { getSqliteDatabase } from '../../db/client';
import { testDb } from '../../__tests__/setup';
import {
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { searchServerDataPages, decodeItemReference } from '../server-hybrid-search.service';
import { upsertDeviceItems } from '../../repositories/device-item.repo';
import type { MacDataItem } from '@maple/shared';
import { serverSearchWorker } from '../server-search-worker.service';

vi.mock('../server-search-worker.service', () => ({
    serverSearchWorker: {
        state: 'disabled',
        start: vi.fn(),
        request: vi.fn().mockRejectedValue(new Error('worker_disabled')),
    },
}));
const makeItem = (id: string, body: string): MacDataItem => ({
    id,
    source: 'imessage',
    revision: '1',
    occurredAt: 1000,
    title: 'Message',
    participants: [],
    body,
});

describe('server hybrid query contract', () => {
    it('quotes hostile MATCH syntax and applies phrases/exclusions to both legs', () => {
        const parsed = parseHybridQuery('"package pickup" -"wrong address" OR:mentions (NEAR)');
        expect(parsed.required).toEqual(['package pickup']);
        expect(parsed.excluded).toEqual(['wrong address']);
        expect(parsed.expression).toContain('"or mentions"');
        expect(parsed.expression).not.toContain('OR:');
        expect(parseHybridQuery('-only').expression).toBe('');
    });
    it('fuses ranks rather than raw scores and counts duplicate chunks once', () => {
        expect(
            fuseRanks(['rare', 'both', 'both'], ['meaning', 'both']).map((row) => row.id),
        ).toEqual(['both', 'meaning', 'rare']);
        expect(fuseRanks(['both', 'both'], [])[0]!.score).toBeCloseTo(1 / 61);
    });
    it('retrieves with the native SQLite FTS5 index while the model is unavailable and preserves owner references', async () => {
        const owner = await createUserFixture();
        const userId = owner._id.toString();
        const notebook = await createNotebookFixture({
            createdBy: userId,
            sharedWith: [{ userId, accessLevel: 'owner' }],
        });
        const page = await createPageFixture({ userId, notebookId: notebook._id.toString() });
        await testDb
            .collection('pages')
            .updateOne({ id: page.id }, { $set: { type: 'devicedata', deviceSource: 'imessage' } });
        const stranger = await createUserFixture();
        await upsertDeviceItems(userId, 'device', [
            makeItem('imessage:same', 'The zeppelin package is ready for pickup'),
            makeItem('imessage:excluded', 'The zeppelin package has the wrong address'),
        ]);
        await upsertDeviceItems(stranger._id.toString(), 'other', [
            makeItem('imessage:same', 'Private zeppelin messages'),
        ]);
        const projected = await getSqliteDatabase()!.request<
            Array<{ userId: string; item: MacDataItem; vectors?: string; searchText?: string }>
        >('search.candidates', undefined, [userId, ['imessage'], 999, 1001]);
        expect(projected).toHaveLength(2);
        expect(
            projected.every(
                (doc) =>
                    doc.userId === userId &&
                    doc.item.body === undefined &&
                    doc.vectors === undefined &&
                    doc.searchText === undefined,
            ),
        ).toBe(true);
        expect(
            await getSqliteDatabase()!.request('search.candidates', undefined, [
                userId,
                ['mail'],
                999,
                1001,
            ]),
        ).toEqual([]);
        const chronological = await searchServerDataPages(
            { userId, notebookId: notebook._id.toString(), timeZone: 'UTC' },
            { query: '', limit: 1 },
        );
        expect(chronological.search.mode).toBe('chronological');
        expect(chronological.results).toHaveLength(1);
        const result = await searchServerDataPages(
            { userId, notebookId: notebook._id.toString(), timeZone: 'UTC' },
            { query: 'zeppelin -"wrong address"' },
        );
        expect(result.search).toMatchObject({ mode: 'lexical', fallbackReason: 'worker_disabled' });
        expect(result.results.map((row) => row.id)).toEqual(['imessage:same']);
        expect(decodeItemReference(result.results[0]!.reference)).toEqual([
            userId,
            'imessage',
            'imessage:same',
        ]);
        const raw = await getSqliteDatabase()!.request<Array<{ title: string }>>('sql', undefined, [
            'SELECT title FROM search_documents WHERE user_id=?',
            [userId],
        ]);
        expect(raw).toHaveLength(2);
        await testDb.collection('device_items').deleteMany({ userId });
        expect(
            (
                await searchServerDataPages(
                    { userId, notebookId: notebook._id.toString(), timeZone: 'UTC' },
                    { query: 'zeppelin' },
                )
            ).results,
        ).toEqual([]);
    });
    it('pages a large archive without losing late matches or bypassing page filters', async () => {
        const userId = (await createUserFixture())._id.toString();
        const notebook = await createNotebookFixture({ createdBy: userId });
        const page = await createPageFixture({ userId, notebookId: String(notebook._id) });
        await testDb.collection('pages').updateOne(
            { id: page.id },
            {
                $set: {
                    type: 'devicedata',
                    deviceSource: 'imessage',
                    deviceFilter: { chats: [{ id: 'selected-chat', name: 'Selected' }] },
                },
            },
        );
        await upsertDeviceItems(
            userId,
            'archive',
            Array.from({ length: 503 }, (_, index) => ({
                ...makeItem(`imessage:batch-${index}`, 'Boundaryneedle package'),
                occurredAt: 1000 + index,
                thread: index === 502 ? 'Selected' : 'Hidden',
                extra: { chatId: index === 502 ? 'selected-chat' : 'hidden-chat' },
            })),
        );
        const db = getSqliteDatabase()!;
        const request = vi.spyOn(db, 'request');
        try {
            const result = await searchServerDataPages(
                { userId, notebookId: String(notebook._id), timeZone: 'UTC' },
                { query: 'Boundaryneedle' },
            );
            expect(result.results.map((row) => row.id)).toEqual(['imessage:batch-502']);
            expect(result.search.coverage.eligible).toBe(1);
            const batches = request.mock.calls
                .map((call, index) => ({ call, result: request.mock.results[index] }))
                .filter(({ call }) => call[0] === 'search.candidates');
            expect(batches).toHaveLength(2);
            expect(batches[0]!.call[2]?.[4]).toBe(0);
            expect(batches[1]!.call[2]?.[4]).toBeGreaterThan(0);
            expect(await batches[0]!.result!.value).toHaveLength(500);
            expect(await batches[1]!.result!.value).toHaveLength(3);
        } finally {
            request.mockRestore();
        }
    });
    it('rejects stale embedding publication after a source revision changes', async () => {
        await upsertDeviceItems('owner', 'device', [makeItem('imessage:item', 'first')]);
        const db = getSqliteDatabase()!;
        const job = await db.request<Record<string, unknown>>('search.claim', undefined, [
            Date.now(),
        ]);
        await upsertDeviceItems('owner', 'device', [
            { ...makeItem('imessage:item', 'second'), revision: '2' },
        ]);
        const vector = Buffer.alloc(4096);
        vector.writeFloatLE(1, 0);
        expect(
            await db.request('search.publish', undefined, [job, [vector.toString('base64')]]),
        ).toBe(false);
        const vectors = await db.request<unknown[]>('search.vectorBatch', undefined, ['owner', 0]);
        expect(vectors).toHaveLength(0);
    });
    it('drops an item edited during retrieval even when a client reuses its revision', async () => {
        const userId = (await createUserFixture())._id.toString();
        const notebook = await createNotebookFixture({ createdBy: userId });
        const page = await createPageFixture({ userId, notebookId: notebook._id.toString() });
        await testDb
            .collection('pages')
            .updateOne({ id: page.id }, { $set: { type: 'devicedata', deviceSource: 'imessage' } });
        const item = makeItem('imessage:race', 'first content');
        await upsertDeviceItems(userId, 'device', [item]);
        const db = getSqliteDatabase()!;
        const job = await db.request<Record<string, unknown>>('search.claim', undefined, [
            Date.now(),
        ]);
        const vector = Buffer.alloc(4096);
        vector.writeFloatLE(1, 0);
        await db.request('search.publish', undefined, [job, [vector.toString('base64')]]);
        serverSearchWorker.state = 'ready';
        vi.mocked(serverSearchWorker.request).mockImplementation(async (message) => {
            if (message.op === 'search') {
                await upsertDeviceItems(userId, 'device', [{ ...item, body: 'changed content' }]);
                return {
                    hits: [{ id: JSON.stringify([`${userId}:${item.id}`, 0]), score: 1 }],
                } as never;
            }
            return {} as never;
        });
        try {
            const result = await searchServerDataPages(
                { userId, notebookId: String(notebook._id), timeZone: 'UTC' },
                { query: 'first' },
            );
            expect(result.results).toEqual([]);
        } finally {
            serverSearchWorker.state = 'disabled';
            vi.mocked(serverSearchWorker.request)
                .mockReset()
                .mockRejectedValue(new Error('worker_disabled'));
        }
    });
});
