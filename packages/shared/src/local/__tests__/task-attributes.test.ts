import { describe, it, expect } from 'vitest';
import { parseTaskAttributes, serializeTaskAttributes } from '../task-attributes';

describe('parseTaskAttributes', () => {
    it('parses a task with all attributes', () => {
        const line =
            '- [x] Review the proposal {priority: high, color: "#dc2626", due: 2026-03-01}';
        const result = parseTaskAttributes(line);
        expect(result).toEqual({
            text: 'Review the proposal',
            checked: true,
            attrs: { priority: 'high', color: '#dc2626', due: '2026-03-01' },
        });
    });

    it('parses a task with no attributes', () => {
        const line = '- [ ] Schedule next meeting';
        const result = parseTaskAttributes(line);
        expect(result).toEqual({
            text: 'Schedule next meeting',
            checked: false,
            attrs: {},
        });
    });

    it('parses a task with only priority', () => {
        const line = '- [ ] Send follow-up email {priority: medium}';
        const result = parseTaskAttributes(line);
        expect(result).toEqual({
            text: 'Send follow-up email',
            checked: false,
            attrs: { priority: 'medium' },
        });
    });

    it('parses a task with id attribute', () => {
        const line = '- [ ] Do something {id: abc123, priority: low}';
        const result = parseTaskAttributes(line);
        expect(result).toEqual({
            text: 'Do something',
            checked: false,
            attrs: { id: 'abc123', priority: 'low' },
        });
    });

    it('returns text unchanged for non-task lines', () => {
        const line = 'Just a regular paragraph.';
        const result = parseTaskAttributes(line);
        expect(result).toEqual({
            text: 'Just a regular paragraph.',
            checked: false,
            attrs: {},
        });
    });

    it('handles uppercase X checkbox', () => {
        const line = '- [X] Done task {priority: high}';
        const result = parseTaskAttributes(line);
        expect(result.checked).toBe(true);
        expect(result.attrs.priority).toBe('high');
    });
});

describe('serializeTaskAttributes', () => {
    it('serializes a task with all attributes', () => {
        const result = serializeTaskAttributes('Review the proposal', true, {
            priority: 'high',
            color: '#dc2626',
            due: '2026-03-01',
        });
        expect(result).toBe(
            '- [x] Review the proposal {priority: high, color: "#dc2626", due: 2026-03-01}',
        );
    });

    it('serializes a task with no attributes', () => {
        const result = serializeTaskAttributes('Simple task', false, {});
        expect(result).toBe('- [ ] Simple task');
    });

    it('round-trips a fully-attributed task', () => {
        const original =
            '- [x] Review the proposal {priority: high, color: "#dc2626", due: 2026-03-01, id: abc123}';
        const parsed = parseTaskAttributes(original);
        const serialized = serializeTaskAttributes(parsed.text, parsed.checked, parsed.attrs);
        expect(serialized).toBe(original);
    });

    it('round-trips a plain task', () => {
        const original = '- [ ] Just a task';
        const parsed = parseTaskAttributes(original);
        const serialized = serializeTaskAttributes(parsed.text, parsed.checked, parsed.attrs);
        expect(serialized).toBe(original);
    });
});
