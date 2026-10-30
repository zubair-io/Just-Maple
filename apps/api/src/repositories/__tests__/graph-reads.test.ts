import { describe, it, expect } from 'vitest';
import { getSqliteDatabase } from '../../db/client';
import { testDb } from '../../__tests__/setup';
import {
    findDeviceItemsByIds,
    findDeviceItemsForGraph,
    upsertDeviceItems,
} from '../device-item.repo';
import type { MacDataItem } from '@maple/shared';

const item = (id: string, occurredAt: number): MacDataItem => ({
    id,
    source: 'imessage',
    revision: '1',
    occurredAt,
    participants: ['friend@example.com'],
    body: 'A long message body',
    extra: { chatId: 'family', senderHandle: 'friend@example.com' },
});

describe('bounded graph reads', () => {
    it('applies dates, update cursor, newest-first limit and body projection without losing sharing facts', async () => {
        await upsertDeviceItems('owner', 'mac', [
            item('old', 10),
            item('recent', 20),
            item('newest', 30),
        ]);
        await upsertDeviceItems('stranger', 'mac', [item('newest', 40)]);
        await testDb
            .collection('device_items')
            .updateOne({ _id: 'owner:recent' as never }, { $set: { updatedAt: new Date(100) } });
        expect(
            await findDeviceItemsForGraph('owner', 'imessage', {
                from: 15,
                to: 35,
                limit: 1,
                bodyChars: 6,
            }),
        ).toEqual([{ ...item('newest', 30), body: 'A long' }]);
        expect(
            await findDeviceItemsForGraph('owner', 'imessage', {
                from: 15,
                to: 25,
                updatedSince: new Date(101),
                limit: 10,
                bodyChars: 0,
            }),
        ).toEqual([]);
        expect(await findDeviceItemsForGraph('owner', 'mail', { limit: 10, bodyChars: 0 })).toEqual(
            [],
        );
        expect(
            await findDeviceItemsByIds(
                'owner',
                ['newest', 'newest', 'stranger:newest', 'missing'],
                0,
            ),
        ).toEqual([{ ...item('newest', 30), body: '' }]);
        expect((await findDeviceItemsByIds('owner', ['newest']))[0]?.body).toBe(
            item('newest', 30).body,
        );
    });
    it('pages vectors across chunk boundaries while excluding other owners and stale revisions', async () => {
        await upsertDeviceItems('owner', 'mac', [item('a', 20), item('stale', 20)]);
        await upsertDeviceItems('stranger', 'mac', [item('a', 20)]);
        const db = getSqliteDatabase()!;
        const generation = 'bge-m3-5617a9f-cls-l2-512-v1';
        await db.request('sql', undefined, [
            `WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<130)
            INSERT INTO search_embeddings(id,chunk,user_id,revision,content_hash,generation,dimensions,vector)
            SELECT d.id,n,d.user_id,CASE WHEN d.item_id='stale' THEN 'obsolete' ELSE d.revision END,d.content_hash,?,1024,zeroblob(4096)
            FROM search_documents d CROSS JOIN seq`,
            [generation],
        ]);
        type Entry = { documentId: string; chunk: number };
        const first = await db.request<Entry[]>('search.vectorBatch', undefined, ['owner', null]);
        expect(first).toHaveLength(128);
        expect(first.every((row) => row.documentId === 'owner:a')).toBe(true);
        expect(first[127]?.chunk).toBe(127);
        const second = await db.request<Entry[]>('search.vectorBatch', undefined, [
            'owner',
            { id: first[127]!.documentId, chunk: first[127]!.chunk },
        ]);
        expect(second.map((row) => row.chunk)).toEqual([128, 129, 130]);
        expect(
            await db.request('search.vectorBatch', undefined, [
                'owner',
                { id: 'owner:a', chunk: 130 },
            ]),
        ).toEqual([]);
    });
});
