import { Collection } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { getDb } from '../../db/client';
import { mongoAvailable } from '../../__tests__/setup';
import { incrementWebSearchUsage } from '../web-search-usage.repo';

describe.runIf(mongoAvailable)('web search usage', () => {
    it('counts searches per owner per UTC day and starts again the next day', async () => {
        const monday = new Date('2026-10-26T10:00:00Z');
        const lateMonday = new Date('2026-10-26T23:59:00Z');
        const tuesday = new Date('2026-10-27T00:01:00Z');

        expect(await incrementWebSearchUsage('owner-a', monday)).toBe(1);
        expect(await incrementWebSearchUsage('owner-a', lateMonday)).toBe(2);
        expect(await incrementWebSearchUsage('owner-b', monday)).toBe(1);
        expect(await incrementWebSearchUsage('owner-a', tuesday)).toBe(1);
        expect(await incrementWebSearchUsage('owner-a', tuesday)).toBe(2);
    });

    it('keeps one document per owner per day', async () => {
        const day = new Date('2026-10-26T10:00:00Z');
        await incrementWebSearchUsage('owner-c', day);
        await incrementWebSearchUsage('owner-c', new Date('2026-10-27T10:00:00Z'));
        const docs = await getDb()
            .collection('web_search_usage')
            .find({ ownerId: 'owner-c' })
            .sort({ day: 1 })
            .toArray();
        expect(docs.map((doc) => [doc._id, doc.count])).toEqual([
            ['owner-c:2026-10-26', 1],
            ['owner-c:2026-10-27', 1],
        ]);
    });

    it('retries when a racing first upsert hits a duplicate key', async () => {
        const original = Collection.prototype.findOneAndUpdate;
        const spy = vi
            .spyOn(Collection.prototype, 'findOneAndUpdate')
            .mockImplementationOnce(() =>
                Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 })),
            )
            .mockImplementation(function (this: Collection, ...args: unknown[]) {
                return (original as (...a: unknown[]) => unknown).apply(this, args) as never;
            });
        try {
            expect(await incrementWebSearchUsage('owner-e', new Date('2026-10-28T08:00:00Z'))).toBe(
                1,
            );
            expect(spy).toHaveBeenCalledTimes(2);
        } finally {
            spy.mockRestore();
        }
    });

    it('gives up on other errors', async () => {
        const spy = vi
            .spyOn(Collection.prototype, 'findOneAndUpdate')
            .mockRejectedValue(new Error('network'));
        try {
            await expect(incrementWebSearchUsage('owner-f')).rejects.toThrow('network');
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
        }
    });

    it('loses no count when the first searches of the day run at once', async () => {
        const day = new Date('2026-10-28T08:00:00Z');
        const counts = await Promise.all(
            Array.from({ length: 12 }, () => incrementWebSearchUsage('owner-d', day)),
        );
        expect([...counts].sort((a, b) => a - b)).toEqual(
            Array.from({ length: 12 }, (_, i) => i + 1),
        );
    });
});
