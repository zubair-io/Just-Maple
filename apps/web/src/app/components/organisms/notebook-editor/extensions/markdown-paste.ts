import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { marked } from 'marked';

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
  // Ordered list: 1. item — cap the marker at 3 digits so ordinary prose that
  // starts with a 4-digit year ("2024. It was a good year") isn't treated as a
  // list and mangled into <ol> on paste, while real short list numbers still match.
  /^\s*\d{1,3}\.\s+.+$/m,
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
 * Strip dangerous elements and attributes from HTML using an inert document.
 * `marked` does not sanitize, and the pasted text can contain raw HTML. This is
 * defense-in-depth: TipTap's schema parsing is the primary guard, but we also
 * remove script-bearing elements, event handlers, and javascript: URLs here so
 * nothing dangerous is ever handed to insertContent.
 */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, base').forEach((el) => {
    el.remove();
  });

  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      const isUrlAttr = name === 'href' || name === 'src' || name === 'xlink:href';
      if (name.startsWith('on') || (isUrlAttr && value.startsWith('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
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

  return sanitizeHtml(html);
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

            // Inside a code block, markdown source must be inserted literally —
            // let the default handler paste it verbatim rather than converting.
            if (view.state.selection.$from.parent.type.spec.code) {
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

            // Convert markdown to HTML and insert
            markdownToHtml(textContent)
              .then((html) => {
                // The editor may have been torn down while marked was parsing.
                if (editor.isDestroyed) {
                  return;
                }
                // Use editor.commands.insertContent to handle the HTML
                // This will properly convert HTML to ProseMirror nodes
                editor.commands.insertContent(html, {
                  parseOptions: {
                    preserveWhitespace: false,
                  },
                });
              })
              .catch((error) => {
                // If markdown parsing fails, log the error and fall back to plain text
                // eslint-disable-next-line no-console
                console.error('Failed to parse markdown on paste:', error);
                if (!editor.isDestroyed) {
                  editor.commands.insertContent(textContent);
                }
              });

            // Return true to indicate we handled the paste
            return true;
          },
        },
      }),
    ];
  },
});
