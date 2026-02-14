import { Node, mergeAttributes } from '@tiptap/core';
import type { Observable, Subscription } from 'rxjs';

// ============================================
// JSON Data Reference Types
// ============================================

export interface JsonDataRefAttrs {
  pageId: string;
  path: string;
  label: string;
}

export interface JsonDataRefOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Observable that resolves a JSON value from a page by path */
  getJsonValue$?: (pageId: string, path: string) => Observable<unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    jsonDataRef: {
      /** Insert a JSON data reference inline */
      insertJsonDataRef: (attrs: JsonDataRefAttrs) => ReturnType;
    };
  }
}

/**
 * JSON Data Reference Extension
 * Inline atom node that displays a live value from a JSON-type page.
 * Syntax equivalent: {{json:pageId.path}}
 */
export const JsonDataRef = Node.create<JsonDataRefOptions>({
  name: 'jsonDataRef',

  group: 'inline',

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      getJsonValue$: undefined,
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
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-path'),
        renderHTML: (attributes) => ({
          'data-path': attributes['path'] || '',
        }),
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => ({
          'data-label': attributes['label'] || '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="json-data-ref"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'json-data-ref',
        class: 'json-data-ref',
      }),
    ];
  },

  addCommands() {
    return {
      insertJsonDataRef:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              pageId: attrs.pageId,
              path: attrs.path,
              label: attrs.label,
            },
          });
        },
    };
  },

  addNodeView() {
    return ({ node }) => {
      const pageId = node.attrs['pageId'] as string;
      const path = node.attrs['path'] as string;
      const label = node.attrs['label'] as string;

      // Create inline container
      const dom = document.createElement('span');
      dom.setAttribute('data-type', 'json-data-ref');
      dom.setAttribute('data-page-id', pageId);
      dom.setAttribute('data-path', path);
      dom.classList.add('json-data-ref');
      dom.contentEditable = 'false';

      // Value display
      const valueEl = document.createElement('span');
      valueEl.classList.add('json-data-ref-value');
      valueEl.textContent = label || `${path}...`;

      // Path indicator
      const pathEl = document.createElement('span');
      pathEl.classList.add('json-data-ref-path');
      pathEl.textContent = path;
      pathEl.title = `JSON: ${pageId.substring(0, 8)}.../${path}`;

      dom.appendChild(valueEl);

      // Subscribe to live value updates
      let subscription: Subscription | undefined;
      if (this.options.getJsonValue$) {
        subscription = this.options.getJsonValue$(pageId, path).subscribe((value) => {
          if (value === undefined || value === null) {
            valueEl.textContent = '—';
            valueEl.classList.add('json-data-ref-empty');
          } else if (typeof value === 'object') {
            valueEl.textContent = JSON.stringify(value);
            valueEl.classList.remove('json-data-ref-empty');
          } else {
            valueEl.textContent = String(value);
            valueEl.classList.remove('json-data-ref-empty');
          }
        });
      }

      // Dispatch mount event for Angular
      dom.dispatchEvent(
        new CustomEvent('json-data-ref-mounted', {
          bubbles: true,
          detail: { pageId, path },
        }),
      );

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          // Attributes changed - could re-subscribe here
          return true;
        },
        destroy: () => {
          subscription?.unsubscribe();
          dom.dispatchEvent(
            new CustomEvent('json-data-ref-unmounted', {
              bubbles: true,
              detail: { pageId, path },
            }),
          );
        },
      };
    };
  },
});
