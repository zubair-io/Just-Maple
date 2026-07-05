import { describe, it, expect } from 'vitest';
import { proseMirrorToHtml, proseMirrorToHtmlDocument } from '../content-export';
import type { PageContent } from '../../schemas/page';

describe('proseMirrorToHtml', () => {
    it('converts a simple paragraph doc to an HTML fragment', () => {
        const doc: PageContent = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] }],
        };

        const html = proseMirrorToHtml(doc);

        expect(html).toBe('<p>Hello world.</p>');
        // Fragment output should not contain a full document shell
        expect(html).not.toContain('<html');
        expect(html).not.toContain('<body>');
    });

    it('converts a doc with multiple block types (heading, list, task list)', () => {
        const doc: PageContent = {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Project Plan' }],
                },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Intro text with ' },
                        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                        { type: 'text', text: '.' },
                    ],
                },
                {
                    type: 'bulletList',
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
                            ],
                        },
                    ],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: true, id: 'todo1', priority: 'high' },
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Done task' }],
                                },
                            ],
                        },
                        {
                            type: 'taskItem',
                            attrs: { checked: false, id: 'todo2' },
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Pending task' }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const html = proseMirrorToHtml(doc);

        expect(html).toContain('<h2>Project Plan</h2>');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>First</li>');
        expect(html).toContain('<li>Second</li>');
        expect(html).toContain('<ul class="task-list">');
        expect(html).toContain('<input type="checkbox" checked disabled /> Done task');
        expect(html).toContain('<input type="checkbox"  disabled /> Pending task');
    });

    it('escapes HTML special characters in text and code blocks', () => {
        const doc: PageContent = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '<script>alert("x")</script> & "quotes"' }],
                },
                {
                    type: 'codeBlock',
                    attrs: { language: 'html' },
                    content: [{ type: 'text', text: '<div>&nbsp;</div>' }],
                },
            ],
        };

        const html = proseMirrorToHtml(doc);

        expect(html).toContain(
            '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;',
        );
        expect(html).toContain(
            '<pre><code class="language-html">&lt;div&gt;&amp;nbsp;&lt;/div&gt;</code></pre>',
        );
    });

    it('returns an empty string for an empty/missing doc', () => {
        expect(proseMirrorToHtml(undefined)).toBe('');
        expect(proseMirrorToHtml(null)).toBe('');
        expect(proseMirrorToHtml({ type: 'doc', content: [] } as PageContent)).toBe('');
        expect(proseMirrorToHtml({ type: 'notADoc', content: [] } as unknown as PageContent)).toBe(
            '',
        );
    });
});

describe('proseMirrorToHtmlDocument', () => {
    it('wraps the body fragment in a full HTML document', () => {
        const doc: PageContent = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] }],
        };

        const html = proseMirrorToHtmlDocument(doc, 'My Memo');

        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<head>');
        expect(html).toContain('<title>My Memo</title>');
        expect(html).toContain('<body>\n<p>Hello world.</p>\n</body>');
        expect(html).toContain('</html>');
    });

    it('falls back to a default title and escapes a provided title', () => {
        const doc: PageContent = { type: 'doc', content: [] };

        const withoutTitle = proseMirrorToHtmlDocument(doc);
        expect(withoutTitle).toContain('<title>Exported Memo</title>');

        const withUnsafeTitle = proseMirrorToHtmlDocument(doc, '<b>Notes</b> & "Ideas"');
        expect(withUnsafeTitle).toContain(
            '<title>&lt;b&gt;Notes&lt;/b&gt; &amp; &quot;Ideas&quot;</title>',
        );
    });

    it('produces a different output shape than proseMirrorToHtml for the same doc', () => {
        const doc: PageContent = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] }],
        };

        const fragment = proseMirrorToHtml(doc);
        const fullDocument = proseMirrorToHtmlDocument(doc);

        // The fragment is just the inner content; the full document wraps it with
        // doctype/html/head/body plus embedded styles.
        expect(fragment).toBe('<p>Body text.</p>');
        expect(fullDocument).not.toBe(fragment);
        expect(fullDocument).toContain(fragment);
        expect(fullDocument).toContain('<style>');
        expect(fullDocument.length).toBeGreaterThan(fragment.length);
    });

    it('renders an empty document as an empty body', () => {
        const html = proseMirrorToHtmlDocument({ type: 'doc', content: [] });
        expect(html).toContain('<body>\n\n</body>');
    });
});
