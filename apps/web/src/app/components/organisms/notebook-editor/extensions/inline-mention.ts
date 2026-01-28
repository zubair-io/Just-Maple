import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

/**
 * Format time for display (e.g., "2:30 PM")
 */
export function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format date for display (e.g., "Jan 28, 2026")
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Get current time in HH:mm format
 */
function getCurrentTime(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================
// Inline Mention Types
// ============================================

export type InlineMentionType = 'time' | 'date' | 'user';

export interface InlineMentionAttrs {
  type: InlineMentionType;
  value: string; // time: HH:mm, date: YYYY-MM-DD, user: userId
  displayName?: string; // For user: first name
  avatarUrl?: string; // For user: profile picture URL
}

export interface InlineMentionSuggestion {
  id: InlineMentionType;
  label: string;
  icon: string;
  description: string;
}

export const inlineMentionSuggestions: InlineMentionSuggestion[] = [
  { id: 'time', label: 'Time', icon: 'schedule', description: 'Insert current time' },
  { id: 'date', label: 'Date', icon: 'calendar_today', description: 'Insert current date' },
  { id: 'user', label: 'User', icon: 'person', description: 'Insert your name' },
];

export interface InlineMentionOptions {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<InlineMentionSuggestion>, 'editor'>;
  // User info for @user mentions
  currentUser?: {
    id: string;
    firstName: string;
    avatarUrl?: string;
  };
}

export const InlineMentionPluginKey = new PluginKey('inlineMention');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineMention: {
      /**
       * Insert an inline mention
       */
      insertInlineMention: (attrs: InlineMentionAttrs) => ReturnType;
    };
  }
}

export const InlineMention = Node.create<InlineMentionOptions>({
  name: 'inlineMention',

  addOptions() {
    return {
      HTMLAttributes: {},
      suggestion: {
        char: '@',
        pluginKey: InlineMentionPluginKey,
        items: ({ query }) => {
          return inlineMentionSuggestions.filter((item) =>
            item.label.toLowerCase().includes(query.toLowerCase()),
          );
        },
        // command and allow are defined in addProseMirrorPlugins to access this.options
        command: () => {},
        allow: () => true,
      },
      currentUser: undefined,
    };
  },

  group: 'inline',

  inline: true,

  selectable: true,

  atom: true,

  addAttributes() {
    return {
      type: {
        default: 'time',
        parseHTML: (element) => element.getAttribute('data-mention-type') as InlineMentionType,
        renderHTML: (attributes) => ({ 'data-mention-type': attributes['type'] }),
      },
      value: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-value'),
        renderHTML: (attributes) => ({ 'data-value': attributes['value'] }),
      },
      displayName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-display-name'),
        renderHTML: (attributes) => {
          if (!attributes['displayName']) return {};
          return { 'data-display-name': attributes['displayName'] };
        },
      },
      avatarUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-avatar-url'),
        renderHTML: (attributes) => {
          if (!attributes['avatarUrl']) return {};
          return { 'data-avatar-url': attributes['avatarUrl'] };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-mention"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs['type'] as InlineMentionType;
    const value = node.attrs['value'];
    let displayContent = '';
    let className = 'inline-mention';

    switch (type) {
      case 'time':
        displayContent = formatTime(value);
        className += ' inline-mention-time';
        break;
      case 'date':
        displayContent = formatDate(value);
        className += ' inline-mention-date';
        break;
      case 'user':
        displayContent = node.attrs['displayName'] || 'User';
        className += ' inline-mention-user';
        break;
    }

    return [
      'span',
      mergeAttributes(
        { 'data-type': 'inline-mention', class: className },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      displayContent,
    ];
  },

  renderText({ node }) {
    const type = node.attrs['type'] as InlineMentionType;
    const value = node.attrs['value'];

    switch (type) {
      case 'time':
        return formatTime(value);
      case 'date':
        return formatDate(value);
      case 'user':
        return node.attrs['displayName'] || 'User';
      default:
        return '';
    }
  },

  addCommands() {
    return {
      insertInlineMention:
        (attrs: InlineMentionAttrs) =>
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

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const type = node.attrs['type'] as InlineMentionType;
      const value = node.attrs['value'];

      const dom = document.createElement('span');
      dom.setAttribute('data-type', 'inline-mention');
      dom.setAttribute('data-mention-type', type);
      dom.setAttribute('data-value', value);
      dom.classList.add('inline-mention', `inline-mention-${type}`);

      // Create content based on type
      if (type === 'user' && node.attrs['avatarUrl']) {
        // User with avatar
        const avatar = document.createElement('img');
        avatar.src = node.attrs['avatarUrl'];
        avatar.classList.add('inline-mention-avatar');
        avatar.alt = '';
        dom.appendChild(avatar);

        const name = document.createElement('span');
        name.textContent = node.attrs['displayName'] || 'User';
        dom.appendChild(name);
      } else if (type === 'user') {
        // User without avatar - show icon
        const icon = document.createElement('span');
        icon.classList.add('material-symbols-rounded', 'inline-mention-icon');
        icon.textContent = 'person';
        dom.appendChild(icon);

        const name = document.createElement('span');
        name.textContent = node.attrs['displayName'] || 'User';
        dom.appendChild(name);
      } else {
        // Time or Date
        const icon = document.createElement('span');
        icon.classList.add('material-symbols-rounded', 'inline-mention-icon');
        icon.textContent = type === 'time' ? 'schedule' : 'calendar_today';
        dom.appendChild(icon);

        const text = document.createElement('span');
        text.classList.add('inline-mention-value');
        text.textContent = type === 'time' ? formatTime(value) : formatDate(value);
        dom.appendChild(text);
      }

      // Make clickable to edit
      dom.style.cursor = 'pointer';
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;

        // Dispatch custom event for the component to handle
        dom.dispatchEvent(
          new CustomEvent('inline-mention-click', {
            bubbles: true,
            detail: {
              type,
              value,
              pos,
              nodeAttrs: node.attrs,
              element: dom,
            },
          }),
        );
      });

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          const newType = updatedNode.attrs['type'] as InlineMentionType;
          const newValue = updatedNode.attrs['value'];

          // Update the display
          dom.setAttribute('data-value', newValue);

          const valueSpan = dom.querySelector('.inline-mention-value');
          if (valueSpan) {
            valueSpan.textContent =
              newType === 'time' ? formatTime(newValue) : formatDate(newValue);
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
        // Override command to have access to this.options.currentUser
        command: ({ editor, range, props }) => {
          const suggestion = props as InlineMentionSuggestion;
          let attrs: InlineMentionAttrs;

          switch (suggestion.id) {
            case 'time':
              attrs = { type: 'time', value: getCurrentTime() };
              break;
            case 'date':
              attrs = { type: 'date', value: getCurrentDate() };
              break;
            case 'user':
              const user = extensionThis.options.currentUser;
              attrs = {
                type: 'user',
                value: user?.id || '',
                displayName: user?.firstName || 'User',
                avatarUrl: user?.avatarUrl,
              };
              break;
            default:
              return;
          }

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: extensionThis.name, attrs },
              { type: 'text', text: ' ' },
            ])
            .run();

          window.getSelection()?.collapseToEnd();
        },
        // Override allow to validate mention can be inserted
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[extensionThis.name];
          return !!$from.parent.type.contentMatch.matchType(type);
        },
      }),
    ];
  },
});
