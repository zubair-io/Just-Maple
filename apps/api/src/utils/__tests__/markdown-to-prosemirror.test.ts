import { describe, it, expect } from 'vitest';
import { markdownToProseMirror } from '../markdown-to-prosemirror';

describe('markdownToProseMirror', () => {
    it('wraps plain paragraph text in a doc with a single paragraph node', () => {
        const doc = markdownToProseMirror('Just a plain sentence.');

        expect(doc.type).toBe('doc');
        expect(doc.content).toHaveLength(1);
        expect(doc.content?.[0]).toEqual({
            type: 'paragraph',
            content: [{ type: 'text', text: 'Just a plain sentence.' }],
        });
    });

    it('produces heading nodes with the correct level attribute', () => {
        const doc = markdownToProseMirror('# H1\n\n## H2\n\n### H3');

        const headings = (doc.content ?? []).filter((n) => n.type === 'heading');
        expect(headings).toHaveLength(3);
        expect(headings[0]).toEqual({
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'H1' }],
        });
        expect(headings[1]?.attrs?.['level']).toBe(2);
        expect(headings[2]?.attrs?.['level']).toBe(3);
    });

    it('applies bold and italic marks to inline text', () => {
        const doc = markdownToProseMirror('**bold text** and _italic text_');

        const paragraph = doc.content?.[0];
        expect(paragraph?.type).toBe('paragraph');

        const boldNode = paragraph?.content?.find((n) => n.text === 'bold text');
        expect(boldNode?.marks).toEqual([{ type: 'bold' }]);

        const italicNode = paragraph?.content?.find((n) => n.text === 'italic text');
        expect(italicNode?.marks).toEqual([{ type: 'italic' }]);
    });

    it('parses code_inline marks and link marks with href attrs', () => {
        const doc = markdownToProseMirror('some `inline code` and a [link](https://example.com)');

        const paragraph = doc.content?.[0];
        const codeNode = paragraph?.content?.find((n) => n.text === 'inline code');
        expect(codeNode?.marks).toEqual([{ type: 'code' }]);

        const linkNode = paragraph?.content?.find((n) => n.text === 'link');
        expect(linkNode?.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com' } }]);
    });

    it('parses unordered (bullet) lists into bulletList/listItem nodes', () => {
        const doc = markdownToProseMirror('- Item 1\n- Item 2\n- Item 3');

        const list = doc.content?.find((n) => n.type === 'bulletList');
        expect(list).toBeDefined();
        expect(list?.content).toHaveLength(3);
        expect(list?.content?.[0]).toEqual({
            type: 'listItem',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item 1' }],
                },
            ],
        });
    });

    it('parses ordered lists into orderedList/listItem nodes', () => {
        const doc = markdownToProseMirror('1. First\n2. Second\n3. Third');

        const list = doc.content?.find((n) => n.type === 'orderedList');
        expect(list).toBeDefined();
        expect(list?.content).toHaveLength(3);
        expect(list?.content?.[1]).toEqual({
            type: 'listItem',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Second' }],
                },
            ],
        });
    });

    // NOTE: markdownToProseMirror uses a plain `markdown-it` instance with no
    // task-list plugin registered, so GitHub-style `- [ ]`/`- [x]` checkbox
    // syntax is NOT recognized as a task list. It falls through to the same
    // bulletList/listItem handling as any other bullet, and the literal
    // "[ ] "/"[x] " prefix is preserved as plain text. This is unlike the
    // `markdownBodyToDoc` converter in packages/shared, which does produce a
    // `taskList`/`taskItem` node with enhanced attributes (id, checked,
    // priority, color, dueDate) per the Enhanced Todo Feature. Callers that
    // need real task list / checkbox support from raw markdown should not
    // rely on this function as-is.
    it('does not convert checkbox syntax into taskList/taskItem nodes (no task-list plugin registered)', () => {
        const doc = markdownToProseMirror('- [x] Done task\n- [ ] Not done task');

        expect(doc.content?.some((n) => n.type === 'taskList')).toBe(false);

        const list = doc.content?.find((n) => n.type === 'bulletList');
        expect(list).toBeDefined();
        expect(list?.content).toHaveLength(2);

        const firstItemText = list?.content?.[0]?.content?.[0]?.content?.[0];
        expect(firstItemText).toEqual({ type: 'text', text: '[x] Done task' });

        const secondItemText = list?.content?.[1]?.content?.[0]?.content?.[0];
        expect(secondItemText).toEqual({ type: 'text', text: '[ ] Not done task' });
    });

    it('parses fenced code blocks with a language attr and code content preserved as text', () => {
        const doc = markdownToProseMirror('```ts\nconst x: number = 1;\n```');

        const codeBlock = doc.content?.find((n) => n.type === 'codeBlock');
        expect(codeBlock).toBeDefined();
        expect(codeBlock?.attrs).toEqual({ language: 'ts' });
        expect(codeBlock?.content).toEqual([{ type: 'text', text: 'const x: number = 1;\n' }]);
    });

    it('parses fenced code blocks without a language as a null language attr', () => {
        const doc = markdownToProseMirror('```\nplain code\n```');

        const codeBlock = doc.content?.find((n) => n.type === 'codeBlock');
        expect(codeBlock?.attrs?.['language']).toBeNull();
    });

    it('returns a doc with a single empty paragraph for empty input', () => {
        const doc = markdownToProseMirror('');

        expect(doc.type).toBe('doc');
        expect(doc.content).toEqual([{ type: 'paragraph', content: [] }]);
    });

    it('returns a doc with a single empty paragraph for whitespace-only input', () => {
        const doc = markdownToProseMirror('   \n\n   \n');

        expect(doc.type).toBe('doc');
        expect(doc.content).toEqual([{ type: 'paragraph', content: [] }]);
    });
});
