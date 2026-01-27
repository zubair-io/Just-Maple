import TaskItem from '@tiptap/extension-task-item';
import type { TodoPriority, TodoColor } from '@maple/shared';

export interface EnhancedTaskItemOptions {
  onTodoClick?: (todoId: string, attrs: EnhancedTaskItemAttrs) => void;
  HTMLAttributes: Record<string, unknown>;
  nested: boolean;
}

export interface EnhancedTaskItemAttrs {
  id: string;
  checked: boolean;
  dueDate?: string;
  priority?: TodoPriority;
  color?: TodoColor;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedTaskItem: {
      /**
       * Update todo attributes
       */
      updateTodoAttrs: (
        todoId: string,
        attrs: Partial<Omit<EnhancedTaskItemAttrs, 'id'>>,
      ) => ReturnType;
      /**
       * Toggle todo completion
       */
      toggleTodo: (todoId: string) => ReturnType;
      /**
       * Set todo due date
       */
      setTodoDueDate: (todoId: string, dueDate: string | null) => ReturnType;
      /**
       * Set todo priority
       */
      setTodoPriority: (todoId: string, priority: TodoPriority | null) => ReturnType;
      /**
       * Set todo color
       */
      setTodoColor: (todoId: string, color: TodoColor | null) => ReturnType;
      /**
       * Scroll to a specific todo by ID
       */
      scrollToTodo: (todoId: string) => ReturnType;
    };
  }
}

/**
 * Generate a unique ID for todo items
 */
function generateTodoId(): string {
  return crypto.randomUUID();
}

/**
 * Get relative date text for due dates
 */
function getRelativeDateText(dueDate: string): string {
  const date = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (targetDate.getTime() === today.getTime()) {
    return 'Today';
  } else if (targetDate.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  } else if (targetDate < today) {
    const diffDays = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    return `${diffDays}d overdue`;
  } else if (targetDate < nextWeek) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Check if a due date is overdue
 */
function isOverdue(dueDate: string): boolean {
  const date = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return targetDate < today;
}

/**
 * Enhanced TaskItem extension with additional attributes:
 * - id: Unique identifier for deep linking
 * - dueDate: ISO 8601 due date/time
 * - priority: 'high' | 'medium' | 'low'
 * - color: 'red' | 'orange' | 'yellow' | 'green' | 'blue'
 */
export const EnhancedTaskItem = TaskItem.extend<EnhancedTaskItemOptions>({
  name: 'taskItem',

  addOptions() {
    return {
      ...this.parent?.(),
      onTodoClick: undefined,
      nested: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      // Unique ID for deep linking
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-todo-id'),
        renderHTML: (attributes) => {
          const id = attributes['id'] || generateTodoId();
          return { 'data-todo-id': id };
        },
      },
      // Due date (ISO 8601)
      dueDate: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-due-date'),
        renderHTML: (attributes) => {
          if (!attributes['dueDate']) {
            return {};
          }
          return { 'data-due-date': attributes['dueDate'] };
        },
      },
      // Priority level
      priority: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-priority'),
        renderHTML: (attributes) => {
          if (!attributes['priority']) {
            return {};
          }
          return { 'data-priority': attributes['priority'] };
        },
      },
      // Color tag
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-color'),
        renderHTML: (attributes) => {
          if (!attributes['color']) {
            return {};
          }
          return { 'data-color': attributes['color'] };
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      updateTodoAttrs:
        (todoId: string, attrs: Partial<Omit<EnhancedTaskItemAttrs, 'id'>>) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === todoId) {
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
      toggleTodo:
        (todoId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === todoId) {
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  checked: !node.attrs['checked'],
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
      setTodoDueDate:
        (todoId: string, dueDate: string | null) =>
        ({ commands }) => {
          return commands.updateTodoAttrs(todoId, { dueDate: dueDate || undefined });
        },
      setTodoPriority:
        (todoId: string, priority: TodoPriority | null) =>
        ({ commands }) => {
          return commands.updateTodoAttrs(todoId, { priority: priority || undefined });
        },
      setTodoColor:
        (todoId: string, color: TodoColor | null) =>
        ({ commands }) => {
          return commands.updateTodoAttrs(todoId, { color: color || undefined });
        },
      scrollToTodo:
        (todoId: string) =>
        ({ state, view }) => {
          const { doc } = state;
          let targetPos: number | null = null;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === todoId) {
              targetPos = pos;
              return false;
            }
            return true;
          });

          if (targetPos !== null) {
            // Scroll the node into view
            const domNode = view.nodeDOM(targetPos);
            if (domNode && domNode instanceof HTMLElement) {
              domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Add highlight class for visual feedback
              domNode.classList.add('todo-highlight');
              setTimeout(() => {
                domNode.classList.remove('todo-highlight');
              }, 1500);
            }
            return true;
          }

          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Cmd/Ctrl + Enter: Toggle todo completion
      'Mod-Enter': () => {
        const { state, dispatch } = this.editor.view;
        const { $from } = state.selection;

        // Find the taskItem node at or containing the cursor
        let taskItemPos: number | null = null;
        let taskItemNode = null;

        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'taskItem') {
            taskItemPos = $from.before(d);
            taskItemNode = node;
            break;
          }
        }

        if (taskItemPos !== null && taskItemNode) {
          if (dispatch) {
            const tr = state.tr.setNodeMarkup(taskItemPos, undefined, {
              ...taskItemNode.attrs,
              checked: !taskItemNode.attrs['checked'],
            });
            dispatch(tr);
          }
          return true;
        }

        return false;
      },

      // Cmd/Ctrl + Shift + P: Cycle priority (none → high → medium → low → none)
      'Mod-Shift-p': () => {
        const { state, dispatch } = this.editor.view;
        const { $from } = state.selection;

        let taskItemPos: number | null = null;
        let taskItemNode = null;

        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'taskItem') {
            taskItemPos = $from.before(d);
            taskItemNode = node;
            break;
          }
        }

        if (taskItemPos !== null && taskItemNode) {
          const currentPriority = taskItemNode.attrs['priority'];
          const priorityCycle = [null, 'high', 'medium', 'low'];
          const currentIndex = priorityCycle.indexOf(currentPriority);
          const nextIndex = (currentIndex + 1) % priorityCycle.length;
          const nextPriority = priorityCycle[nextIndex];

          if (dispatch) {
            const tr = state.tr.setNodeMarkup(taskItemPos, undefined, {
              ...taskItemNode.attrs,
              priority: nextPriority || undefined,
            });
            dispatch(tr);
          }
          return true;
        }

        return false;
      },

      // Cmd/Ctrl + Shift + D: Open date picker (dispatch event)
      'Mod-Shift-d': () => {
        const { state } = this.editor.view;
        const { $from } = state.selection;

        let taskItemNode = null;

        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'taskItem') {
            taskItemNode = node;
            break;
          }
        }

        if (taskItemNode) {
          // Dispatch event to open date picker
          const editorElement = this.editor.view.dom.closest('.editor-content');
          if (editorElement) {
            // Find the DOM element for this task item
            const todoId = taskItemNode.attrs['id'];
            const todoElement = editorElement.querySelector(
              `[data-todo-id="${todoId}"]`,
            ) as HTMLElement;
            const settingsBtn = todoElement?.querySelector('.todo-settings-btn') as HTMLElement;

            if (settingsBtn) {
              const event = new CustomEvent('todo-settings-click', {
                bubbles: true,
                detail: {
                  todoId,
                  attrs: {
                    id: todoId,
                    checked: taskItemNode.attrs['checked'],
                    dueDate: taskItemNode.attrs['dueDate'],
                    priority: taskItemNode.attrs['priority'],
                    color: taskItemNode.attrs['color'],
                  },
                  element: todoElement,
                  position: settingsBtn.getBoundingClientRect(),
                },
              });
              settingsBtn.dispatchEvent(event);
            }
          }
          return true;
        }

        return false;
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      // Ensure the node has an ID (generate one if missing)
      const nodeId = node.attrs['id'] || generateTodoId();
      if (!node.attrs['id']) {
        setTimeout(() => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos !== null && pos !== undefined) {
            editor.commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                id: nodeId,
              });
              return true;
            });
          }
        }, 0);
      }

      // Create the list item container
      const dom = document.createElement('li');
      dom.setAttribute('data-type', 'taskItem');
      dom.setAttribute('data-todo-id', nodeId);
      dom.setAttribute('data-checked', String(node.attrs['checked'] || false));

      if (node.attrs['color']) {
        dom.setAttribute('data-color', node.attrs['color']);
      }
      if (node.attrs['priority']) {
        dom.setAttribute('data-priority', node.attrs['priority']);
      }
      if (node.attrs['dueDate'] && !node.attrs['checked'] && isOverdue(node.attrs['dueDate'])) {
        dom.classList.add('todo-overdue');
      }

      // Create checkbox wrapper
      const checkboxWrapper = document.createElement('label');
      checkboxWrapper.classList.add('todo-checkbox-wrapper');
      checkboxWrapper.contentEditable = 'false';

      // Create checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = node.attrs['checked'] || false;
      checkbox.classList.add('todo-checkbox');
      checkbox.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) {
          editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              id: nodeId,
              checked: checkbox.checked,
            });
            return true;
          });
        }
      });
      checkboxWrapper.appendChild(checkbox);

      // Create content wrapper
      const content = document.createElement('div');
      content.classList.add('todo-content');

      // Create metadata wrapper
      const metaWrapper = document.createElement('div');
      metaWrapper.classList.add('todo-meta');
      metaWrapper.contentEditable = 'false';

      // Add priority badge if set
      if (node.attrs['priority']) {
        const priorityBadge = document.createElement('span');
        priorityBadge.classList.add('todo-priority', `priority-${node.attrs['priority']}`);
        priorityBadge.textContent =
          node.attrs['priority'].charAt(0).toUpperCase() + node.attrs['priority'].slice(1);
        metaWrapper.appendChild(priorityBadge);
      }

      // Add due date chip if set
      if (node.attrs['dueDate']) {
        const dueDateChip = document.createElement('span');
        dueDateChip.classList.add('todo-due-date');
        if (!node.attrs['checked'] && isOverdue(node.attrs['dueDate'])) {
          dueDateChip.classList.add('overdue');
        }
        dueDateChip.textContent = getRelativeDateText(node.attrs['dueDate']);
        metaWrapper.appendChild(dueDateChip);
      }

      // Add settings button
      const settingsBtn = document.createElement('button');
      settingsBtn.classList.add('todo-settings-btn');
      settingsBtn.type = 'button';
      settingsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5"/>
          <circle cx="8" cy="8" r="1.5"/>
          <circle cx="8" cy="13" r="1.5"/>
        </svg>
      `;

      // Mutable state for click handler
      const currentAttrs = {
        id: nodeId,
        checked: node.attrs['checked'] || false,
        dueDate: node.attrs['dueDate'],
        priority: node.attrs['priority'],
        color: node.attrs['color'],
      };

      settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const event = new CustomEvent('todo-settings-click', {
          bubbles: true,
          detail: {
            todoId: nodeId,
            attrs: { ...currentAttrs },
            element: dom,
            position: settingsBtn.getBoundingClientRect(),
          },
        });
        dom.dispatchEvent(event);
      });
      metaWrapper.appendChild(settingsBtn);

      // Assemble flat structure: li > [checkbox, content, meta]
      dom.appendChild(checkboxWrapper);
      dom.appendChild(content);
      dom.appendChild(metaWrapper);

      return {
        dom,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          // Verify this is the same node by checking the ID
          // Only reject if both nodes have IDs and they don't match
          const updatedNodeId = updatedNode.attrs['id'];
          if (updatedNodeId && nodeId && updatedNodeId !== nodeId) {
            // This update is for a different task item, reject it
            return false;
          }

          // Update checkbox state
          checkbox.checked = updatedNode.attrs['checked'] || false;
          dom.setAttribute('data-checked', String(updatedNode.attrs['checked'] || false));

          // Update color
          if (updatedNode.attrs['color']) {
            dom.setAttribute('data-color', updatedNode.attrs['color']);
          } else {
            dom.removeAttribute('data-color');
          }

          // Update priority
          if (updatedNode.attrs['priority']) {
            dom.setAttribute('data-priority', updatedNode.attrs['priority']);
          } else {
            dom.removeAttribute('data-priority');
          }

          // Update overdue class
          if (
            updatedNode.attrs['dueDate'] &&
            !updatedNode.attrs['checked'] &&
            isOverdue(updatedNode.attrs['dueDate'])
          ) {
            dom.classList.add('todo-overdue');
          } else {
            dom.classList.remove('todo-overdue');
          }

          // Update metadata
          metaWrapper.innerHTML = '';

          if (updatedNode.attrs['priority']) {
            const priorityBadge = document.createElement('span');
            priorityBadge.classList.add(
              'todo-priority',
              `priority-${updatedNode.attrs['priority']}`,
            );
            priorityBadge.textContent =
              updatedNode.attrs['priority'].charAt(0).toUpperCase() +
              updatedNode.attrs['priority'].slice(1);
            metaWrapper.appendChild(priorityBadge);
          }

          if (updatedNode.attrs['dueDate']) {
            const dueDateChip = document.createElement('span');
            dueDateChip.classList.add('todo-due-date');
            if (!updatedNode.attrs['checked'] && isOverdue(updatedNode.attrs['dueDate'])) {
              dueDateChip.classList.add('overdue');
            }
            dueDateChip.textContent = getRelativeDateText(updatedNode.attrs['dueDate']);
            metaWrapper.appendChild(dueDateChip);
          }

          // Re-add settings button
          const newSettingsBtn = document.createElement('button');
          newSettingsBtn.classList.add('todo-settings-btn');
          newSettingsBtn.type = 'button';
          newSettingsBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.5"/>
              <circle cx="8" cy="8" r="1.5"/>
              <circle cx="8" cy="13" r="1.5"/>
            </svg>
          `;

          // Update mutable state
          currentAttrs.id = updatedNode.attrs['id'] || nodeId;
          currentAttrs.checked = updatedNode.attrs['checked'] || false;
          currentAttrs.dueDate = updatedNode.attrs['dueDate'];
          currentAttrs.priority = updatedNode.attrs['priority'];
          currentAttrs.color = updatedNode.attrs['color'];

          newSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const event = new CustomEvent('todo-settings-click', {
              bubbles: true,
              detail: {
                todoId: currentAttrs.id,
                attrs: { ...currentAttrs },
                element: dom,
                position: newSettingsBtn.getBoundingClientRect(),
              },
            });
            dom.dispatchEvent(event);
          });
          metaWrapper.appendChild(newSettingsBtn);

          return true;
        },
      };
    };
  },
});
