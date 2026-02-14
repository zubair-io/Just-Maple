import { Node, mergeAttributes } from '@tiptap/core';
import type { Observable, Subscription } from 'rxjs';

// ============================================
// JSON Loop Block Types
// ============================================

export interface JsonLoopBlockAttrs {
  pageId: string;
  arrayPath: string;
  template: string;
  renderAs: 'list' | 'table';
  columns: string | null; // JSON-encoded string[] or null (auto-detect)
}

export interface JsonLoopBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Observable that resolves an array from a JSON page by path */
  getJsonArray$?: (pageId: string, path: string) => Observable<unknown[]>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    jsonLoopBlock: {
      /** Insert a JSON loop block */
      insertJsonLoopBlock: (attrs: JsonLoopBlockAttrs) => ReturnType;
    };
  }
}

/**
 * JSON Loop Block Extension
 * Block-level atom node that renders a JSON array as a list or table.
 * Subscribes to real-time updates for live rendering.
 */
export const JsonLoopBlock = Node.create<JsonLoopBlockOptions>({
  name: 'jsonLoopBlock',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      getJsonArray$: undefined,
    };
  },

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-id'),
        renderHTML: (attributes) => {
          if (!attributes['pageId']) return {};
          return { 'data-page-id': attributes['pageId'] };
        },
      },
      arrayPath: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-array-path'),
        renderHTML: (attributes) => ({
          'data-array-path': attributes['arrayPath'] || '',
        }),
      },
      template: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-template'),
        renderHTML: (attributes) => ({
          'data-template': attributes['template'] || '',
        }),
      },
      renderAs: {
        default: 'table',
        parseHTML: (element) => element.getAttribute('data-render-as') || 'table',
        renderHTML: (attributes) => ({
          'data-render-as': attributes['renderAs'] || 'table',
        }),
      },
      columns: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-columns'),
        renderHTML: (attributes) => ({
          'data-columns': attributes['columns'] || '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="json-loop-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'json-loop-block',
        class: 'json-loop-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertJsonLoopBlock:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              pageId: attrs.pageId,
              arrayPath: attrs.arrayPath,
              template: attrs.template,
              renderAs: attrs.renderAs,
              columns: attrs.columns,
            },
          });
        },
    };
  },

  addNodeView() {
    return ({ node }) => {
      const pageId = node.attrs['pageId'] as string;
      const arrayPath = node.attrs['arrayPath'] as string;
      const template = node.attrs['template'] as string;
      const renderAs = node.attrs['renderAs'] as 'list' | 'table';
      const columnsAttr = node.attrs['columns'] as string | null;

      let columns: string[] | null = null;
      if (columnsAttr) {
        try {
          columns = JSON.parse(columnsAttr);
        } catch {
          columns = null;
        }
      }

      // Create block container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'json-loop-block');
      dom.setAttribute('data-page-id', pageId);
      dom.classList.add('json-loop-block');
      dom.contentEditable = 'false';

      // Header bar
      const header = document.createElement('div');
      header.classList.add('json-loop-block-header');
      header.innerHTML = `<span class="json-loop-block-icon">&#123;&#125;</span>
                <span class="json-loop-block-label">${escapeHtml(arrayPath)} (${renderAs})</span>`;
      dom.appendChild(header);

      // Content area
      const content = document.createElement('div');
      content.classList.add('json-loop-block-content');
      content.innerHTML = '<div class="json-loop-block-empty">Loading data...</div>';
      dom.appendChild(content);

      // Subscribe to array data
      let subscription: Subscription | undefined;
      if (this.options.getJsonArray$) {
        subscription = this.options.getJsonArray$(pageId, arrayPath).subscribe((items) => {
          if (!items || items.length === 0) {
            content.innerHTML = '<div class="json-loop-block-empty">No data</div>';
            return;
          }

          if (renderAs === 'table') {
            content.innerHTML = renderTable(items, columns);
          } else {
            content.innerHTML = renderList(items, template);
          }
        });
      }

      // Double-click to configure
      dom.addEventListener('dblclick', () => {
        dom.dispatchEvent(
          new CustomEvent('json-loop-configure', {
            bubbles: true,
            detail: { pageId, arrayPath, template, renderAs, columns: columnsAttr },
          }),
        );
      });

      return {
        dom,
        update: (updatedNode) => {
          return updatedNode.type.name === this.name;
        },
        destroy: () => {
          subscription?.unsubscribe();
        },
      };
    };
  },
});

// ============================================
// Render helpers
// ============================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render items as an HTML table
 */
function renderTable(items: unknown[], columns: string[] | null): string {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="json-loop-block-empty">No data</div>';
  }

  // Infer columns from first item if not specified
  const cols =
    columns ||
    (typeof items[0] === 'object' && items[0] !== null
      ? Object.keys(items[0] as Record<string, unknown>)
      : ['value']);

  let html = '<table class="json-loop-table">';
  html += '<thead><tr>';
  for (const col of cols) {
    html += `<th>${escapeHtml(col)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const item of items) {
    html += '<tr>';
    if (typeof item === 'object' && item !== null) {
      for (const col of cols) {
        const value = (item as Record<string, unknown>)[col];
        html += `<td>${escapeHtml(formatValue(value))}</td>`;
      }
    } else {
      html += `<td>${escapeHtml(formatValue(item))}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

/**
 * Render items as an HTML list using a template string
 * Template supports: {{fieldName}}, {{nested.field}}, {{$index}}, {{$index1}}
 */
function renderList(items: unknown[], template: string): string {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="json-loop-block-empty">No data</div>';
  }

  let html = '<ul class="json-loop-list">';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let text = template || '{{.}}';

    // Replace template variables
    text = text.replace(/\{\{(\$index1?|\.\w[\w.[\]]*|\w[\w.[\]]*)\}\}/g, (_, key) => {
      if (key === '$index') return String(i);
      if (key === '$index1') return String(i + 1);
      if (key === '.') return formatValue(item);

      // Resolve path on item
      const value = resolveItemPath(item, key);
      return formatValue(value);
    });

    html += `<li>${escapeHtml(text)}</li>`;
  }

  html += '</ul>';
  return html;
}

/**
 * Resolve a dot-delimited path on a single item
 */
function resolveItemPath(item: unknown, path: string): unknown {
  if (!path || item === undefined || item === null) return item;

  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: unknown = item;
  for (const segment of segments) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index)) return undefined;
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
