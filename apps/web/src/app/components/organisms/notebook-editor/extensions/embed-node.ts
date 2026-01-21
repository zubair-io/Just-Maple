import { Node, mergeAttributes } from '@tiptap/core';

export type EmbedType = 'recording' | 'whiteboard' | 'memo';

export interface EmbedNodeOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /**
       * Insert an embed block with an id, type, and creator userId
       */
      insertEmbed: (id: string, type: EmbedType, createdBy: string) => ReturnType;
      /**
       * Delete an embed block by id
       */
      deleteEmbed: (id: string) => ReturnType;
    };
  }
}

/**
 * Generic Embed Node Extension
 * Renders embedded content (recordings, whiteboards, memos) based on type attribute
 */
export const EmbedNode = Node.create<EmbedNodeOptions>({
  name: 'embed',

  group: 'block',

  atom: true, // Non-editable, treated as a single unit

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
        parseHTML: (element) => element.getAttribute('data-embed-id'),
        renderHTML: (attributes) => {
          if (!attributes['id']) {
            return {};
          }
          return {
            'data-embed-id': attributes['id'],
          };
        },
      },
      type: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-embed-type'),
        renderHTML: (attributes) => {
          if (!attributes['type']) {
            return {};
          }
          return {
            'data-embed-type': attributes['type'],
          };
        },
      },
      createdBy: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-created-by'),
        renderHTML: (attributes) => {
          if (!attributes['createdBy']) {
            return {};
          }
          return {
            'data-created-by': attributes['createdBy'],
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embed"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'embed',
        class: 'embed-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertEmbed:
        (id: string, embedType: EmbedType, createdBy: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { id, type: embedType, createdBy },
          });
        },
      deleteEmbed:
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
    };
  },

  addNodeView() {
    return ({ node }) => {
      const id = node.attrs['id'] as string;
      const embedType = node.attrs['type'] as EmbedType;
      const createdBy = node.attrs['createdBy'] as string | null;

      // Create container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'embed');
      dom.setAttribute('data-embed-id', id);
      dom.setAttribute('data-embed-type', embedType);
      if (createdBy) {
        dom.setAttribute('data-created-by', createdBy);
      }
      dom.classList.add('embed-block');
      dom.contentEditable = 'false';

      // Create the inner content wrapper that will be populated by Angular
      const content = document.createElement('div');
      content.classList.add('embed-block-content');
      content.setAttribute('data-embed-id', id);
      content.setAttribute('data-embed-type', embedType);
      if (createdBy) {
        content.setAttribute('data-created-by', createdBy);
      }
      dom.appendChild(content);

      // Dispatch custom event when node is mounted
      // Angular component will listen for this
      setTimeout(() => {
        const event = new CustomEvent('embed-node-mounted', {
          bubbles: true,
          detail: { id, type: embedType, createdBy, element: content },
        });
        dom.dispatchEvent(event);
      }, 0);

      return {
        dom,
        destroy: () => {
          // Dispatch unmount event
          const event = new CustomEvent('embed-node-unmounted', {
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
          const newType = updatedNode.attrs['type'] as EmbedType;
          if (newId !== id) {
            dom.setAttribute('data-embed-id', newId);
            content.setAttribute('data-embed-id', newId);
          }
          if (newType !== embedType) {
            dom.setAttribute('data-embed-type', newType);
            content.setAttribute('data-embed-type', newType);
          }
          return true;
        },
      };
    };
  },
});
