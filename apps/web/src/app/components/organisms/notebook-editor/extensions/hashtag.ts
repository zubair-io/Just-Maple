import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

// ============================================
// HashTag Types
// ============================================

export interface HashTagAttrs {
  tag: string; // The tag name (without #)
}

export interface HashTagSuggestion {
  name: string;
  count?: number;
  color?: string | null;
}

export interface HashTagOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<HashTagSuggestion>, 'editor'>;
  // Callback to get existing tags for autocomplete
  getTags: () => HashTagSuggestion[];
  // Callback when a tag is clicked
  onTagClick?: (tag: string) => void;
  // Callback to get color for a tag
  getTagColor?: (tag: string) => string | null;
}

export const HashTagPluginKey = new PluginKey('hashTag');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    hashTag: {
      /**
       * Insert a hashtag
       */
      insertHashTag: (tag: string) => ReturnType;
    };
  }
}

/**
 * HashTag Extension
 * Inline hashtags triggered by # for tagging and organization
 */
export const HashTag = Node.create<HashTagOptions>({
  name: 'hashTag',

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '#',
        pluginKey: HashTagPluginKey,
        items: () => [],
        command: () => {},
        allow: () => true,
      },
      getTags: () => [],
      onTagClick: undefined,
      getTagColor: undefined,
    };
  },

  group: 'inline',

  inline: true,

  selectable: true,

  atom: true,

  addAttributes() {
    return {
      tag: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-tag'),
        renderHTML: (attributes) => ({ 'data-tag': attributes['tag'] }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="hashtag"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const tag = node.attrs['tag'] || '';

    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'hashtag',
          class: 'hashtag',
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `#${tag}`,
    ];
  },

  renderText({ node }) {
    return `#${node.attrs['tag'] || ''}`;
  },

  addCommands() {
    return {
      insertHashTag:
        (tag: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { tag },
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isHashTag = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) {
            return false;
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos): boolean => {
            if (node.type.name === this.name) {
              isHashTag = true;
              tr.insertText('', pos, pos + node.nodeSize);
              return false;
            }
            return true;
          });

          return isHashTag;
        }),
    };
  },

  addNodeView() {
    return ({ node }) => {
      const tag = node.attrs['tag'] as string;

      const dom = document.createElement('span');
      dom.setAttribute('data-type', 'hashtag');
      dom.setAttribute('data-tag', tag);
      dom.classList.add('hashtag');

      // Get color if available
      const color = this.options.getTagColor?.(tag);
      if (color) {
        dom.style.setProperty('--hashtag-color', color);
        dom.classList.add('hashtag-colored');
      }

      // Tag text
      const text = document.createElement('span');
      text.classList.add('hashtag-text');
      text.textContent = `#${tag}`;
      dom.appendChild(text);

      // Click handler - navigate to tag view
      dom.style.cursor = 'pointer';
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Dispatch custom event for Angular to handle
        dom.dispatchEvent(
          new CustomEvent('hashtag-click', {
            bubbles: true,
            detail: { tag },
          }),
        );

        // Also call the callback if provided
        if (this.options.onTagClick) {
          this.options.onTagClick(tag);
        }
      });

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          const newTag = updatedNode.attrs['tag'] as string;
          if (newTag !== tag) {
            // Tag changed, need to re-render
            return false;
          }

          return true;
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
        // Search for existing tags
        items: ({ query }) => {
          if (!query || query.length < 1) {
            // Show recent/popular tags when no query
            const tags = extensionThis.options.getTags?.() || [];
            return tags.slice(0, 10);
          }

          const tags = extensionThis.options.getTags?.() || [];
          const lowercaseQuery = query.toLowerCase();

          // Filter existing tags by query
          const matchingTags = tags.filter((t) => t.name.toLowerCase().includes(lowercaseQuery));

          // If query doesn't match any existing tag exactly, offer to create new
          const exactMatch = tags.find((t) => t.name.toLowerCase() === lowercaseQuery);
          if (!exactMatch && query.length > 0) {
            // Add "Create new tag" option
            matchingTags.unshift({
              name: query,
              count: 0,
              color: null,
            });
          }

          return matchingTags.slice(0, 10);
        },
        // Insert the selected tag
        command: ({ editor, range, props }) => {
          const suggestion = props as HashTagSuggestion;

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: extensionThis.name,
                attrs: { tag: suggestion.name },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        // Check if we can insert a hashtag here
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[extensionThis.name];
          return !!$from.parent.type.contentMatch.matchType(type);
        },
      }),
    ];
  },
});

/**
 * Extract all hashtags from a TipTap JSON document
 */
export function extractHashTags(doc: Record<string, unknown>): string[] {
  const tags: Set<string> = new Set();

  function traverse(node: Record<string, unknown>): void {
    if (node['type'] === 'hashTag' && node['attrs']) {
      const attrs = node['attrs'] as Record<string, unknown>;
      if (typeof attrs['tag'] === 'string') {
        tags.add(attrs['tag']);
      }
    }

    if (Array.isArray(node['content'])) {
      for (const child of node['content']) {
        if (typeof child === 'object' && child !== null) {
          traverse(child as Record<string, unknown>);
        }
      }
    }
  }

  traverse(doc);
  return Array.from(tags);
}
