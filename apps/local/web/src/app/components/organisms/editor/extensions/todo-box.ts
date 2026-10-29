import { Node, mergeAttributes } from '@tiptap/core';
import { generateUUID } from '../../../../utils/uuid';

export interface TodoBoxAttrs {
  id: string;
  name: string;
  showCompleted: boolean; // Whether to show completed section expanded
}

export interface TodoBoxOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    todoBox: {
      /**
       * Insert a todo box
       */
      insertTodoBox: (attrs?: Partial<TodoBoxAttrs>) => ReturnType;
      /**
       * Set todo box name
       */
      setTodoBoxName: (boxId: string, name: string) => ReturnType;
      /**
       * Toggle completed section visibility
       */
      toggleTodoBoxCompleted: (boxId: string) => ReturnType;
    };
  }
}

/**
 * Generate a unique ID for todo boxes
 */
function generateTodoBoxId(): string {
  return generateUUID();
}

/**
 * TodoBox Extension
 * A container for task lists with a header showing name and status
 */
export const TodoBox = Node.create<TodoBoxOptions>({
  name: 'todoBox',

  group: 'block',

  content: 'block+',

  defining: true,

  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-todobox-id'),
        renderHTML: (attributes) => {
          const id = attributes['id'] || generateTodoBoxId();
          return { 'data-todobox-id': id };
        },
      },
      name: {
        default: 'To-Do',
        parseHTML: (element) => element.getAttribute('data-name') || 'To-Do',
        renderHTML: (attributes) => {
          return { 'data-name': attributes['name'] || 'To-Do' };
        },
      },
      showCompleted: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-show-completed') !== 'false',
        renderHTML: (attributes) => {
          return { 'data-show-completed': String(attributes['showCompleted'] !== false) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="todo-box"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-type': 'todo-box' }, this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      insertTodoBox:
        (attrs) =>
        ({ commands }) => {
          const id = attrs?.id || generateTodoBoxId();
          return commands.insertContent({
            type: this.name,
            attrs: {
              id,
              name: attrs?.name || 'To-Do',
              showCompleted: attrs?.showCompleted ?? true,
            },
            content: [
              {
                type: 'taskList',
                content: [
                  {
                    type: 'taskItem',
                    attrs: { checked: false },
                    content: [{ type: 'paragraph' }],
                  },
                ],
              },
            ],
          });
        },
      setTodoBoxName:
        (boxId: string, name: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === boxId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                name,
              });
              found = true;
              return false;
            }
            return true;
          });

          if (found && dispatch) {
            dispatch(tr);
            return true;
          }
          return false;
        },
      toggleTodoBoxCompleted:
        (boxId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === boxId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                showCompleted: !node.attrs['showCompleted'],
              });
              found = true;
              return false;
            }
            return true;
          });

          if (found && dispatch) {
            dispatch(tr);
            return true;
          }
          return false;
        },
    };
  },

  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      let node = initialNode;
      const boxId = node.attrs['id'] || generateTodoBoxId();

      // Ensure the node has an ID
      if (!node.attrs['id']) {
        setTimeout(() => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos !== null && pos !== undefined) {
            editor.commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                id: boxId,
              });
              return true;
            });
          }
        }, 0);
      }

      // Create main container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'todo-box');
      dom.setAttribute('data-todobox-id', boxId);
      dom.classList.add('todo-box');

      // Create header
      const header = document.createElement('div');
      header.classList.add('todo-box-header');
      header.contentEditable = 'false';

      // Name input
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.classList.add('todo-box-name');
      nameInput.value = node.attrs['name'] || 'To-Do';
      nameInput.placeholder = 'Name your list...';
      nameInput.addEventListener('change', () => {
        (editor.commands as any).setTodoBoxName(boxId, nameInput.value || 'To-Do');
      });
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameInput.blur();
        }
      });

      // Status display
      const statusDisplay = document.createElement('span');
      statusDisplay.classList.add('todo-box-status');

      // Helper to count todos and update UI
      const updateStatus = () => {
        let total = 0;
        let completed = 0;
        node.descendants((child) => {
          if (child.type.name === 'taskItem') {
            total++;
            if (child.attrs['checked']) {
              completed++;
            }
          }
        });

        const remaining = total - completed;
        if (total === 0) {
          statusDisplay.textContent = '';
          completedToggle.style.display = 'none';
        } else if (remaining === 0) {
          statusDisplay.textContent = 'All done!';
          statusDisplay.classList.add('all-done');
          statusDisplay.classList.remove('has-remaining');
          completedToggle.style.display = completed > 0 ? 'flex' : 'none';
        } else {
          statusDisplay.textContent = `${remaining} to go`;
          statusDisplay.classList.remove('all-done');
          statusDisplay.classList.add('has-remaining');
          completedToggle.style.display = completed > 0 ? 'flex' : 'none';
        }

        // Update completed count badge
        if (completed > 0) {
          completedCount.textContent = String(completed);
        } else {
          completedCount.textContent = '';
        }
      };

      // Initial status
      updateStatus();

      header.appendChild(nameInput);
      header.appendChild(statusDisplay);

      // Content area (for the taskList)
      const content = document.createElement('div');
      content.classList.add('todo-box-content');

      // Completed section toggle (at bottom of content)
      const completedToggle = document.createElement('div');
      completedToggle.classList.add('todo-box-completed-toggle');
      completedToggle.contentEditable = 'false';

      const toggleChevron = document.createElement('span');
      toggleChevron.classList.add('material-symbols-rounded');
      toggleChevron.textContent = node.attrs['showCompleted'] ? 'expand_more' : 'chevron_right';

      const toggleText = document.createElement('span');
      toggleText.textContent = 'Completed';

      const completedCount = document.createElement('span');
      completedCount.classList.add('completed-count');

      completedToggle.appendChild(toggleChevron);
      completedToggle.appendChild(toggleText);
      completedToggle.appendChild(completedCount);

      completedToggle.addEventListener('click', () => {
        (editor.commands as any).toggleTodoBoxCompleted(boxId);
      });

      // Set initial show completed state
      dom.setAttribute('data-show-completed', String(node.attrs['showCompleted'] !== false));

      // Assemble
      dom.appendChild(header);
      dom.appendChild(content);
      dom.appendChild(completedToggle);

      return {
        dom,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          const updatedId = updatedNode.attrs['id'];
          if (updatedId && boxId && updatedId !== boxId) {
            return false;
          }

          node = updatedNode;

          // Update name
          if (nameInput.value !== updatedNode.attrs['name']) {
            nameInput.value = updatedNode.attrs['name'] || 'To-Do';
          }

          // Update status
          updateStatus();

          // Update show completed state
          const showCompleted = updatedNode.attrs['showCompleted'] !== false;
          dom.setAttribute('data-show-completed', String(showCompleted));
          toggleChevron.textContent = showCompleted ? 'expand_more' : 'chevron_right';

          return true;
        },
        stopEvent: (event) => {
          const target = event.target as HTMLElement;
          // Don't stop events on the content area
          return !content.contains(target);
        },
        ignoreMutation: (mutation) => {
          const target = mutation.target;
          if (target === header || (target instanceof window.Node && header.contains(target))) {
            return true;
          }
          return false;
        },
      };
    };
  },
});
