import { Injectable } from '@angular/core';
import { MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import { MarkdownParser } from 'prosemirror-markdown';
import MarkdownIt from 'markdown-it';
import type { Node as ProseMirrorNode, Schema, Mark } from '@tiptap/pm/model';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';

// ─── Serializer helpers ────────────────────────────────────────────

function serializeAttrsComment(prefix: string, attrs: Record<string, unknown>): string {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => {
      if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    });
  if (parts.length === 0) return '';
  return `<!-- ${prefix}:${parts.join(',')} -->`;
}

function parseAttrsComment(text: string, prefix: string): Record<string, string> | null {
  const re = new RegExp(`<!--\\s*${prefix}:(.+?)\\s*-->`);
  const match = text.match(re);
  if (!match) return null;

  const result: Record<string, string> = {};
  // Parse key=value pairs, being careful with JSON values
  const raw = match[1];
  let i = 0;
  while (i < raw.length) {
    const eqIdx = raw.indexOf('=', i);
    if (eqIdx === -1) break;
    const key = raw.slice(i, eqIdx);

    let value: string;
    if (raw[eqIdx + 1] === '{' || raw[eqIdx + 1] === '[') {
      // JSON value — find matching close brace
      const open = raw[eqIdx + 1];
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let j = eqIdx + 1;
      for (; j < raw.length; j++) {
        if (raw[j] === open) depth++;
        if (raw[j] === close) depth--;
        if (depth === 0) break;
      }
      value = raw.slice(eqIdx + 1, j + 1);
      i = j + 2; // skip past comma
    } else {
      const commaIdx = raw.indexOf(',', eqIdx + 1);
      if (commaIdx === -1) {
        value = raw.slice(eqIdx + 1);
        i = raw.length;
      } else {
        value = raw.slice(eqIdx + 1, commaIdx);
        i = commaIdx + 1;
      }
    }
    result[key.trim()] = value.trim();
  }
  return result;
}

// ─── Node serializers ──────────────────────────────────────────────

const nodes: Record<
  string,
  (
    state: MarkdownSerializerState,
    node: ProseMirrorNode,
    parent: ProseMirrorNode,
    index: number,
  ) => void
> = {
  doc(state, node) {
    state.renderContent(node);
  },

  paragraph(state, node) {
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading(state, node) {
    state.write('#'.repeat(node.attrs['level']) + ' ');
    state.renderInline(node);
    state.closeBlock(node);
  },

  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
  },

  codeBlock(state, node) {
    const lang = node.attrs['language'] || '';
    state.write('```' + lang + '\n');
    state.text(node.textContent, false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  horizontalRule(state, node) {
    state.write('---');
    state.closeBlock(node);
  },

  hardBreak(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n');
        return;
      }
    }
  },

  bulletList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },

  orderedList(state, node) {
    const start = node.attrs['start'] || 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = '  '.repeat(maxW);
    state.renderList(node, space + ' ', (i: number) => {
      const nStr = String(start + i);
      return ' '.repeat(maxW - nStr.length) + nStr + '. ';
    });
  },

  listItem(state, node) {
    state.renderContent(node);
  },

  // ── Enhanced task list/item ──

  taskList(state, node) {
    // Emit metadata comment if list has custom attrs
    const attrs: Record<string, unknown> = {};
    if (node.attrs['id']) attrs['id'] = node.attrs['id'];
    if (node.attrs['name']) attrs['name'] = node.attrs['name'];
    if (node.attrs['showCompleted'] === false) attrs['showCompleted'] = false;

    const comment = serializeAttrsComment('tasklist', attrs);
    if (comment) {
      state.write(comment + '\n');
    }

    // Render each task item
    node.forEach((child, _, i) => {
      state.render(child, node, i);
    });
  },

  taskItem(state, node) {
    const checked = node.attrs['checked'] ? 'x' : ' ';

    // Build metadata comment for custom attrs
    const attrs: Record<string, unknown> = {};
    if (node.attrs['id']) attrs['id'] = node.attrs['id'];
    if (node.attrs['priority']) attrs['priority'] = node.attrs['priority'];
    if (node.attrs['color']) attrs['color'] = node.attrs['color'];
    if (node.attrs['dueDate']) attrs['dueDate'] = node.attrs['dueDate'];
    const comment = serializeAttrsComment('todo', attrs);

    // Render the first paragraph inline with the checkbox
    state.write(`- [${checked}] `);
    if (node.childCount > 0 && node.child(0).type.name === 'paragraph') {
      state.renderInline(node.child(0));
    }
    if (comment) {
      state.write(' ' + comment);
    }
    state.write('\n');

    // Render any additional block content indented
    for (let i = 1; i < node.childCount; i++) {
      const child = node.child(i);
      state.write('  ');
      state.render(child, node, i);
    }
  },

  // ── Todo Box ──

  todoBox(state, node) {
    const attrs: Record<string, unknown> = {};
    if (node.attrs['id']) attrs['id'] = node.attrs['id'];
    if (node.attrs['name'] && node.attrs['name'] !== 'To-Do') attrs['name'] = node.attrs['name'];
    if (node.attrs['showCompleted'] === false) attrs['showCompleted'] = false;

    const comment = serializeAttrsComment('todobox', attrs);
    if (comment) {
      state.write(comment + '\n');
    }
    state.renderContent(node);
    state.write('<!-- /todobox -->\n');
  },

  // ── Page links ──

  pageLink(state, node) {
    const title = node.attrs['title'] || '';
    const pageId = node.attrs['pageId'] || '';
    state.write(`[[${title}|${pageId}]]`);
  },

  pageLinkBlock(state, node) {
    const attrs: Record<string, unknown> = {
      pageId: node.attrs['pageId'],
      title: node.attrs['title'],
    };
    if (node.attrs['showPreview'] === false) attrs['showPreview'] = false;
    if (node.attrs['previewLines'] !== 3) attrs['previewLines'] = node.attrs['previewLines'];

    state.write(serializeAttrsComment('page-embed', attrs));
    state.closeBlock(node);
  },

  // ── Hashtag ──

  hashTag(state, node) {
    state.write(`#${node.attrs['tag']}`);
  },

  // ── Image ──

  memoImage(state, node) {
    const urls = node.attrs['urls'];
    const size = node.attrs['size'] || 'medium';
    const alt = node.attrs['alt'] || '';
    const title = node.attrs['title'] || '';

    // Metadata comment with urls JSON and size
    const attrs: Record<string, unknown> = { size };
    if (urls) attrs['urls'] = urls;
    state.write(serializeAttrsComment('memo-image', attrs) + '\n');

    // Standard markdown image using the display URL
    const displayUrl = urls?.[size] || urls?.original || '';
    const titlePart = title ? ` "${title}"` : '';
    state.write(`![${alt}](${displayUrl}${titlePart})`);
    state.closeBlock(node);
  },

  // ── Table of Contents ──

  tableOfContents(state, node) {
    state.write('<!-- table-of-contents -->');
    state.closeBlock(node);
  },

  // ── Tables ──

  table(state, node) {
    // Collect all rows
    const rows: string[][] = [];
    const isHeaderRow: boolean[] = [];

    node.forEach((row) => {
      const cells: string[] = [];
      let isHeader = false;
      row.forEach((cell) => {
        if (cell.type.name === 'tableHeader') isHeader = true;
        // Serialize cell content inline
        let text = '';
        cell.forEach((block) => {
          if (block.type.name === 'paragraph') {
            const tmp = new MarkdownSerializer(nodes, marks);
            const cellState = tmp.serialize(block);
            text += cellState.trim();
          }
        });
        cells.push(text);
      });
      rows.push(cells);
      isHeaderRow.push(isHeader);
    });

    if (rows.length === 0) return;

    // Calculate column widths
    const colCount = Math.max(...rows.map((r) => r.length));
    const colWidths: number[] = [];
    for (let c = 0; c < colCount; c++) {
      colWidths.push(Math.max(3, ...rows.map((r) => (r[c] || '').length)));
    }

    // Write header row
    const headerRow = rows[0] || [];
    state.write('| ' + headerRow.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + ' |\n');

    // Write separator
    state.write('| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |\n');

    // Write data rows
    for (let r = 1; r < rows.length; r++) {
      state.write(
        '| ' + rows[r].map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ') + ' |\n',
      );
    }

    state.closeBlock(node);
  },

  tableRow() {
    // handled by table
  },

  tableHeader() {
    // handled by table
  },

  tableCell() {
    // handled by table
  },

  text(state, node) {
    state.text(node.text || '');
  },
};

// ─── Mark serializers ──────────────────────────────────────────────

const marks: Record<
  string,
  {
    open:
      | string
      | ((
          state: MarkdownSerializerState,
          mark: Mark,
          parent: ProseMirrorNode,
          index: number,
        ) => string);
    close:
      | string
      | ((
          state: MarkdownSerializerState,
          mark: Mark,
          parent: ProseMirrorNode,
          index: number,
        ) => string);
    mixable?: boolean;
    expelEnclosingWhitespace?: boolean;
    escape?: boolean;
  }
> = {
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  code: { open: '`', close: '`', escape: false },
  link: {
    open(_state, mark) {
      return '[';
    },
    close(_state, mark) {
      const href = mark.attrs['href'] || '';
      const title = mark.attrs['title'];
      return '](' + href + (title ? ` "${title}"` : '') + ')';
    },
  },
};

// ─── Markdown-it configuration for parsing ──────────────────────

function createMarkdownItInstance(): MarkdownIt {
  const md = new MarkdownIt({ html: true });

  // ── Inline rule: wiki-links [[title|pageId]] ──
  md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b) return false; // [
    if (state.src.charCodeAt(state.pos + 1) !== 0x5b) return false; // [

    const start = state.pos + 2;
    const end = state.src.indexOf(']]', start);
    if (end === -1) return false;

    if (!silent) {
      const content = state.src.slice(start, end);
      const pipeIdx = content.indexOf('|');
      const title = pipeIdx >= 0 ? content.slice(0, pipeIdx) : content;
      const pageId = pipeIdx >= 0 ? content.slice(pipeIdx + 1) : '';

      const token = state.push('page_link', '', 0);
      token.meta = { title, pageId };
    }

    state.pos = end + 2;
    return true;
  });

  // ── Inline rule: hashtags #tag ──
  md.inline.ruler.before('text', 'hashtag', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x23) return false; // #

    // Must be preceded by whitespace or start of line
    if (state.pos > 0) {
      const prev = state.src.charCodeAt(state.pos - 1);
      if (prev !== 0x20 && prev !== 0x0a && prev !== 0x09) return false;
    }

    // Collect tag name (word chars)
    let end = state.pos + 1;
    while (end < state.posMax) {
      const ch = state.src.charCodeAt(end);
      if (
        (ch >= 0x61 && ch <= 0x7a) || // a-z
        (ch >= 0x41 && ch <= 0x5a) || // A-Z
        (ch >= 0x30 && ch <= 0x39) || // 0-9
        ch === 0x5f ||
        ch === 0x2d // _ -
      ) {
        end++;
      } else {
        break;
      }
    }

    if (end === state.pos + 1) return false; // no tag name

    if (!silent) {
      const tag = state.src.slice(state.pos + 1, end);
      const token = state.push('hashtag', '', 0);
      token.meta = { tag };
    }

    state.pos = end;
    return true;
  });

  return md;
}

// ─── ProseMirror MarkdownParser token specs ─────────────────────

function buildParserSpecs(schema: Schema) {
  const tokenSpecs: Record<string, any> = {
    // Block tokens
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList' },
    ordered_list: {
      block: 'orderedList',
      getAttrs: (tok: any) => ({ start: +(tok.attrGet('start') || 1) }),
    },
    heading: { block: 'heading', getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }) },
    code_block: {
      block: 'codeBlock',
      getAttrs: (tok: any) => ({ language: tok.info || 'plaintext' }),
    },
    fence: { block: 'codeBlock', getAttrs: (tok: any) => ({ language: tok.info || 'plaintext' }) },
    hr: { node: 'horizontalRule' },
    hardbreak: { node: 'hardBreak' },

    // Inline tokens
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    code_inline: { mark: 'code' },
    link: {
      mark: 'link',
      getAttrs: (tok: any) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
    },

    // Custom inline tokens
    page_link: {
      node: 'pageLink',
      getAttrs: (tok: any) => ({
        pageId: tok.meta?.pageId || '',
        title: tok.meta?.title || '',
      }),
    },
    hashtag: {
      node: 'hashTag',
      getAttrs: (tok: any) => ({
        tag: tok.meta?.tag || '',
      }),
    },

    // Image → memoImage
    image: {
      node: 'memoImage',
      getAttrs: (tok: any) => ({
        urls: {
          original: tok.attrGet('src') || '',
          small: '',
          medium: tok.attrGet('src') || '',
          large: '',
          cover: '',
        },
        alt: tok.attrGet('alt') || '',
        title: tok.attrGet('title') || '',
        size: 'medium',
      }),
    },
  };

  // HTML — ignore (handled via pre-processing)
  tokenSpecs['html_block'] = { ignore: true };
  tokenSpecs['html_inline'] = { ignore: true };

  // Only include table specs if schema has table nodes
  if (schema.nodes['table']) {
    tokenSpecs['table'] = { block: 'table' };
    tokenSpecs['thead'] = { ignore: true };
    tokenSpecs['tbody'] = { ignore: true };
    tokenSpecs['tr'] = { block: 'tableRow' };
    tokenSpecs['th'] = { block: 'tableHeader' };
    tokenSpecs['td'] = { block: 'tableCell' };
  }

  return tokenSpecs;
}

// ─── HTML comment-based metadata post-processing ────────────────

/**
 * Convert bullet lists containing [ ]/[x] items into taskList/taskItem nodes.
 */
function convertTaskLists(doc: ProseMirrorNode, schema: Schema): ProseMirrorNode {
  if (!schema.nodes['taskList'] || !schema.nodes['taskItem']) return doc;

  const content: ProseMirrorNode[] = [];

  doc.forEach((node) => {
    if (node.type.name === 'bulletList') {
      // Check if any item starts with [ ] or [x]
      let hasTaskItems = false;
      node.forEach((item) => {
        if (item.childCount > 0) {
          const firstChild = item.child(0);
          if (firstChild.type.name === 'paragraph') {
            const text = firstChild.textContent;
            if (/^\[([ xX])\] /.test(text)) {
              hasTaskItems = true;
            }
          }
        }
      });

      if (hasTaskItems) {
        const taskItems: ProseMirrorNode[] = [];
        node.forEach((item) => {
          if (item.childCount > 0) {
            const firstChild = item.child(0);
            if (firstChild.type.name === 'paragraph') {
              const text = firstChild.textContent;
              const match = text.match(/^\[([ xX])\] /);
              if (match) {
                const checked = match[1] !== ' ';
                const restText = text.slice(match[0].length);

                // Rebuild paragraph without the checkbox prefix,
                // preserving inline marks
                const newContent = rebuildInlineContent(firstChild, match[0].length, schema);

                const children: ProseMirrorNode[] = [
                  schema.nodes['paragraph'].create(null, newContent),
                ];
                // Add remaining children from list item
                for (let i = 1; i < item.childCount; i++) {
                  children.push(item.child(i));
                }

                taskItems.push(schema.nodes['taskItem'].create({ checked }, children));
                return;
              }
            }
          }
          // Non-task item in a task list — wrap as unchecked
          const children: ProseMirrorNode[] = [];
          item.forEach((child) => children.push(child));
          taskItems.push(schema.nodes['taskItem'].create({ checked: false }, children));
        });
        content.push(schema.nodes['taskList'].create(null, taskItems));
        return;
      }
    }
    content.push(node);
  });

  return schema.nodes['doc'].create(null, content);
}

/**
 * Rebuild inline content of a paragraph node, skipping the first `skip` characters
 * while preserving marks on the remaining text.
 */
function rebuildInlineContent(
  paragraph: ProseMirrorNode,
  skip: number,
  schema: Schema,
): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  let skipped = 0;

  paragraph.forEach((child) => {
    if (child.isText && child.text) {
      if (skipped < skip) {
        const remaining = skip - skipped;
        if (remaining >= child.text.length) {
          skipped += child.text.length;
          return; // skip entire text node
        }
        skipped = skip;
        const newText = child.text.slice(remaining);
        if (newText) {
          result.push(schema.text(newText, child.marks));
        }
        return;
      }
      result.push(child);
    } else {
      if (skipped >= skip) {
        result.push(child);
      }
      skipped += child.nodeSize;
    }
  });

  return result;
}

interface DocumentMetadata {
  /** tasklist attrs in order of appearance */
  taskLists: Record<string, string>[];
  /** todo attrs in order of appearance */
  todoItems: Record<string, string>[];
  /** Block-level metadata: page embeds, memo images, table of contents, etc. */
  blockComments: { prefix: string; attrs: Record<string, string>; lineIndex: number }[];
}

/**
 * Pre-process markdown to extract metadata from HTML comments
 * and strip them so markdown-it can parse cleanly.
 */
function preProcessMarkdown(markdown: string): {
  cleanedMarkdown: string;
  metadata: DocumentMetadata;
} {
  const lines = markdown.split('\n');
  const cleanedLines: string[] = [];
  const metadata: DocumentMetadata = {
    taskLists: [],
    todoItems: [],
    blockComments: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Standalone HTML comment on its own line
    if (/^<!--\s*\S+.*-->$/.test(trimmed)) {
      // Table of contents
      if (trimmed === '<!-- table-of-contents -->') {
        metadata.blockComments.push({
          prefix: 'toc',
          attrs: {},
          lineIndex: cleanedLines.length,
        });
        // Keep a placeholder paragraph
        cleanedLines.push('');
        continue;
      }

      // Todobox close
      if (trimmed === '<!-- /todobox -->') {
        cleanedLines.push('');
        continue;
      }

      // Try parsing as metadata comment
      for (const prefix of ['tasklist', 'todobox', 'page-embed', 'memo-image']) {
        const attrs = parseAttrsComment(trimmed, prefix);
        if (attrs) {
          if (prefix === 'tasklist') {
            metadata.taskLists.push(attrs);
          } else {
            metadata.blockComments.push({
              prefix,
              attrs,
              lineIndex: cleanedLines.length,
            });
          }
          // Don't output this line — strip the comment
          break;
        }
      }
      // Line was a metadata comment, skip it
      continue;
    }

    // Task item line with inline todo comment
    const todoMatch = line.match(/^(\s*-\s*\[[ xX]\].*?)\s*<!--\s*todo:(.+?)\s*-->$/);
    if (todoMatch) {
      const cleanLine = todoMatch[1];
      const todoRaw = todoMatch[2];
      const attrs = parseAttrsComment(`<!-- todo:${todoRaw} -->`, 'todo');
      if (attrs) {
        metadata.todoItems.push(attrs);
      }
      cleanedLines.push(cleanLine);
      continue;
    }

    cleanedLines.push(line);
  }

  return { cleanedMarkdown: cleanedLines.join('\n'), metadata };
}

/**
 * Post-process parsed document to apply extracted metadata.
 */
function postProcessMetadata(
  doc: ProseMirrorNode,
  schema: Schema,
  metadata: DocumentMetadata,
): ProseMirrorNode {
  const content: ProseMirrorNode[] = [];
  let taskListIndex = 0;
  let todoItemIndex = 0;

  doc.forEach((node) => {
    // Apply tasklist metadata
    if (node.type.name === 'taskList') {
      const listMeta = metadata.taskLists[taskListIndex];
      taskListIndex++;

      const processedItems: ProseMirrorNode[] = [];
      node.forEach((item) => {
        if (item.type.name === 'taskItem') {
          const todoAttrs = metadata.todoItems[todoItemIndex];
          todoItemIndex++;
          if (todoAttrs) {
            processedItems.push(
              item.type.create(
                {
                  ...item.attrs,
                  id: todoAttrs['id'] || item.attrs['id'],
                  priority: todoAttrs['priority'] || null,
                  color: todoAttrs['color'] || null,
                  dueDate: todoAttrs['dueDate'] || null,
                },
                item.content,
              ),
            );
            return;
          }
        }
        processedItems.push(item);
      });

      const listAttrs = listMeta
        ? {
            ...node.attrs,
            id: listMeta['id'] || node.attrs['id'],
            name: listMeta['name'] || node.attrs['name'],
            showCompleted: listMeta['showCompleted'] !== 'false',
          }
        : node.attrs;

      content.push(node.type.create(listAttrs, processedItems));
      return;
    }

    content.push(node);
  });

  // Process block comments (page embeds, memo images, table of contents)
  // These were stripped during pre-processing, so we need to insert them
  // For now, handle page embeds and TOC as replacements for empty paragraphs
  const finalContent: ProseMirrorNode[] = [];
  for (const node of content) {
    finalContent.push(node);
  }

  // Insert block-level nodes from metadata
  for (const block of metadata.blockComments) {
    if (block.prefix === 'toc' && schema.nodes['tableOfContents']) {
      finalContent.push(schema.nodes['tableOfContents'].create());
    } else if (block.prefix === 'page-embed' && schema.nodes['pageLinkBlock']) {
      finalContent.push(
        schema.nodes['pageLinkBlock'].create({
          pageId: block.attrs['pageId'] || '',
          title: block.attrs['title'] || '',
          showPreview: block.attrs['showPreview'] !== 'false',
          previewLines: parseInt(block.attrs['previewLines'] || '3', 10),
        }),
      );
    } else if (block.prefix === 'memo-image' && schema.nodes['memoImage']) {
      let urls = null;
      try {
        if (block.attrs['urls']) urls = JSON.parse(block.attrs['urls']);
      } catch {
        // ignore
      }
      finalContent.push(
        schema.nodes['memoImage'].create({
          urls,
          size: block.attrs['size'] || 'medium',
        }),
      );
    }
  }

  return schema.nodes['doc'].create(null, finalContent);
}

// ─── Service ───────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class MarkdownSerializerService {
  private readonly serializer = new MarkdownSerializer(nodes, marks);
  private readonly md = createMarkdownItInstance();

  /**
   * Serialize a ProseMirror document to markdown.
   */
  serializeToMarkdown(doc: ProseMirrorNode): string {
    return this.serializer.serialize(doc, { tightLists: true });
  }

  /**
   * Deserialize content (markdown or legacy HTML) into a ProseMirror document.
   */
  deserialize(content: string, schema: Schema): ProseMirrorNode {
    if (this.isLegacyHtmlContent(content)) {
      return this.deserializeFromHtml(content, schema);
    }
    return this.deserializeFromMarkdown(content, schema);
  }

  /**
   * Parse markdown into a ProseMirror document.
   */
  deserializeFromMarkdown(markdown: string, schema: Schema): ProseMirrorNode {
    // Pre-process: extract metadata from HTML comments before markdown-it parsing
    const { cleanedMarkdown, metadata } = preProcessMarkdown(markdown);

    const tokenSpecs = buildParserSpecs(schema);
    const parser = new MarkdownParser(schema, this.md, tokenSpecs);
    const doc = parser.parse(cleanedMarkdown);
    if (!doc) {
      return schema.nodes['doc'].create(null, [
        schema.nodes['heading'].create({ level: 1 }),
        schema.nodes['paragraph'].create(),
      ]);
    }
    const withTaskLists = convertTaskLists(doc, schema);
    return postProcessMetadata(withTaskLists, schema, metadata);
  }

  /**
   * Parse legacy HTML content into a ProseMirror document.
   * Uses ProseMirror's DOMParser which respects each extension's parseHTML rules.
   */
  deserializeFromHtml(html: string, schema: Schema): ProseMirrorNode {
    const div = document.createElement('div');
    div.innerHTML = html;
    return ProseMirrorDOMParser.fromSchema(schema).parse(div);
  }

  /**
   * Detect whether stored content is legacy HTML (from editor.getHTML()).
   * HTML content starts with a tag like <h1>, <p>, <ul>, etc.
   * Our markdown metadata comments start with <!-- which we don't treat as HTML.
   */
  isLegacyHtmlContent(content: string): boolean {
    const stripped = content.replace(/^\s*(<!--[\s\S]*?-->\s*)*/g, '').trimStart();
    return stripped.startsWith('<') && !stripped.startsWith('<!');
  }
}
