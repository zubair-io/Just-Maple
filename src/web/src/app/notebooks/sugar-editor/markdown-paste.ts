import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { marked } from 'marked';
import { markdownBodyToDoc } from './markdown-to-document';

/**
 * Markdown Paste Extension
 * Detects markdown content when pasting and converts it to rich text
 */

// Patterns that indicate markdown content
const MARKDOWN_PATTERNS = [
  /^#{1,6}\s+.+$/m, // Headers: # Header
  /^\*\*[^*]+\*\*/, // Bold: **text**
  /^__[^_]+__/, // Bold: __text__
  /^\*[^*]+\*/, // Italic: *text*
  /^_[^_]+_/, // Italic: _text_
  /^~~[^~]+~~/, // Strikethrough: ~~text~~
  /^`[^`]+`/, // Inline code: `code`
  /^```[\s\S]*?```/m, // Code block: ```code```
  /^\s*[-*+]\s+.+$/m, // Unordered list: - item
  /^\s*\d+\.\s+.+$/m, // Ordered list: 1. item
  /^\s*>\s+.+$/m, // Blockquote: > quote
  /^\s*\[.+\]\(.+\)/, // Link: [text](url)
  /^\s*!\[.*\]\(.+\)/, // Image: ![alt](url)
  /^\s*-{3,}$/m, // Horizontal rule: ---
  /^\s*\*{3,}$/m, // Horizontal rule: ***
  /^\s*_{3,}$/m, // Horizontal rule: ___
  /^\s*\|.+\|$/m, // Table: | cell |
  /^\s*\[[ x]\]/im, // Task list: [ ] or [x]
];

/**
 * Checks if text content appears to be markdown
 * @exported for testing
 */
export function isMarkdownContent(text: string): boolean {
  // Ignore very short strings
  if (text.length < 3) {
    return false;
  }

  // Check if any markdown pattern matches
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Convert markdown to HTML using marked
 * @exported for testing
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  // Configure marked for safe HTML output
  const html = await marked.parse(markdown, {
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert line breaks to <br>
  });

  return html;
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(view, event, slice) {
            const clipboardData = event.clipboardData;
            if (!clipboardData) {
              return false;
            }

            // Check if HTML content is available - if so, let default handler process it
            // This prevents double-processing of rich content (e.g., from web pages)
            const htmlContent = clipboardData.getData('text/html');
            if (htmlContent && htmlContent.trim()) {
              // HTML content exists, let TipTap's default handler process it
              return false;
            }

            // Get plain text content
            const textContent = clipboardData.getData('text/plain');
            if (!textContent || !textContent.trim()) {
              return false;
            }

            // Check if the text looks like markdown
            if (!isMarkdownContent(textContent)) {
              // Not markdown, let default handler process it
              return false;
            }

            // Prevent default paste handling
            event.preventDefault();

            // Use the copied parser directly: preserve checkboxes and avoid an
            // asynchronous HTML paste applying at a subsequently moved cursor.
            try {editor.commands.insertContent(markdownBodyToDoc(textContent).content || []);}
            catch {view.dispatch(view.state.tr.insertText(textContent));}

            // Return true to indicate we handled the paste
            return true;
          },
        },
      }),
    ];
  },
});
