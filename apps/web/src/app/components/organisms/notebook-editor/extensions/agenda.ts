import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface AgendaAttrs {
  id: string;
  date: string; // ISO date (YYYY-MM-DD)
  time?: string; // Optional HH:mm (future use)
  summary?: string; // AI-generated or user-edited summary
}

export interface AgendaOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    agenda: {
      /**
       * Insert an agenda node
       */
      insertAgenda: (attrs?: Partial<AgendaAttrs>) => ReturnType;
      /**
       * Update agenda attributes
       */
      updateAgendaAttrs: (agendaId: string, attrs: Partial<Omit<AgendaAttrs, 'id'>>) => ReturnType;
      /**
       * Set agenda date
       */
      setAgendaDate: (agendaId: string, date: string) => ReturnType;
      /**
       * Set agenda summary
       */
      setAgendaSummary: (agendaId: string, summary: string | null) => ReturnType;
      /**
       * Scroll to a specific agenda by ID
       */
      scrollToAgenda: (agendaId: string) => ReturnType;
    };
  }
}

/**
 * Generate a unique ID for agenda items
 */
function generateAgendaId(): string {
  return crypto.randomUUID();
}

/**
 * Get today's date in ISO format (YYYY-MM-DD)
 */
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get relative date text for agenda dates
 * Formats dates as: Today, Tomorrow, Yesterday, weekday name, or "Jan 28" format
 */
export function getRelativeDateText(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (targetDate.getTime() === today.getTime()) {
    return 'Today';
  } else if (targetDate.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  } else if (targetDate.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  } else if (targetDate > today && targetDate < nextWeek) {
    // Within next 7 days - show weekday
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  } else if (date.getFullYear() === now.getFullYear()) {
    // This year - show "Jan 28" format
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    // Other years - show "Jan 28, 2025" format
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Get next day's date from current date
 */
function getNextDayDate(currentDate: string): string {
  const date = new Date(currentDate + 'T00:00:00');
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

/**
 * Insert next day agenda after current one
 */
function insertNextDayAgenda(editor: any, afterPos: number, currentAgenda: any): boolean {
  const nextDateStr = getNextDayDate(currentAgenda.attrs['date']);

  editor
    .chain()
    .insertContentAt(afterPos + currentAgenda.nodeSize, {
      type: 'agenda',
      attrs: {
        id: generateAgendaId(),
        date: nextDateStr,
      },
      content: [{ type: 'paragraph' }],
    })
    .focus()
    .run();

  return true;
}

/**
 * Agenda Node Extension
 * A collapsible container element that associates content with a specific date.
 */
export const Agenda = Node.create<AgendaOptions>({
  name: 'agenda',

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
        parseHTML: (element) => element.getAttribute('data-agenda-id'),
        renderHTML: (attributes) => {
          const id = attributes['id'] || generateAgendaId();
          return { 'data-agenda-id': id };
        },
      },
      date: {
        default: getTodayDate(),
        parseHTML: (element) => element.getAttribute('data-date'),
        renderHTML: (attributes) => {
          return { 'data-date': attributes['date'] };
        },
      },
      time: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-time'),
        renderHTML: (attributes) => {
          if (!attributes['time']) {
            return {};
          }
          return { 'data-time': attributes['time'] };
        },
      },
      summary: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-summary'),
        renderHTML: (attributes) => {
          if (!attributes['summary']) {
            return {};
          }
          return { 'data-summary': attributes['summary'] };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="agenda"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'agenda' }),
      0,
    ];
  },

  addCommands() {
    return {
      insertAgenda:
        (attrs?: Partial<AgendaAttrs>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              id: attrs?.id || generateAgendaId(),
              date: attrs?.date || getTodayDate(),
              time: attrs?.time,
              summary: attrs?.summary,
            },
            content: [{ type: 'paragraph' }],
          });
        },
      updateAgendaAttrs:
        (agendaId: string, attrs: Partial<Omit<AgendaAttrs, 'id'>>) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === agendaId) {
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
      setAgendaDate:
        (agendaId: string, date: string) =>
        ({ commands }) => {
          return commands.updateAgendaAttrs(agendaId, { date });
        },
      setAgendaSummary:
        (agendaId: string, summary: string | null) =>
        ({ commands }) => {
          return commands.updateAgendaAttrs(agendaId, { summary: summary || undefined });
        },
      scrollToAgenda:
        (agendaId: string) =>
        ({ state, view }) => {
          const { doc } = state;
          let targetPos: number | null = null;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === agendaId) {
              targetPos = pos;
              return false;
            }
            return true;
          });

          if (targetPos !== null) {
            const domNode = view.nodeDOM(targetPos);
            if (domNode && domNode instanceof HTMLElement) {
              domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Add highlight class for visual feedback
              domNode.classList.add('agenda-highlight');
              setTimeout(() => {
                domNode.classList.remove('agenda-highlight');
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
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        // Find if we're inside an agenda node
        let agendaNode = null;
        let agendaPos: number | null = null;

        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'agenda') {
            agendaNode = node;
            agendaPos = $from.before(d);
            break;
          }
        }

        if (!agendaNode || agendaPos === null) {
          return false;
        }

        // Check if the agenda is collapsed (via DOM check)
        const domNode = editor.view.nodeDOM(agendaPos) as HTMLElement | null;
        const isCollapsed = domNode?.classList.contains('collapsed');

        if (isCollapsed) {
          // Insert next day agenda after current one
          return insertNextDayAgenda(editor, agendaPos, agendaNode);
        }

        // Check if at end of content and current block is empty paragraph
        const currentNode = $from.parent;
        if (currentNode.type.name === 'paragraph' && currentNode.content.size === 0) {
          // Check if we're at the end of the agenda content
          const agendaEnd = agendaPos + agendaNode.nodeSize;
          const selectionEnd = $from.pos + 1; // +1 to account for paragraph end

          if (selectionEnd >= agendaEnd - 1) {
            // Delete empty paragraph and insert next day agenda
            editor
              .chain()
              .deleteNode('paragraph')
              .insertContentAt(agendaEnd, {
                type: 'agenda',
                attrs: {
                  id: generateAgendaId(),
                  date: getNextDayDate(agendaNode.attrs['date']),
                },
                content: [{ type: 'paragraph' }],
              })
              .focus()
              .run();
            return true;
          }
        }

        return false;
      },
      'Shift-Tab': ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;

        // Find if we're inside an agenda node
        let insideAgenda = false;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === 'agenda') {
            insideAgenda = true;
            break;
          }
        }

        if (!insideAgenda) {
          return false;
        }

        // Check if current block is empty paragraph
        const currentNode = $from.parent;
        if (currentNode.type.name === 'paragraph' && currentNode.content.size === 0) {
          // Delete empty paragraph
          editor.commands.deleteNode('paragraph');
          return true;
        }

        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: new PluginKey('agendaUniqueIds'),
        appendTransaction(transactions, oldState, newState) {
          // Only process if there were actual changes
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }

          const { tr } = newState;
          const seenIds = new Set<string>();
          const nodesToFix: { pos: number; node: any }[] = [];

          // First pass: collect all agenda IDs and find duplicates
          newState.doc.descendants((node, pos) => {
            if (node.type.name === extensionThis.name) {
              const id = node.attrs['id'];
              if (id) {
                if (seenIds.has(id)) {
                  nodesToFix.push({ pos, node });
                } else {
                  seenIds.add(id);
                }
              }
            }
            return true;
          });

          if (nodesToFix.length === 0) {
            return null;
          }

          // Fix duplicate IDs
          nodesToFix.forEach(({ pos, node }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              id: generateAgendaId(),
            });
          });

          return tr;
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      // Ensure the node has an ID
      const nodeId = node.attrs['id'] || generateAgendaId();
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

      // Create the agenda container
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'agenda');
      dom.setAttribute('data-agenda-id', nodeId);
      dom.setAttribute('data-date', node.attrs['date'] || getTodayDate());
      if (node.attrs['summary']) {
        dom.setAttribute('data-summary', node.attrs['summary']);
      }

      // Create header
      const header = document.createElement('div');
      header.classList.add('agenda-header');
      header.contentEditable = 'false';

      // Chevron icon
      const chevron = document.createElement('span');
      chevron.classList.add('material-symbols-rounded', 'agenda-chevron');
      chevron.textContent = 'expand_more';
      header.appendChild(chevron);

      // Date display
      const dateDisplay = document.createElement('span');
      dateDisplay.classList.add('agenda-date');
      dateDisplay.textContent = getRelativeDateText(node.attrs['date']);
      header.appendChild(dateDisplay);

      // Summary separator and text (if exists)
      let summaryContainer: HTMLElement | null = null;
      if (node.attrs['summary']) {
        const separator = document.createElement('span');
        separator.classList.add('agenda-summary-separator');
        separator.textContent = '·';
        header.appendChild(separator);

        summaryContainer = document.createElement('span');
        summaryContainer.classList.add('agenda-summary');
        summaryContainer.textContent = node.attrs['summary'];
        header.appendChild(summaryContainer);
      }

      // AI button (hidden by default, shown when Claude bot is available)
      const aiButton = document.createElement('button');
      aiButton.classList.add('agenda-ai-btn');
      aiButton.type = 'button';
      aiButton.style.display = 'none'; // Hidden by default, shown by component if Claude bot is available
      const aiIcon = document.createElement('span');
      aiIcon.classList.add('material-symbols-rounded');
      aiIcon.textContent = node.attrs['summary'] ? 'refresh' : 'auto_awesome';
      aiButton.appendChild(aiIcon);
      header.appendChild(aiButton);

      // Content area
      const content = document.createElement('div');
      content.classList.add('agenda-content');

      // Assemble
      dom.appendChild(header);
      dom.appendChild(content);

      // Toggle collapse on header click (but not on AI button or date)
      header.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.agenda-ai-btn') || target.closest('.agenda-date')) {
          return;
        }
        dom.classList.toggle('collapsed');
        chevron.textContent = dom.classList.contains('collapsed') ? 'chevron_right' : 'expand_more';
      });

      // Date click - dispatch event for date picker
      dateDisplay.addEventListener('click', (event) => {
        event.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        dom.dispatchEvent(
          new CustomEvent('agenda-date-click', {
            bubbles: true,
            detail: {
              agendaId: nodeId,
              currentDate: node.attrs['date'],
              position: dateDisplay.getBoundingClientRect(),
              pos,
            },
          }),
        );
      });

      // AI button click - dispatch event for AI summary
      aiButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        dom.dispatchEvent(
          new CustomEvent('agenda-ai-click', {
            bubbles: true,
            detail: {
              agendaId: nodeId,
              pos,
              editor,
              getPos,
            },
          }),
        );
      });

      return {
        dom,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          // Verify same node by ID
          const updatedNodeId = updatedNode.attrs['id'];
          if (updatedNodeId && nodeId && updatedNodeId !== nodeId) {
            return false;
          }

          // Update date display
          dom.setAttribute('data-date', updatedNode.attrs['date']);
          dateDisplay.textContent = getRelativeDateText(updatedNode.attrs['date']);

          // Update summary
          if (updatedNode.attrs['summary']) {
            dom.setAttribute('data-summary', updatedNode.attrs['summary']);
            aiIcon.textContent = 'refresh';

            // Add summary elements if not present
            if (!summaryContainer) {
              const separator = document.createElement('span');
              separator.classList.add('agenda-summary-separator');
              separator.textContent = '·';
              header.insertBefore(separator, aiButton);

              summaryContainer = document.createElement('span');
              summaryContainer.classList.add('agenda-summary');
              header.insertBefore(summaryContainer, aiButton);
            }
            summaryContainer.textContent = updatedNode.attrs['summary'];
          } else {
            dom.removeAttribute('data-summary');
            aiIcon.textContent = 'auto_awesome';

            // Remove summary elements if present
            if (summaryContainer) {
              const separator = header.querySelector('.agenda-summary-separator');
              if (separator) separator.remove();
              summaryContainer.remove();
              summaryContainer = null;
            }
          }

          return true;
        },
        stopEvent: (event) => {
          // Don't stop events on the content area
          const target = event.target as HTMLElement;
          return !content.contains(target);
        },
        ignoreMutation: (mutation) => {
          // Ignore mutations on header elements
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
