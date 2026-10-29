import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import type { Observable, Subscription } from 'rxjs';

// ============================================
// Page Link Types
// ============================================

export interface PageLinkAttrs {
  pageId: string;
  title: string;
}

export interface PageLinkSuggestion {
  id: string;
  title: string;
  type: string; // Page type (memo, whiteboard, etc.)
  folderName?: string;
}

export interface PageLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<PageLinkSuggestion>, 'editor'>;
  // Callback to search for pages
  searchPages: (query: string) => Promise<PageLinkSuggestion[]>;
  // Callback to create a new page
  createPage?: (title: string) => Promise<PageLinkSuggestion | null>;
  // Callback when a link is clicked
  onLinkClick?: (pageId: string) => void;
  // Callback to get a reactive page title observable
  getPageTitle$?: (pageId: string) => Observable<string>;
}

export const PageLinkPluginKey = new PluginKey('pageLink');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      /**
       * Insert an inline page link
       */
      insertPageLink: (attrs: PageLinkAttrs) => ReturnType;
    };
  }
}

/**
 * Page Link Extension
 * Inline wiki-style links to other pages [[Page Name]]
 */
export const PageLink = Node.create<PageLinkOptions>({
  name: 'pageLink',

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '[[',
        pluginKey: PageLinkPluginKey,
        items: () => [],
        command: () => {},
        allow: () => true,
      },
      searchPages: async () => [],
      createPage: undefined,
      onLinkClick: undefined,
      getPageTitle$: undefined,
    };
  },

  group: 'inline',

  inline: true,

  selectable: true,

  atom: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-id'),
        renderHTML: (attributes) => ({ 'data-page-id': attributes['pageId'] }),
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => ({ 'data-title': attributes['title'] }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="page-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = node.attrs['title'] || 'Untitled';

    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'page-link',
          class: 'page-link',
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      title,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs['title'] || 'Untitled'}]]`;
  },

  addCommands() {
    return {
      insertPageLink:
        (attrs: PageLinkAttrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isPageLink = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) {
            return false;
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos): boolean => {
            if (node.type.name === this.name) {
              isPageLink = true;
              tr.insertText('', pos, pos + node.nodeSize);
              return false;
            }
            return true;
          });

          return isPageLink;
        }),
    };
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const pageId = node.attrs['pageId'] as string;
      const initialTitle = node.attrs['title'] as string;

      const dom = document.createElement('span');
      dom.setAttribute('data-type', 'page-link');
      dom.setAttribute('data-page-id', pageId);
      dom.setAttribute('data-title', initialTitle);
      dom.classList.add('page-link');

      // Icon
      const icon = document.createElement('span');
      icon.classList.add('page-link-icon');
      icon.textContent = '📄';
      dom.appendChild(icon);

      // Title
      const titleSpan = document.createElement('span');
      titleSpan.classList.add('page-link-title');
      titleSpan.textContent = initialTitle || 'Untitled';
      dom.appendChild(titleSpan);

      // Subscribe to live title updates from the store
      let subscription: Subscription | undefined;
      if (this.options.getPageTitle$) {
        subscription = this.options.getPageTitle$(pageId).subscribe((liveTitle) => {
          titleSpan.textContent = liveTitle || 'Untitled';
        });
      }

      // Click handler
      dom.style.cursor = 'pointer';
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Get current title from the DOM (which is kept up to date by subscription)
        const currentTitle = titleSpan.textContent || initialTitle;

        // Dispatch custom event for Angular to handle
        dom.dispatchEvent(
          new CustomEvent('page-link-click', {
            bubbles: true,
            detail: { pageId, title: currentTitle },
          }),
        );

        // Also call the callback if provided
        if (this.options.onLinkClick) {
          this.options.onLinkClick(pageId);
        }
      });

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          // If pageId changed, we need to resubscribe
          const newPageId = updatedNode.attrs['pageId'] as string;
          if (newPageId !== pageId) {
            // This shouldn't happen often, but handle it
            return false;
          }

          // Note: We don't update from node attrs anymore since we get live updates from store
          // But we still handle the update to keep TipTap happy
          return true;
        },
        destroy: () => {
          // Clean up subscription when node is removed
          subscription?.unsubscribe();
        },
        stopEvent: () => true,
      };
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        // Search for pages
        items: async ({ query }) => {
          if (!query || query.length < 1) {
            return [];
          }
          try {
            return await extensionThis.options.searchPages(query);
          } catch {
            return [];
          }
        },
        // Insert the selected page link
        command: ({ editor, range, props }) => {
          const suggestion = props as PageLinkSuggestion;

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: extensionThis.name,
                attrs: {
                  pageId: suggestion.id,
                  title: suggestion.title,
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        // Check if we can insert a page link here
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[extensionThis.name];
          return !!$from.parent.type.contentMatch.matchType(type);
        },
      }),
    ];
  },
});
