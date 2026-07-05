import { describe, it, expect } from 'vitest';
import { toDisplaySlug, extractSlugId } from '../slug';

describe('toDisplaySlug', () => {
    it('builds a slug with a kebab-case title prefix and the shortId suffix', () => {
        expect(toDisplaySlug('My Notebook', 'a3k9m2x7')).toBe('my-notebook-a3k9m2x7');
    });

    it('strips special characters from the title', () => {
        expect(toDisplaySlug("What's Next? (2026)", 'ff00aa')).toBe('whats-next-2026-ff00aa');
    });

    it('collapses multiple spaces and hyphens into a single hyphen', () => {
        expect(toDisplaySlug('hello   world---test', 'abc123')).toBe('hello-world-test-abc123');
    });

    it('trims leading and trailing hyphens produced by stripped characters', () => {
        expect(toDisplaySlug('--Untitled--', 'xyz789')).toBe('untitled-xyz789');
    });

    it('returns just the shortId when the title is empty', () => {
        expect(toDisplaySlug('', 'a3k9m2x7')).toBe('a3k9m2x7');
    });

    it('returns just the shortId when the title has no usable characters', () => {
        expect(toDisplaySlug('!!!???', 'a3k9m2x7')).toBe('a3k9m2x7');
    });

    it('truncates the title prefix to 60 characters', () => {
        const longTitle = 'a'.repeat(100);
        expect(toDisplaySlug(longTitle, 'shortid1')).toBe(`${'a'.repeat(60)}-shortid1`);
    });

    it('lowercases mixed-case titles', () => {
        expect(toDisplaySlug('MiXeD CaSe TiTlE', 'id00001')).toBe('mixed-case-title-id00001');
    });

    it('preserves numbers already present in the title', () => {
        expect(toDisplaySlug('Q3 2026 Roadmap', 'id00002')).toBe('q3-2026-roadmap-id00002');
    });
});

describe('extractSlugId', () => {
    it('extracts the shortId from a slug with a title prefix', () => {
        expect(extractSlugId('my-notebook-a3k9m2x7')).toBe('a3k9m2x7');
    });

    it('extracts the shortId from a slug with a multi-word, multi-hyphen prefix', () => {
        expect(extractSlugId('hello-world-test-abc123')).toBe('abc123');
    });

    it('returns the whole string when there is no hyphen (shortId-only slug)', () => {
        expect(extractSlugId('a3k9m2x7')).toBe('a3k9m2x7');
    });

    it('returns an empty string for an empty input', () => {
        expect(extractSlugId('')).toBe('');
    });

    it('returns an empty string when the slug ends in a trailing hyphen', () => {
        expect(extractSlugId('my-notebook-')).toBe('');
    });

    it('returns an empty string for a slug made only of hyphens', () => {
        expect(extractSlugId('---')).toBe('');
    });

    it('handles a leading hyphen by returning everything after the last one', () => {
        expect(extractSlugId('-a3k9m2x7')).toBe('a3k9m2x7');
    });
});

describe('toDisplaySlug and extractSlugId round trip', () => {
    it('recovers the original shortId after building a display slug from a title', () => {
        const shortId = 'a3k9m2x7';
        expect(extractSlugId(toDisplaySlug('My Notebook', shortId))).toBe(shortId);
    });

    it('recovers the original shortId even when the title is empty', () => {
        const shortId = 'ff00aa';
        expect(extractSlugId(toDisplaySlug('', shortId))).toBe(shortId);
    });

    it('recovers the original shortId when the title has no usable characters', () => {
        const shortId = 'xyz789';
        expect(extractSlugId(toDisplaySlug('!!!', shortId))).toBe(shortId);
    });

    it('recovers the original shortId for titles containing numbers and hyphens', () => {
        const shortId = 'id00002';
        expect(extractSlugId(toDisplaySlug('Q3 2026 - Roadmap', shortId))).toBe(shortId);
    });
});
