import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MarkdownPaste, isMarkdownContent, markdownToHtml } from '../markdown-paste';

describe('Markdown Paste Extension', () => {
  describe('isMarkdownContent', () => {
    describe('should detect headers', () => {
      it('should detect h1 headers', () => {
        expect(isMarkdownContent('# Header')).toBe(true);
      });

      it('should detect h2 headers', () => {
        expect(isMarkdownContent('## Header')).toBe(true);
      });

      it('should detect h3 headers', () => {
        expect(isMarkdownContent('### Header')).toBe(true);
      });

      it('should detect h6 headers', () => {
        expect(isMarkdownContent('###### Header')).toBe(true);
      });
    });

    describe('should detect text formatting', () => {
      it('should detect bold with asterisks', () => {
        expect(isMarkdownContent('**bold text**')).toBe(true);
      });

      it('should detect bold with underscores', () => {
        expect(isMarkdownContent('__bold text__')).toBe(true);
      });

      it('should detect italic with asterisks', () => {
        expect(isMarkdownContent('*italic text*')).toBe(true);
      });

      it('should detect italic with underscores', () => {
        expect(isMarkdownContent('_italic text_')).toBe(true);
      });

      it('should detect strikethrough', () => {
        expect(isMarkdownContent('~~strikethrough~~')).toBe(true);
      });
    });

    describe('should detect code', () => {
      it('should detect inline code', () => {
        expect(isMarkdownContent('`inline code`')).toBe(true);
      });

      it('should detect code blocks', () => {
        expect(isMarkdownContent('```\ncode block\n```')).toBe(true);
      });

      it('should detect code blocks with language', () => {
        expect(isMarkdownContent('```javascript\nconst x = 1;\n```')).toBe(true);
      });
    });

    describe('should detect lists', () => {
      it('should detect unordered list with dash', () => {
        expect(isMarkdownContent('- list item')).toBe(true);
      });

      it('should detect unordered list with asterisk', () => {
        expect(isMarkdownContent('* list item')).toBe(true);
      });

      it('should detect unordered list with plus', () => {
        expect(isMarkdownContent('+ list item')).toBe(true);
      });

      it('should detect ordered list', () => {
        expect(isMarkdownContent('1. list item')).toBe(true);
      });

      it('should detect ordered list with higher numbers', () => {
        expect(isMarkdownContent('10. list item')).toBe(true);
      });
    });

    describe('should detect blockquotes', () => {
      it('should detect blockquote', () => {
        expect(isMarkdownContent('> quoted text')).toBe(true);
      });
    });

    describe('should detect links and images', () => {
      it('should detect links', () => {
        expect(isMarkdownContent('[link text](https://example.com)')).toBe(true);
      });

      it('should detect images', () => {
        expect(isMarkdownContent('![alt text](https://example.com/image.png)')).toBe(true);
      });

      it('should detect images with empty alt', () => {
        expect(isMarkdownContent('![](https://example.com/image.png)')).toBe(true);
      });
    });

    describe('should detect horizontal rules', () => {
      it('should detect horizontal rule with dashes', () => {
        expect(isMarkdownContent('---')).toBe(true);
      });

      it('should detect horizontal rule with asterisks', () => {
        expect(isMarkdownContent('***')).toBe(true);
      });

      it('should detect horizontal rule with underscores', () => {
        expect(isMarkdownContent('___')).toBe(true);
      });

      it('should detect longer horizontal rules', () => {
        expect(isMarkdownContent('----------')).toBe(true);
      });
    });

    describe('should detect tables', () => {
      it('should detect table row', () => {
        expect(isMarkdownContent('| cell1 | cell2 |')).toBe(true);
      });
    });

    describe('should detect task lists', () => {
      it('should detect unchecked task', () => {
        expect(isMarkdownContent('[ ] task')).toBe(true);
      });

      it('should detect checked task', () => {
        expect(isMarkdownContent('[x] task')).toBe(true);
      });

      it('should detect checked task with uppercase X', () => {
        expect(isMarkdownContent('[X] task')).toBe(true);
      });
    });

    describe('should NOT detect plain text', () => {
      it('should not detect plain text', () => {
        expect(isMarkdownContent('Hello, this is plain text.')).toBe(false);
      });

      it('should not detect very short strings', () => {
        expect(isMarkdownContent('Hi')).toBe(false);
      });

      it('should not detect single characters', () => {
        expect(isMarkdownContent('#')).toBe(false);
      });

      it('should not detect email addresses', () => {
        expect(isMarkdownContent('email@example.com')).toBe(false);
      });

      it('should not detect hashtags without space', () => {
        expect(isMarkdownContent('#hashtag')).toBe(false);
      });
    });

    describe('should handle multiline content', () => {
      it('should detect markdown in multiline text', () => {
        const content = `Some text here
# This is a header
More text below`;
        expect(isMarkdownContent(content)).toBe(true);
      });

      it('should detect list in multiline text', () => {
        const content = `Shopping list:
- Apples
- Bananas
- Oranges`;
        expect(isMarkdownContent(content)).toBe(true);
      });
    });
  });

  describe('markdownToHtml', () => {
    it('should convert header to HTML', async () => {
      const html = await markdownToHtml('# Hello');
      expect(html).toContain('<h1>');
      expect(html).toContain('Hello');
      expect(html).toContain('</h1>');
    });

    it('should convert bold to HTML', async () => {
      const html = await markdownToHtml('**bold**');
      expect(html).toContain('<strong>');
      expect(html).toContain('bold');
      expect(html).toContain('</strong>');
    });

    it('should convert italic to HTML', async () => {
      const html = await markdownToHtml('*italic*');
      expect(html).toContain('<em>');
      expect(html).toContain('italic');
      expect(html).toContain('</em>');
    });

    it('should convert unordered list to HTML', async () => {
      const html = await markdownToHtml('- item 1\n- item 2');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>');
      expect(html).toContain('item 1');
      expect(html).toContain('item 2');
    });

    it('should convert ordered list to HTML', async () => {
      const html = await markdownToHtml('1. first\n2. second');
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>');
      expect(html).toContain('first');
      expect(html).toContain('second');
    });

    it('should convert code block to HTML', async () => {
      const html = await markdownToHtml('```\nconst x = 1;\n```');
      expect(html).toContain('<code>');
      expect(html).toContain('const x = 1;');
    });

    it('should convert inline code to HTML', async () => {
      const html = await markdownToHtml('Use `console.log()` here');
      expect(html).toContain('<code>');
      expect(html).toContain('console.log()');
    });

    it('should convert blockquote to HTML', async () => {
      const html = await markdownToHtml('> This is a quote');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('This is a quote');
    });

    it('should convert link to HTML', async () => {
      const html = await markdownToHtml('[Click here](https://example.com)');
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('Click here');
    });

    it('should convert horizontal rule to HTML', async () => {
      const html = await markdownToHtml('---');
      expect(html).toContain('<hr');
    });

    it('should handle GFM tables', async () => {
      const markdown = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;
      const html = await markdownToHtml(markdown);
      expect(html).toContain('<table>');
      expect(html).toContain('<th>');
      expect(html).toContain('<td>');
    });

    it('should convert line breaks with GFM', async () => {
      const html = await markdownToHtml('Line 1\nLine 2');
      expect(html).toContain('<br');
    });

    it('should handle strikethrough', async () => {
      const html = await markdownToHtml('~~deleted~~');
      expect(html).toContain('<del>');
      expect(html).toContain('deleted');
    });

    it('should handle task lists', async () => {
      const html = await markdownToHtml('- [ ] unchecked\n- [x] checked');
      expect(html).toContain('type="checkbox"');
    });
  });

  describe('MarkdownPaste Extension Registration', () => {
    let editor: Editor;

    beforeEach(() => {
      editor = new Editor({
        extensions: [StarterKit, MarkdownPaste],
        content: '<p>Test content</p>',
      });
    });

    afterEach(() => {
      editor?.destroy();
    });

    it('should register the markdownPaste extension', () => {
      const extension = editor.extensionManager.extensions.find(
        (ext) => ext.name === 'markdownPaste',
      );
      expect(extension).toBeDefined();
    });

    it('should add ProseMirror plugin', () => {
      const plugins = editor.view.state.plugins;
      const markdownPastePlugin = plugins.find((plugin) => {
        const key = (plugin as any).key;
        return key && key.includes && key.includes('markdownPaste');
      });
      expect(markdownPastePlugin).toBeDefined();
    });
  });

  describe('Complex markdown scenarios', () => {
    it('should detect nested formatting', () => {
      expect(isMarkdownContent('**bold with _nested italic_**')).toBe(true);
    });

    it('should detect code with special characters', () => {
      expect(isMarkdownContent('`const arr = [1, 2, 3]`')).toBe(true);
    });

    it('should handle real-world markdown document', () => {
      const document = `# Project README

## Installation

\`\`\`bash
npm install my-package
\`\`\`

## Features

- Feature 1
- Feature 2
- Feature 3

## Usage

Here's how to use the package:

1. Import the module
2. Configure options
3. Call the function

> Note: This is important!

For more info, visit [our website](https://example.com).`;

      expect(isMarkdownContent(document)).toBe(true);
    });

    it('should convert complex document to HTML', async () => {
      const markdown = `# Title

Some **bold** and *italic* text.

- List item 1
- List item 2

\`\`\`js
console.log('hello');
\`\`\``;

      const html = await markdownToHtml(markdown);

      expect(html).toContain('<h1>');
      expect(html).toContain('<strong>');
      expect(html).toContain('<em>');
      expect(html).toContain('<ul>');
      expect(html).toContain('<pre><code');
    });
  });
});
