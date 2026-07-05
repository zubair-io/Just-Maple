import TaskList from '@tiptap/extension-task-list';
import { mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { TodoPriority, TodoColor } from '@maple/shared';

export interface EnhancedTaskListAttrs {
  id: string;
  name: string;
  showCompleted: boolean;
}

export interface EnhancedTaskListOptions {
  HTMLAttributes: Record<string, unknown>;
  itemTypeName: string;
}

// Priority and color options
const PRIORITIES: { value: TodoPriority; icon: string; title: string }[] = [
  { value: 'high', icon: 'keyboard_double_arrow_up', title: 'High priority' },
  { value: 'medium', icon: 'remove', title: 'Medium priority' },
  { value: 'low', icon: 'keyboard_double_arrow_down', title: 'Low priority' },
];

const COLORS: { value: TodoColor; hex: string }[] = [
  { value: 'red', hex: '#EF4444' },
  { value: 'orange', hex: '#F97316' },
  { value: 'yellow', hex: '#EAB308' },
  { value: 'green', hex: '#22C55E' },
  { value: 'blue', hex: '#3B82F6' },
];

interface ActiveTask {
  id: string;
  priority?: TodoPriority;
  color?: TodoColor;
  dueDate?: string;
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
  return crypto.randomUUID();
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
        ({ state, dispatch }: any) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node: any, pos: any) => {
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
        ({ state, dispatch }: any) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node: any, pos: any) => {
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
      let activeTask: ActiveTask | null = null;

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

      // Create floating toolbar for task item editing
      const toolbar = document.createElement('div');
      toolbar.classList.add('task-list-toolbar');
      toolbar.contentEditable = 'false';
      toolbar.style.display = 'none';

      // Priority buttons
      const priorityGroup = document.createElement('div');
      priorityGroup.classList.add('toolbar-group', 'priority-group');

      PRIORITIES.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('toolbar-btn', 'priority-btn', `priority-${p.value}`);
        btn.title = p.title;
        btn.setAttribute('data-priority', p.value);
        const icon = document.createElement('span');
        icon.classList.add('material-symbols-rounded');
        icon.textContent = p.icon;
        btn.appendChild(icon);
        btn.addEventListener('click', () => {
          if (!activeTask) return;
          const newPriority = activeTask.priority === p.value ? null : p.value;
          (editor.commands as any).updateTodoAttrs(activeTask.id, {
            priority: newPriority || undefined,
          });
        });
        priorityGroup.appendChild(btn);
      });

      // Divider
      const divider1 = document.createElement('div');
      divider1.classList.add('toolbar-divider');

      // Color buttons
      const colorGroup = document.createElement('div');
      colorGroup.classList.add('toolbar-group', 'color-group');

      COLORS.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('toolbar-btn', 'color-btn');
        btn.setAttribute('data-color', c.value);
        const dot = document.createElement('span');
        dot.classList.add('color-dot');
        dot.style.background = c.hex;
        btn.appendChild(dot);
        btn.addEventListener('click', () => {
          if (!activeTask) return;
          const newColor = activeTask.color === c.value ? null : c.value;
          (editor.commands as any).updateTodoAttrs(activeTask.id, {
            color: newColor || undefined,
          });
        });
        colorGroup.appendChild(btn);
      });

      // Divider
      const divider2 = document.createElement('div');
      divider2.classList.add('toolbar-divider');

      // Date picker
      const dateGroup = document.createElement('div');
      dateGroup.classList.add('toolbar-group', 'date-group');

      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.classList.add('date-input');
      dateInput.addEventListener('change', () => {
        if (!activeTask) return;
        if (dateInput.value) {
          const date = new Date(dateInput.value + 'T00:00:00');
          (editor.commands as any).updateTodoAttrs(activeTask.id, {
            dueDate: date.toISOString(),
          });
        } else {
          (editor.commands as any).updateTodoAttrs(activeTask.id, {
            dueDate: undefined,
          });
        }
      });

      const clearDateBtn = document.createElement('button');
      clearDateBtn.type = 'button';
      clearDateBtn.classList.add('toolbar-btn', 'clear-date-btn');
      clearDateBtn.textContent = '✕';
      clearDateBtn.title = 'Clear date';
      clearDateBtn.style.display = 'none';
      clearDateBtn.addEventListener('click', () => {
        if (!activeTask) return;
        (editor.commands as any).updateTodoAttrs(activeTask.id, { dueDate: undefined });
        dateInput.value = '';
        clearDateBtn.style.display = 'none';
      });

      dateGroup.appendChild(dateInput);
      dateGroup.appendChild(clearDateBtn);

      toolbar.appendChild(priorityGroup);
      toolbar.appendChild(divider1);
      toolbar.appendChild(colorGroup);
      toolbar.appendChild(divider2);
      toolbar.appendChild(dateGroup);

      // Create the actual UL for task items
      const ul = document.createElement('ul');
      ul.setAttribute('data-type', 'taskList');
      ul.setAttribute('data-list-id', listId);
      ul.classList.add('task-list-content');

      // Helper to update toolbar state
      const updateToolbar = () => {
        if (!activeTask) {
          toolbar.style.display = 'none';
          return;
        }

        toolbar.style.display = 'flex';

        // Update priority buttons
        priorityGroup.querySelectorAll('.priority-btn').forEach((btn) => {
          const btnPriority = btn.getAttribute('data-priority');
          btn.classList.toggle('active', btnPriority === activeTask?.priority);
        });

        // Update color buttons
        colorGroup.querySelectorAll('.color-btn').forEach((btn) => {
          const btnColor = btn.getAttribute('data-color');
          btn.classList.toggle('active', btnColor === activeTask?.color);
        });

        // Update date input
        if (activeTask.dueDate) {
          const date = new Date(activeTask.dueDate);
          dateInput.value = date.toISOString().split('T')[0];
          clearDateBtn.style.display = 'flex';
        } else {
          dateInput.value = '';
          clearDateBtn.style.display = 'none';
        }
      };

      // Helper to find active task in this list
      const findActiveTask = (ed: Editor): ActiveTask | null => {
        const { $from } = ed.state.selection;

        // Walk up the tree to find taskItem
        for (let d = $from.depth; d >= 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'taskItem') {
            // Check if this task item is within our list
            for (let pd = d - 1; pd >= 0; pd--) {
              const parent = $from.node(pd);
              if (parent.type.name === 'taskList') {
                const parentId = parent.attrs['id'];
                if (parentId === listId || (!parentId && !listId)) {
                  return {
                    id: n.attrs['id'],
                    priority: n.attrs['priority'],
                    color: n.attrs['color'],
                    dueDate: n.attrs['dueDate'],
                  };
                }
                break;
              }
            }
            break;
          }
        }
        return null;
      };

      // Subscribe to editor selection changes
      const handleSelectionUpdate = () => {
        activeTask = findActiveTask(editor as any);
        updateToolbar();
      };

      editor.on('selectionUpdate', handleSelectionUpdate);
      editor.on('transaction', handleSelectionUpdate);

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
      wrapper.appendChild(toolbar);
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

          // Update toolbar in case task attributes changed
          activeTask = findActiveTask(editor as any);
          updateToolbar();

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
          if (target === toolbar || (target instanceof window.Node && toolbar.contains(target))) {
            return true;
          }
          return false;
        },
        destroy: () => {
          editor.off('selectionUpdate', handleSelectionUpdate);
          editor.off('transaction', handleSelectionUpdate);
        },
      };
    };
  },
});
