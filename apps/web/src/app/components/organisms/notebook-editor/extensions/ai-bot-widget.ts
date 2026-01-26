import { Node, mergeAttributes, type Editor, type Range } from '@tiptap/core';

export type AiBotWidgetStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AiBotWidgetOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface AiBotWidgetAttrs {
  id: string;
  prompt: string;
  status: AiBotWidgetStatus;
  errorMessage: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiBotWidget: {
      /**
       * Insert an AI bot widget at the current position
       */
      insertAiBotWidget: () => ReturnType;
      /**
       * Remove an AI bot widget by id
       */
      removeAiBotWidget: (id: string) => ReturnType;
      /**
       * Update an AI bot widget's attributes
       */
      updateAiBotWidget: (id: string, attrs: Partial<AiBotWidgetAttrs>) => ReturnType;
    };
  }
}

/**
 * AI Bot Widget Extension
 * Renders an inline AI prompt interface for document editing
 */
export const AiBotWidget = Node.create<AiBotWidgetOptions>({
  name: 'aiBotWidget',

  group: 'block',

  atom: true, // Non-editable, treated as a single unit

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-widget-id'),
        renderHTML: (attributes) => {
          if (!attributes['id']) {
            return {};
          }
          return {
            'data-widget-id': attributes['id'],
          };
        },
      },
      prompt: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-prompt') || '',
        renderHTML: (attributes) => ({
          'data-prompt': attributes['prompt'] || '',
        }),
      },
      status: {
        default: 'idle' as AiBotWidgetStatus,
        parseHTML: (element) =>
          (element.getAttribute('data-status') as AiBotWidgetStatus) || 'idle',
        renderHTML: (attributes) => ({
          'data-status': attributes['status'] || 'idle',
        }),
      },
      errorMessage: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-error-message'),
        renderHTML: (attributes) => {
          if (!attributes['errorMessage']) {
            return {};
          }
          return {
            'data-error-message': attributes['errorMessage'],
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ai-bot-widget"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'ai-bot-widget',
        class: 'ai-bot-widget',
      }),
    ];
  },

  addCommands() {
    return {
      insertAiBotWidget:
        () =>
        ({ commands }) => {
          const id = crypto.randomUUID();
          return commands.insertContent({
            type: this.name,
            attrs: {
              id,
              prompt: '',
              status: 'idle',
              errorMessage: null,
            },
          });
        },
      removeAiBotWidget:
        (id: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === id) {
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
      updateAiBotWidget:
        (id: string, attrs: Partial<AiBotWidgetAttrs>) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === id) {
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  ...attrs,
                });
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

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-a': () => this.editor.commands.insertAiBotWidget(),
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const id = node.attrs['id'] as string;
      const prompt = node.attrs['prompt'] as string;
      const status = node.attrs['status'] as AiBotWidgetStatus;
      const errorMessage = node.attrs['errorMessage'] as string | null;

      // Create container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'ai-bot-widget');
      dom.setAttribute('data-widget-id', id);
      dom.setAttribute('data-status', status);
      dom.classList.add('ai-bot-widget');
      dom.contentEditable = 'false';

      // Create the inner content wrapper that will be populated by Angular
      const content = document.createElement('div');
      content.classList.add('ai-bot-widget-content');
      content.setAttribute('data-widget-id', id);
      dom.appendChild(content);

      // Dispatch custom event when node is mounted
      // Angular component will listen for this
      setTimeout(() => {
        const event = new CustomEvent('ai-bot-widget-mounted', {
          bubbles: true,
          detail: {
            id,
            prompt,
            status,
            errorMessage,
            element: content,
            editor,
            getPos,
          },
        });
        dom.dispatchEvent(event);
      }, 0);

      return {
        dom,
        // Prevent ProseMirror from handling events inside the widget
        // This allows the input to receive focus and keyboard events
        stopEvent: (event: Event) => {
          // Allow all events inside the widget content to be handled by the widget
          const target = event.target as HTMLElement;
          if (target && dom.contains(target)) {
            // Stop ProseMirror from handling mouse and keyboard events
            return true;
          }
          return false;
        },
        // Prevent ProseMirror from reacting to DOM mutations inside the widget
        ignoreMutation: () => {
          // Ignore all mutations inside the widget
          return true;
        },
        destroy: () => {
          // Dispatch unmount event
          const event = new CustomEvent('ai-bot-widget-unmounted', {
            bubbles: true,
            detail: { id },
          });
          dom.dispatchEvent(event);
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }
          // Update attrs if changed
          const newId = updatedNode.attrs['id'] as string;
          const newStatus = updatedNode.attrs['status'] as AiBotWidgetStatus;

          if (newId !== id) {
            dom.setAttribute('data-widget-id', newId);
            content.setAttribute('data-widget-id', newId);
          }
          if (newStatus !== status) {
            dom.setAttribute('data-status', newStatus);
          }

          // Dispatch update event so Angular component can react
          const updateEvent = new CustomEvent('ai-bot-widget-updated', {
            bubbles: true,
            detail: {
              id: newId,
              prompt: updatedNode.attrs['prompt'],
              status: newStatus,
              errorMessage: updatedNode.attrs['errorMessage'],
            },
          });
          dom.dispatchEvent(updateEvent);

          return true;
        },
      };
    };
  },
});

/**
 * Helper function to get document content as text
 */
export function getDocumentAsText(editor: Editor): string {
  return editor.state.doc.textContent;
}

/**
 * Helper function to get document content as markdown-like format
 */
export function getDocumentAsMarkdown(editor: Editor): string {
  const doc = editor.state.doc;
  const parts: string[] = [];

  doc.descendants((node) => {
    if (node.isText) {
      parts.push(node.text || '');
    } else if (node.type.name === 'paragraph') {
      parts.push('\n');
    } else if (node.type.name === 'heading') {
      const level = node.attrs['level'] || 1;
      parts.push('\n' + '#'.repeat(level) + ' ');
    } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      // Lists are handled by their children
    } else if (node.type.name === 'listItem') {
      parts.push('\n- ');
    } else if (node.type.name === 'codeBlock') {
      parts.push('\n```\n');
    } else if (node.type.name === 'blockquote') {
      parts.push('\n> ');
    } else if (node.type.name === 'horizontalRule') {
      parts.push('\n---\n');
    }
    return true;
  });

  return parts.join('').trim();
}
