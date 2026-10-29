import { describe, expect, it } from 'vitest';
import { LocalDedup } from '../local-dedup';

describe('single-process realtime deduplication', () => {
    it('suppresses an echo while accepting a different edit and expired retry', () => {
        const dedup = new LocalDedup();
        expect(dedup.accept('message:first-edit', 5, 1000)).toBe(true);
        expect(dedup.accept('message:first-edit', 5, 1001)).toBe(false);
        expect(dedup.accept('message:second-edit', 5, 1001)).toBe(true);
        expect(dedup.accept('message:first-edit', 5, 6000)).toBe(true);
    });
    it('bounds retained entries', () => {
        const dedup = new LocalDedup(2);
        for (const key of ['one', 'two', 'three']) expect(dedup.accept(key, 5, 1000)).toBe(true);
        expect(dedup.accept('two', 5, 1001)).toBe(false);
        expect(dedup.accept('one', 5, 1001)).toBe(true);
    });
});
