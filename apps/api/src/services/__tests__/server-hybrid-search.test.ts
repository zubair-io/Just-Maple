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
import {
    deviceItemMatchesFilter,
    homeItemVisibleToBots,
    type DeviceDataFilter,
    type MacDataItem,
} from '@maple/shared';
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
                    doc.item.body === '' &&
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
    it('keeps every sharing and presence filter fact without copying archive memberships', async () => {
        const scenarios: Array<{ item: MacDataItem; filter: DeviceDataFilter }> = [
            {
                item: { ...makeItem('chat', 'body'), extra: { chatId: 'selected' } },
                filter: { chats: [{ id: 'selected', name: 'Selected' }] },
            },
            {
                item: {
                    ...makeItem('calendar', 'body'),
                    source: 'calendar',
                    calendar: 'Family',
                    extra: { calendarId: 'family' },
                },
                filter: { calendars: [{ id: 'family', name: 'Family' }] },
            },
            {
                item: { ...makeItem('mail', 'body'), source: 'mail', mailbox: 'Inbox' },
                filter: { mailboxes: ['Inbox'] },
            },
            {
                item: {
                    ...makeItem('place', 'body'),
                    source: 'location',
                    extra: { placeId: 'private' },
                },
                filter: { includeAll: true, excludePlaceIds: ['private'] },
            },
            {
                item: {
                    ...makeItem('coordinates', 'body'),
                    source: 'location',
                    extra: { lat: 40, lon: -73 },
                },
                filter: { includeAll: true, excludePlaceIds: ['private'] },
            },
            {
                item: {
                    ...makeItem('home', 'body'),
                    source: 'home',
                    extra: { entityId: 'light.room', area: 'Kitchen' },
                },
                filter: { homeAreas: ['Kitchen'] },
            },
            {
                item: {
                    ...makeItem('presence', 'body'),
                    source: 'home',
                    extra: { entityId: 'binary_sensor.phone', deviceClass: 'occupancy' },
                },
                filter: { includeAll: true },
            },
            {
                item: {
                    ...makeItem('group', 'body'),
                    source: 'home',
                    extra: { entityId: 'group.people', state: 'home', area: 'Kitchen' },
                },
                filter: { homeAreas: ['Kitchen'] },
            },
        ];
        await upsertDeviceItems(
            'owner',
            'device',
            scenarios.map(({ item }) => ({
                ...item,
                extra: {
                    ...item.extra,
                    archiveMembers: [
                        { key: 'person', name: 'Private contact', handles: ['private'] },
                    ],
                },
            })),
        );
        const projected = await getSqliteDatabase()!.request<Array<{ item: MacDataItem }>>(
            'search.candidates',
            undefined,
            ['owner', ['imessage', 'calendar', 'mail', 'location', 'home']],
        );
        const context = {
            timeZone: 'UTC',
            places: [{ id: 'private', name: 'Private', lat: 40, lon: -73 }],
        };
        expect(projected).toHaveLength(scenarios.length);
        for (const { item, filter } of scenarios) {
            const candidate = projected.find((row) => row.item.id === item.id)!.item;
            expect(deviceItemMatchesFilter(candidate, filter, context)).toBe(
                deviceItemMatchesFilter(item, filter, context),
            );
            expect(homeItemVisibleToBots(candidate, filter)).toBe(
                homeItemVisibleToBots(item, filter),
            );
            expect(candidate.extra?.['archiveMembers']).toBeUndefined();
            expect(candidate.body).toBe('');
        }
    });
    it('bounds parallel searches before reading candidates and releases queued requests', async () => {
        const userId = (await createUserFixture())._id.toString();
        const notebook = await createNotebookFixture({ createdBy: userId });
        const page = await createPageFixture({ userId, notebookId: String(notebook._id) });
        await testDb
            .collection('pages')
            .updateOne({ id: page.id }, { $set: { type: 'devicedata', deviceSource: 'imessage' } });
        const db = getSqliteDatabase()!;
        const realRequest = db.request.bind(db);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let started = 0;
        const request = vi
            .spyOn(db, 'request')
            .mockImplementation(
                async <T>(op: string, collection?: string, args: unknown[] = []): Promise<T> => {
                    if (op === 'search.candidates') {
                        started++;
                        await gate;
                    }
                    return realRequest<T>(op, collection, args);
                },
            );
        const ctx = { userId, notebookId: String(notebook._id), timeZone: 'UTC' };
        const searches = Array.from({ length: 6 }, () => searchServerDataPages(ctx, { query: '' }));
        try {
            await vi.waitFor(() => expect(started).toBe(2));
            await expect(searchServerDataPages(ctx, { query: '' })).rejects.toThrow(
                'search_overloaded',
            );
        } finally {
            release();
            await Promise.all(searches);
            request.mockRestore();
        }
        expect(started).toBe(6);
        await expect(searchServerDataPages(ctx, { query: '' })).resolves.toHaveProperty('results');
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
        const vectors = await db.request<unknown[]>('search.vectorBatch', undefined, [
            'owner',
            null,
        ]);
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
