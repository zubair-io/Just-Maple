import { Node, mergeAttributes } from '@tiptap/core';
import type { Observable, Subscription } from 'rxjs';

// ============================================
// Page Link Block Types
// ============================================

export interface PageLinkBlockAttrs {
  pageId: string;
  title: string;
  showPreview: boolean;
  previewLines: number;
}

export interface PageLinkBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  // Callback when a link is clicked
  onLinkClick?: (pageId: string) => void;
  // Callback to get a reactive page title observable
  getPageTitle$?: (pageId: string) => Observable<string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLinkBlock: {
      /**
       * Insert a page link block with preview
       */
      insertPageLinkBlock: (
        attrs: Partial<PageLinkBlockAttrs> & { pageId: string; title: string },
      ) => ReturnType;
      /**
       * Delete a page link block by pageId
       */
      deletePageLinkBlock: (pageId: string) => ReturnType;
    };
  }
}

/**
 * Page Link Block Extension
 * Block-level page embeds with preview
 */
export const PageLinkBlock = Node.create<PageLinkBlockOptions>({
  name: 'pageLinkBlock',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onLinkClick: undefined,
      getPageTitle$: undefined,
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
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => {
          if (!attributes['title']) return {};
          return { 'data-title': attributes['title'] };
        },
      },
      showPreview: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-show-preview') !== 'false',
        renderHTML: (attributes) => ({
          'data-show-preview': attributes['showPreview'] ? 'true' : 'false',
        }),
      },
      previewLines: {
        default: 3,
        parseHTML: (element) => parseInt(element.getAttribute('data-preview-lines') || '3', 10),
        renderHTML: (attributes) => ({
          'data-preview-lines': String(attributes['previewLines']),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="page-link-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'page-link-block',
        class: 'page-link-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertPageLinkBlock:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              pageId: attrs.pageId,
              title: attrs.title,
              showPreview: attrs.showPreview ?? true,
              previewLines: attrs.previewLines ?? 3,
            },
          });
        },
      deletePageLinkBlock:
        (pageId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['pageId'] === pageId) {
              if (dispatch) {
                tr.delete(pos, pos + node.nodeSize);
              }
              found = true;
              return false;
            }
            return true;
          });

          if (found && dispatch) {
            dispatch(tr);
          }

          return found;
        },
    };
  },

  addNodeView() {
    return ({ node }) => {
      const pageId = node.attrs['pageId'] as string;
      const initialTitle = node.attrs['title'] as string;
      const showPreview = node.attrs['showPreview'] as boolean;

      // Create container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'page-link-block');
      dom.setAttribute('data-page-id', pageId);
      dom.setAttribute('data-title', initialTitle);
      dom.classList.add('page-link-block');
      dom.contentEditable = 'false';

      // Header
      const header = document.createElement('div');
      header.classList.add('page-link-block-header');

      // Icon
      const icon = document.createElement('span');
      icon.classList.add('page-link-block-icon');
      icon.textContent = '📄';
      header.appendChild(icon);

      // Title
      const titleEl = document.createElement('span');
      titleEl.classList.add('page-link-block-title');
      titleEl.textContent = initialTitle || 'Untitled';
      header.appendChild(titleEl);

      dom.appendChild(header);

      // Subscribe to live title updates from the store
      let subscription: Subscription | undefined;
      if (this.options.getPageTitle$) {
        subscription = this.options.getPageTitle$(pageId).subscribe((liveTitle) => {
          titleEl.textContent = liveTitle || 'Untitled';
          dom.setAttribute('data-title', liveTitle);
        });
      }

      // Preview container (will be populated by Angular)
      if (showPreview) {
        const preview = document.createElement('div');
        preview.classList.add('page-link-block-preview');
        preview.setAttribute('data-page-id', pageId);
        dom.appendChild(preview);
      }

      // Click handler
      dom.style.cursor = 'pointer';
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Get current title from the DOM (which is kept up to date by subscription)
        const currentTitle = titleEl.textContent || initialTitle;

        // Dispatch custom event for Angular to handle
        dom.dispatchEvent(
          new CustomEvent('page-link-block-click', {
            bubbles: true,
            detail: { pageId, title: currentTitle },
          }),
        );

        if (this.options.onLinkClick) {
          this.options.onLinkClick(pageId);
        }
      });

      // Dispatch mount event for Angular to populate preview
      setTimeout(() => {
        dom.dispatchEvent(
          new CustomEvent('page-link-block-mounted', {
            bubbles: true,
            detail: { pageId, title: initialTitle, element: dom },
          }),
        );
      }, 0);

      return {
        dom,
        destroy: () => {
          // Clean up subscription when node is removed
          subscription?.unsubscribe();

          dom.dispatchEvent(
            new CustomEvent('page-link-block-unmounted', {
              bubbles: true,
              detail: { pageId },
            }),
          );
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          // If pageId changed, we need to resubscribe
          const newPageId = updatedNode.attrs['pageId'] as string;
          if (newPageId !== pageId) {
            return false;
          }

          // Note: We don't update from node attrs anymore since we get live updates from store
          return true;
        },
      };
    };
  },
});
