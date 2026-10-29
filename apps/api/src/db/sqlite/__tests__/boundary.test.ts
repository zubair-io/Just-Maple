import { describe, it, expect } from 'vitest';
import { Binary, Long, ObjectId } from 'bson';
import { SqliteDatabase } from '../client';

describe('SQLite repository boundary', () => {
    it('round-trips bytes, unicode line separators and integers outside JS safe range', async () => {
        const storage = new SqliteDatabase(':memory:');
        await storage.ready;
        try {
            const id = new ObjectId(),
                bytes = new Binary(Buffer.from([0, 1, 255]));
            await storage.collection('roundtrip').insertOne({
                _id: id,
                title: '中文\u2028mail\u0085end',
                state: bytes,
                large: Long.fromString('9223372036854775807'),
                when: new Date(1234),
            });
            const doc = await storage.collection('roundtrip').findOne({ _id: id });
            expect(doc?.title).toBe('中文\u2028mail\u0085end');
            expect(Array.from(doc!.state.buffer)).toEqual([0, 1, 255]);
            expect(doc!.large.toString()).toBe('9223372036854775807');
            expect(doc!.when.getTime()).toBe(1234);
        } finally {
            await storage.close();
        }
    });
    it('updates only the matched sharing entry and filtered backlink', async () => {
        const storage = new SqliteDatabase(':memory:');
        await storage.ready;
        try {
            const c = storage.collection<{
                _id: string;
                sharing: { sharedWith: Array<{ userId: string; accessLevel: string }> };
                links: Array<{ id: string; title: string }>;
            }>('notebooks');
            await c.insertOne({
                _id: 'notebook',
                sharing: {
                    sharedWith: [
                        { userId: 'one', accessLevel: 'owner' },
                        { userId: 'two', accessLevel: 'read' },
                    ],
                },
                links: [
                    { id: 'a', title: 'A' },
                    { id: 'b', title: 'B' },
                ],
            });
            await c.updateOne(
                { _id: 'notebook', 'sharing.sharedWith.userId': 'two' },
                { $set: { 'sharing.sharedWith.$.accessLevel': 'write' } },
            );
            await c.updateMany(
                { _id: 'notebook' },
                { $set: { 'links.$[entry].title': 'Renamed' } },
                { arrayFilters: [{ 'entry.id': 'b' }] },
            );
            const row = await c.findOne({ _id: 'notebook' });
            expect(row!.sharing.sharedWith).toEqual([
                { userId: 'one', accessLevel: 'owner' },
                { userId: 'two', accessLevel: 'write' },
            ]);
            expect(row!.links).toEqual([
                { id: 'a', title: 'A' },
                { id: 'b', title: 'Renamed' },
            ]);
        } finally {
            await storage.close();
        }
    });
});
