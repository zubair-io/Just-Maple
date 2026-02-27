import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter';
import type { FrontmatterMeta } from '../frontmatter';

const VALID_DOC = `---
id: a1b2c3d4-5678-90ab-cdef-1234567890ab
type: memo
created: 2026-02-25T10:30:00Z
modified: 2026-02-25T14:22:00Z
tags: [project, planning]
---
# Meeting Notes

Some paragraph text.
`;

describe('parseFrontmatter', () => {
    it('parses valid frontmatter with all required fields', () => {
        const result = parseFrontmatter(VALID_DOC);
        expect('error' in result).toBe(false);
        if ('meta' in result) {
            expect(result.meta.id).toBe('a1b2c3d4-5678-90ab-cdef-1234567890ab');
            expect(result.meta.type).toBe('memo');
            expect(result.meta.created).toBe('2026-02-25T10:30:00Z');
            expect(result.meta.modified).toBe('2026-02-25T14:22:00Z');
            expect(result.meta.tags).toEqual(['project', 'planning']);
            expect(result.body).toBe('# Meeting Notes\n\nSome paragraph text.\n');
        }
    });

    it('returns error when frontmatter delimiters are missing', () => {
        const result = parseFrontmatter('# Just a heading\n\nNo frontmatter here.');
        expect(result).toEqual({
            error: 'No YAML frontmatter found (expected --- delimiters)',
        });
    });

    it('returns error for missing required field', () => {
        const incomplete = `---
id: abc-123
type: memo
created: 2026-01-01T00:00:00Z
---
Body here.
`;
        const result = parseFrontmatter(incomplete);
        expect(result).toEqual({
            error: 'Missing required frontmatter field: "modified"',
        });
    });

    it('returns error for invalid YAML', () => {
        const bad = `---
id: "unclosed string
type: memo
---
Body.
`;
        const result = parseFrontmatter(bad);
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('Invalid YAML');
        }
    });

    it('preserves unknown fields for forward compatibility', () => {
        const doc = `---
id: test-id
type: memo
created: 2026-01-01T00:00:00Z
modified: 2026-01-01T00:00:00Z
customField: hello
nested:
  key: value
---
Body.
`;
        const result = parseFrontmatter(doc);
        expect('meta' in result).toBe(true);
        if ('meta' in result) {
            expect(result.meta.customField).toBe('hello');
            expect(result.meta.nested).toEqual({ key: 'value' });
        }
    });

    it('handles empty body after frontmatter', () => {
        const doc = `---
id: test-id
type: memo
created: 2026-01-01T00:00:00Z
modified: 2026-01-01T00:00:00Z
---
`;
        const result = parseFrontmatter(doc);
        expect('meta' in result).toBe(true);
        if ('meta' in result) {
            expect(result.body).toBe('');
        }
    });
});

describe('serializeFrontmatter', () => {
    it('serializes meta and body into a valid .maple.md string', () => {
        const meta: FrontmatterMeta = {
            id: 'test-id',
            type: 'memo',
            created: '2026-01-01T00:00:00Z',
            modified: '2026-01-02T00:00:00Z',
        };
        const body = '# Hello\n\nWorld.\n';
        const result = serializeFrontmatter(meta, body);

        expect(result).toContain('---\n');
        expect(result).toContain('id: test-id\n');
        expect(result).toContain('type: memo\n');
        expect(result.endsWith('---\n# Hello\n\nWorld.\n')).toBe(true);
    });

    it('round-trips correctly through parse → serialize', () => {
        const result = parseFrontmatter(VALID_DOC);
        expect('meta' in result).toBe(true);
        if ('meta' in result) {
            const serialized = serializeFrontmatter(result.meta, result.body);
            const reparsed = parseFrontmatter(serialized);
            expect('meta' in reparsed).toBe(true);
            if ('meta' in reparsed) {
                expect(reparsed.meta.id).toBe(result.meta.id);
                expect(reparsed.meta.type).toBe(result.meta.type);
                expect(reparsed.meta.tags).toEqual(result.meta.tags);
                expect(reparsed.body).toBe(result.body);
            }
        }
    });

    it('handles meta with todoMeta object', () => {
        const meta: FrontmatterMeta = {
            id: 'test-id',
            type: 'memo',
            created: '2026-01-01T00:00:00Z',
            modified: '2026-01-02T00:00:00Z',
            todoMeta: {
                hasTodos: true,
                todoCount: 3,
                completedCount: 1,
                overdueCount: 0,
            },
        };
        const serialized = serializeFrontmatter(meta, '');
        const reparsed = parseFrontmatter(serialized);
        expect('meta' in reparsed).toBe(true);
        if ('meta' in reparsed) {
            expect(reparsed.meta.todoMeta).toEqual(meta.todoMeta);
        }
    });
});
