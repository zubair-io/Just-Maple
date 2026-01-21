import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { customAlphabet } from 'nanoid';

// Generate recording IDs using base58 alphabet
const nanoidBase58 = customAlphabet(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  16,
);

export interface RecordingNodeOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    recording: {
      /**
       * Insert a recording block
       */
      insertRecording: (recordingId?: string) => ReturnType;
      /**
       * Delete a recording block
       */
      deleteRecording: (recordingId: string) => ReturnType;
    };
  }
}

/**
 * Recording Node Extension
 * Renders an audio recording block with recording/playback controls
 */
export const RecordingNode = Node.create<RecordingNodeOptions>({
  name: 'recording',

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
      recordingId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-recording-id'),
        renderHTML: (attributes) => {
          if (!attributes['recordingId']) {
            return {};
          }
          return {
            'data-recording-id': attributes['recordingId'],
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="recording"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'recording',
        class: 'recording-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertRecording:
        (recordingId?: string) =>
        ({ commands }) => {
          const id = recordingId || nanoidBase58();
          return commands.insertContent({
            type: this.name,
            attrs: { recordingId: id },
          });
        },
      deleteRecording:
        (recordingId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['recordingId'] === recordingId) {
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
    return ({ node, editor, getPos }) => {
      const recordingId = node.attrs['recordingId'] as string;

      // Create container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'recording');
      dom.setAttribute('data-recording-id', recordingId);
      dom.classList.add('recording-block');
      dom.contentEditable = 'false';

      // Create the inner content wrapper that will be populated by Angular
      const content = document.createElement('div');
      content.classList.add('recording-block-content');
      content.setAttribute('data-recording-id', recordingId);
      dom.appendChild(content);

      // Dispatch custom event when node is mounted
      // Angular component will listen for this
      setTimeout(() => {
        const event = new CustomEvent('recording-node-mounted', {
          bubbles: true,
          detail: { recordingId, element: content, editor },
        });
        dom.dispatchEvent(event);
      }, 0);

      return {
        dom,
        destroy: () => {
          // Dispatch unmount event
          const event = new CustomEvent('recording-node-unmounted', {
            bubbles: true,
            detail: { recordingId },
          });
          dom.dispatchEvent(event);
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }
          // Update recordingId if changed
          const newRecordingId = updatedNode.attrs['recordingId'] as string;
          if (newRecordingId !== recordingId) {
            dom.setAttribute('data-recording-id', newRecordingId);
            content.setAttribute('data-recording-id', newRecordingId);
          }
          return true;
        },
      };
    };
  },
});
