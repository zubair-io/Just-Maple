import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildIndex, mergeIndex, findStaleEntries, parseIndexCache } from '../index-cache';
import type { IndexEntry, IndexCache } from '../index-cache';

const entry = (overrides: Partial<IndexEntry> = {}): IndexEntry => ({
    id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
    title: 'Test Page',
    type: 'memo',
    filename: 'test-page-a1b2c3.maple.md',
    modified: '2026-02-25T10:00:00Z',
    ...overrides,
});

describe('buildIndex', () => {
    it('creates an index with pages and lastIndexed timestamp', () => {
        const pages = [entry(), entry({ id: 'second', title: 'Second' })];
        const index = buildIndex(pages);
        expect(index.pages).toHaveLength(2);
        expect(index.lastIndexed).toBeTruthy();
    });

    it('does not share the same array reference', () => {
        const pages = [entry()];
        const index = buildIndex(pages);
        expect(index.pages).not.toBe(pages);
    });
});

describe('mergeIndex', () => {
    let base: IndexCache;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
        base = {
            pages: [
                entry({ id: 'page-1', title: 'Page 1' }),
                entry({ id: 'page-2', title: 'Page 2' }),
            ],
            lastIndexed: '2026-02-25T00:00:00Z',
        };
    });

    it('adds new entries', () => {
        const result = mergeIndex(base, {
            added: [entry({ id: 'page-3', title: 'Page 3' })],
            updated: [],
            removed: [],
        });
        expect(result.pages).toHaveLength(3);
        expect(result.pages.find((p) => p.id === 'page-3')).toBeTruthy();
    });

    it('removes entries', () => {
        const result = mergeIndex(base, {
            added: [],
            updated: [],
            removed: ['page-1'],
        });
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0]!.id).toBe('page-2');
    });

    it('updates existing entries', () => {
        const result = mergeIndex(base, {
            added: [],
            updated: [entry({ id: 'page-1', title: 'Updated Title' })],
            removed: [],
        });
        expect(result.pages).toHaveLength(2);
        expect(result.pages.find((p) => p.id === 'page-1')!.title).toBe('Updated Title');
    });

    it('updates lastIndexed timestamp', () => {
        const result = mergeIndex(base, { added: [], updated: [], removed: [] });
        expect(result.lastIndexed).toBe('2026-03-01T00:00:00.000Z');
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});

describe('findStaleEntries', () => {
    it('detects stale entries with mismatched modified timestamps', () => {
        const index: IndexCache = {
            pages: [entry({ id: 'p1', filename: 'a.maple.md', modified: '2026-01-01T00:00:00Z' })],
            lastIndexed: '2026-01-01T00:00:00Z',
        };
        const files = new Map([['a.maple.md', { modified: '2026-02-01T00:00:00Z' }]]);
        const result = findStaleEntries(index, files);
        expect(result.stale).toEqual(['p1']);
        expect(result.missing).toEqual([]);
    });

    it('detects missing entries when file no longer exists', () => {
        const index: IndexCache = {
            pages: [entry({ id: 'p1', filename: 'gone.maple.md' })],
            lastIndexed: '2026-01-01T00:00:00Z',
        };
        const files = new Map<string, { modified: string }>();
        const result = findStaleEntries(index, files);
        expect(result.missing).toEqual(['p1']);
        expect(result.stale).toEqual([]);
    });
});

describe('parseIndexCache', () => {
    it('parses valid JSON', () => {
        const json = JSON.stringify({
            pages: [entry()],
            lastIndexed: '2026-01-01T00:00:00Z',
        });
        const result = parseIndexCache(json);
        expect(result).not.toBeNull();
        expect(result!.pages).toHaveLength(1);
    });

    it('returns null for invalid JSON', () => {
        expect(parseIndexCache('not json')).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
        expect(parseIndexCache('{"foo": "bar"}')).toBeNull();
        expect(parseIndexCache('{"pages": "not-array", "lastIndexed": "x"}')).toBeNull();
    });
});
