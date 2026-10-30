import TaskList from '@tiptap/extension-task-list';
import { mergeAttributes } from '@tiptap/core';
import { generateUUID } from '../../../../utils/uuid';

export interface EnhancedTaskListAttrs {
  id: string;
  name: string;
  showCompleted: boolean;
}

export interface EnhancedTaskListOptions {
  HTMLAttributes: Record<string, unknown>;
  itemTypeName: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedTaskList: {
      /**
       * Set task list name
       */
      setTaskListName: (listId: string, name: string) => ReturnType;
      /**
       * Toggle completed section visibility
       */
      toggleTaskListCompleted: (listId: string) => ReturnType;
    };
  }
}

/**
 * Generate a unique ID for task lists
 */
function generateTaskListId(): string {
  return generateUUID();
}

/**
 * Enhanced TaskList extension with header, name, status, and collapsible completed section
 */
export const EnhancedTaskList = TaskList.extend<EnhancedTaskListOptions>({
  name: 'taskList',

  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {},
      itemTypeName: 'taskItem',
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-list-id'),
        renderHTML: (attributes) => {
          const id = attributes['id'] || generateTaskListId();
          return { 'data-list-id': id };
        },
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name') || '',
        renderHTML: (attributes) => {
          if (!attributes['name']) return {};
          return { 'data-name': attributes['name'] };
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

  renderHTML({ HTMLAttributes }) {
    return [
      'ul',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'taskList' }),
      0,
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTaskListName:
        (listId: string, name: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === listId) {
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
      toggleTaskListCompleted:
        (listId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === listId) {
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
      const listId = node.attrs['id'] || generateTaskListId();

      // Ensure the node has an ID
      if (!node.attrs['id']) {
        setTimeout(() => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos !== null && pos !== undefined) {
            editor.commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                id: listId,
              });
              return true;
            });
          }
        }, 0);
      }

      // Create wrapper div for the whole component
      const wrapper = document.createElement('div');
      wrapper.classList.add('task-list-wrapper');
      wrapper.setAttribute('data-list-id', listId);

      // Create header (only shown when name is set)
      const header = document.createElement('div');
      header.classList.add('task-list-header');
      header.contentEditable = 'false';

      // Name input
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.classList.add('task-list-name');
      nameInput.value = node.attrs['name'] || '';
      nameInput.placeholder = 'Name this list...';
      nameInput.addEventListener('change', () => {
        (editor.commands as any).setTaskListName(listId, nameInput.value);
      });
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameInput.blur();
        }
      });

      // Status display (also acts as toggle for completed items)
      const statusDisplay = document.createElement('button');
      statusDisplay.type = 'button';
      statusDisplay.classList.add('task-list-status');

      const statusChevron = document.createElement('span');
      statusChevron.classList.add('material-symbols-rounded', 'status-chevron');
      statusChevron.textContent = node.attrs['showCompleted'] ? 'expand_more' : 'chevron_right';

      const statusText = document.createElement('span');
      statusText.classList.add('status-text');

      statusDisplay.appendChild(statusChevron);
      statusDisplay.appendChild(statusText);

      statusDisplay.addEventListener('click', () => {
        (editor.commands as any).toggleTaskListCompleted(listId);
      });

      header.appendChild(nameInput);
      header.appendChild(statusDisplay);

      // Create the actual UL for task items
      const ul = document.createElement('ul');
      ul.setAttribute('data-type', 'taskList');
      ul.setAttribute('data-list-id', listId);
      ul.classList.add('task-list-content');

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
          statusText.textContent = '';
          statusDisplay.style.display = 'none';
        } else if (remaining === 0) {
          statusText.textContent = `All done! (${completed})`;
          statusDisplay.classList.add('all-done');
          statusDisplay.classList.remove('has-remaining');
          statusDisplay.style.display = 'flex';
        } else {
          statusText.textContent = `${remaining} to go`;
          if (completed > 0) {
            statusText.textContent += ` · ${completed} done`;
          }
          statusDisplay.classList.remove('all-done');
          statusDisplay.classList.add('has-remaining');
          statusDisplay.style.display = 'flex';
        }
      };

      // Set initial show completed state
      wrapper.setAttribute('data-show-completed', String(node.attrs['showCompleted'] !== false));

      // Initial status
      updateStatus();

      // Assemble
      wrapper.appendChild(header);
      wrapper.appendChild(ul);

      return {
        dom: wrapper,
        contentDOM: ul,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          const updatedId = updatedNode.attrs['id'];
          if (updatedId && listId && updatedId !== listId) {
            return false;
          }

          node = updatedNode;

          // Update name
          if (nameInput.value !== updatedNode.attrs['name']) {
            nameInput.value = updatedNode.attrs['name'] || '';
          }

          // Update status
          updateStatus();

          // Update show completed state
          const showCompleted = updatedNode.attrs['showCompleted'] !== false;
          wrapper.setAttribute('data-show-completed', String(showCompleted));
          statusChevron.textContent = showCompleted ? 'expand_more' : 'chevron_right';

          return true;
        },
        stopEvent: (event) => {
          const target = event.target as HTMLElement;
          // Don't stop events on the content area (ul)
          return !ul.contains(target);
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
