import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

export interface MentionNodeAttrs {
  id: string;
  handle: string;
  type: 'bot' | 'user';
}

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions, 'editor'>;
}

export const MentionPluginKey = new PluginKey('mention');

/**
 * Check if the node after the cursor starts with a space character
 * Used to override trailing space when inserting a mention
 */
function shouldOverrideTrailingSpace(editor: Editor): boolean {
  const nodeAfter = editor.view.state.selection.$to.nodeAfter;
  return nodeAfter?.text?.startsWith(' ') ?? false;
}

export const Mention = Node.create<MentionOptions>({
  name: 'mention',

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '@',
        pluginKey: MentionPluginKey,
        command: ({ editor, range, props }) => {
          // Increase range.to by one when the next node is of type "text"
          // and starts with a space character
          if (shouldOverrideTrailingSpace(editor)) {
            range.to += 1;
          }

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: this.name,
                attrs: props,
              },
              {
                type: 'text',
                text: ' ',
              },
            ])
            .run();

          window.getSelection()?.collapseToEnd();
        },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[this.name];
          const allow = !!$from.parent.type.contentMatch.matchType(type);
          return allow;
        },
      },
    };
  },

  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => {
          if (!attributes['id']) {
            return {};
          }
          return { 'data-id': attributes['id'] };
        },
      },
      handle: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-handle'),
        renderHTML: (attributes) => {
          if (!attributes['handle']) {
            return {};
          }
          return { 'data-handle': attributes['handle'] };
        },
      },
      type: {
        default: 'bot',
        parseHTML: (element) => element.getAttribute('data-type') || 'bot',
        renderHTML: (attributes) => {
          return { 'data-type': attributes['type'] };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="mention"]`,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': 'mention', class: 'mention' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `@${node.attrs['handle']}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs['handle']}`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          let isMention = false;
          const { selection } = state;
          const { empty, anchor } = selection;

          if (!empty) {
            return false;
          }

          state.doc.nodesBetween(anchor - 1, anchor, (node, pos): boolean => {
            if (node.type.name === this.name) {
              isMention = true;
              tr.insertText('', pos, pos + node.nodeSize);
              return false;
            }
            return true;
          });

          return isMention;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

export default Mention;
