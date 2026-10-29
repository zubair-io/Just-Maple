import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { documentToMarkdown, docToMarkdown } from '../document-to-markdown';
import { markdownToDocument, markdownBodyToDoc } from '../markdown-to-document';
import type { ProseMirrorNode } from '../markdown-to-document';
import type { FrontmatterMeta } from '../frontmatter';
import type { PageContent } from '../../schemas/page';

const FIXTURES_DIR = join(__dirname, '..', '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('markdownToDocument', () => {
  it('parses a simple memo fixture', () => {
    const raw = readFixture('simple-memo.maple.md');
    const result = markdownToDocument(raw);
    expect('error' in result).toBe(false);
    if ('doc' in result) {
      expect(result.meta.id).toBe('a1b2c3d4-5678-90ab-cdef-1234567890ab');
      expect(result.meta.type).toBe('memo');
      expect(result.doc.type).toBe('doc');
      expect(result.doc.content).toBeDefined();

      // Should have heading, paragraph, and bullet list
      const types = result.doc.content!.map((n) => n.type);
      expect(types).toContain('heading');
      expect(types).toContain('paragraph');
      expect(types).toContain('bulletList');
    }
  });

  it('parses frontmatter with all fields', () => {
    const raw = readFixture('complex-memo.maple.md');
    const result = markdownToDocument(raw);
    expect('error' in result).toBe(false);
    if ('meta' in result) {
      expect(result.meta.tags).toEqual(['project', 'planning', 'review']);
      expect(result.meta.isFavorite).toBe(true);
      expect(result.meta.todoMeta).toBeDefined();
    }
  });

  it('returns error for files without frontmatter', () => {
    const result = markdownToDocument('# Just a heading\n\nNo frontmatter.');
    expect('error' in result).toBe(true);
  });
});

describe('markdownBodyToDoc — block types', () => {
  it('parses headings at different levels', () => {
    const doc = markdownBodyToDoc('# H1\n\n## H2\n\n### H3');
    const headings = doc.content!.filter((n) => n.type === 'heading');
    expect(headings).toHaveLength(3);
    expect(headings[0]!.attrs?.['level']).toBe(1);
    expect(headings[1]!.attrs?.['level']).toBe(2);
    expect(headings[2]!.attrs?.['level']).toBe(3);
  });

  it('parses paragraphs', () => {
    const doc = markdownBodyToDoc('First paragraph.\n\nSecond paragraph.');
    const paragraphs = doc.content!.filter((n) => n.type === 'paragraph');
    expect(paragraphs).toHaveLength(2);
  });

  it('parses bullet lists', () => {
    const doc = markdownBodyToDoc('- Item 1\n- Item 2\n- Item 3');
    const list = doc.content!.find((n) => n.type === 'bulletList');
    expect(list).toBeDefined();
    expect(list!.content).toHaveLength(3);
  });

  it('parses ordered lists', () => {
    const doc = markdownBodyToDoc('1. First\n2. Second\n3. Third');
    const list = doc.content!.find((n) => n.type === 'orderedList');
    expect(list).toBeDefined();
    expect(list!.content).toHaveLength(3);
  });

  it('parses task lists with enhanced attributes', () => {
    const body = `- [x] Done task {priority: high, color: "#dc2626", due: 2026-03-01, id: t1}
- [ ] Pending task {priority: medium}
- [ ] Plain task`;
    const doc = markdownBodyToDoc(body);
    const taskList = doc.content!.find((n) => n.type === 'taskList');
    expect(taskList).toBeDefined();
    expect(taskList!.content).toHaveLength(3);

    const first = taskList!.content![0]!;
    expect(first.attrs?.['checked']).toBe(true);
    expect(first.attrs?.['priority']).toBe('high');
    expect(first.attrs?.['color']).toBe('#dc2626');
    expect(first.attrs?.['dueDate']).toBe('2026-03-01');
    expect(first.attrs?.['id']).toBe('t1');

    const second = taskList!.content![1]!;
    expect(second.attrs?.['checked']).toBe(false);
    expect(second.attrs?.['priority']).toBe('medium');
  });

  it('parses code blocks with language', () => {
    const doc = markdownBodyToDoc('```python\nprint("hello")\n```');
    const code = doc.content!.find((n) => n.type === 'codeBlock');
    expect(code).toBeDefined();
    expect(code!.attrs?.['language']).toBe('python');
    expect(code!.content![0]!.text).toBe('print("hello")');
  });

  it('parses blockquotes', () => {
    const doc = markdownBodyToDoc('> A quote.\n> Second line.');
    const bq = doc.content!.find((n) => n.type === 'blockquote');
    expect(bq).toBeDefined();
  });

  it('parses horizontal rules', () => {
    const doc = markdownBodyToDoc('Before.\n\n---\n\nAfter.');
    const hr = doc.content!.find((n) => n.type === 'horizontalRule');
    expect(hr).toBeDefined();
  });

  it('parses tables', () => {
    const body = `| A | B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |`;
    const doc = markdownBodyToDoc(body);
    const table = doc.content!.find((n) => n.type === 'table');
    expect(table).toBeDefined();
    expect(table!.content).toHaveLength(3); // header + 2 body rows
  });

  it('parses maple:image typed blocks', () => {
    const body = `\`\`\`maple:image
{
  "src": "./assets/3a7f2b.png",
  "alt": "Screenshot",
  "width": 600
}
\`\`\``;
    const doc = markdownBodyToDoc(body);
    const img = doc.content!.find((n) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img!.attrs?.['src']).toBe('./assets/3a7f2b.png');
    expect(img!.attrs?.['width']).toBe(600);
  });

  it('parses maple:embed typed blocks', () => {
    const body = `\`\`\`maple:embed
{"url": "https://example.com", "title": "Example"}
\`\`\``;
    const doc = markdownBodyToDoc(body);
    const embed = doc.content!.find((n) => n.type === 'embed');
    expect(embed).toBeDefined();
    expect(embed!.attrs?.['url']).toBe('https://example.com');
  });
});

describe('markdownBodyToDoc — inline marks', () => {
  it('parses bold text', () => {
    const doc = markdownBodyToDoc('This is **bold** text.');
    const para = doc.content![0]!;
    const boldNode = para.content!.find((n) => n.marks?.some((m) => m.type === 'bold'));
    expect(boldNode).toBeDefined();
    expect(boldNode!.text).toBe('bold');
  });

  it('parses italic text', () => {
    const doc = markdownBodyToDoc('This is *italic* text.');
    const para = doc.content![0]!;
    const italicNode = para.content!.find((n) => n.marks?.some((m) => m.type === 'italic'));
    expect(italicNode).toBeDefined();
  });

  it('parses inline code', () => {
    const doc = markdownBodyToDoc('Use `code` here.');
    const para = doc.content![0]!;
    const codeNode = para.content!.find((n) => n.marks?.some((m) => m.type === 'code'));
    expect(codeNode).toBeDefined();
    expect(codeNode!.text).toBe('code');
  });

  it('parses links', () => {
    const doc = markdownBodyToDoc('Click [here](https://example.com).');
    const para = doc.content![0]!;
    const linkNode = para.content!.find((n) => n.marks?.some((m) => m.type === 'link'));
    expect(linkNode).toBeDefined();
    const linkMark = linkNode!.marks!.find((m) => m.type === 'link');
    expect(linkMark!.attrs?.['href']).toBe('https://example.com');
  });

  it('parses [[pageLink]] syntax', () => {
    const doc = markdownBodyToDoc('See [[d4e5f6|Project Plan]] for details.');
    const para = doc.content![0]!;
    const pageLink = para.content!.find((n) => n.type === 'pageLink');
    expect(pageLink).toBeDefined();
    expect(pageLink!.attrs?.['shortId']).toBe('d4e5f6');
    expect(pageLink!.attrs?.['title']).toBe('Project Plan');
  });

  it('parses underline via <u> tags', () => {
    const doc = markdownBodyToDoc('This is <u>underlined</u> text.');
    const para = doc.content![0]!;
    const underlineNode = para.content!.find((n) => n.marks?.some((m) => m.type === 'underline'));
    expect(underlineNode).toBeDefined();
    expect(underlineNode!.text).toBe('underlined');
  });
});

describe('documentToMarkdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('converts a simple doc to markdown with frontmatter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));

    const doc: PageContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Hello' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'World.' }] },
      ],
    };
    const meta: FrontmatterMeta = {
      id: 'test-id',
      type: 'memo',
      created: '2026-02-25T00:00:00Z',
      modified: '2026-02-25T00:00:00Z',
    };

    const result = documentToMarkdown(doc, meta);
    expect(result).toContain('---');
    expect(result).toContain('id: test-id');
    expect(result).toContain('# Hello');
    expect(result).toContain('World.');
    // modified should be updated
    expect(meta.modified).toBe('2026-03-01T00:00:00.000Z');
  });

  it('serializes task lists with enhanced attributes', () => {
    const doc: PageContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: {
                checked: true,
                priority: 'high',
                color: '#dc2626',
                id: 'todo1',
              },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Done task' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pending' }] }],
            },
          ],
        },
      ],
    };

    const md = docToMarkdown(doc);
    expect(md).toContain('- [x] Done task {priority: high, color: "#dc2626", id: todo1}');
    expect(md).toContain('- [ ] Pending');
  });
});

describe('round-trip fidelity', () => {
  it('round-trips heading + paragraph', () => {
    const body = '# Hello\n\nWorld.';
    const doc = markdownBodyToDoc(body);
    const md = docToMarkdown(doc as PageContent);
    expect(md).toContain('# Hello');
    expect(md).toContain('World.');
  });

  it('round-trips bullet list', () => {
    const body = '- Alpha\n- Beta\n- Gamma';
    const doc = markdownBodyToDoc(body);
    const md = docToMarkdown(doc as PageContent);
    expect(md).toContain('- Alpha');
    expect(md).toContain('- Beta');
    expect(md).toContain('- Gamma');
  });

  it('round-trips code block', () => {
    const body = '```python\nprint("hello")\n```';
    const doc = markdownBodyToDoc(body);
    const md = docToMarkdown(doc as PageContent);
    expect(md).toContain('```python');
    expect(md).toContain('print("hello")');
  });

  it('round-trips the complex fixture', () => {
    const raw = readFixture('complex-memo.maple.md');
    const result = markdownToDocument(raw);
    expect('doc' in result).toBe(true);
    if ('doc' in result) {
      const md = docToMarkdown(result.doc as PageContent);
      // Key content should survive
      expect(md).toContain('# Project Plan');
      expect(md).toContain('**bold**');
      expect(md).toContain('`inline code`');
      expect(md).toContain('priority: high');
      expect(md).toContain('```python');
    }
  });

  it('round-trips the edge-cases fixture (empty body)', () => {
    const raw = readFixture('edge-cases.maple.md');
    const result = markdownToDocument(raw);
    expect('doc' in result).toBe(true);
    if ('doc' in result) {
      expect(result.meta.tags).toEqual([]);
    }
  });
});
