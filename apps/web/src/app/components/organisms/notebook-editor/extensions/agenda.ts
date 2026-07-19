import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

export interface AgendaAttrs {
  id: string;
  date: string; // ISO date (YYYY-MM-DD)
  time?: string; // Optional HH:mm (future use)
  summary?: string; // AI-generated or user-edited summary
  collapsed?: boolean; // Whether the agenda is collapsed
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
       * Toggle agenda collapsed state
       */
      toggleAgendaCollapsed: (agendaId: string) => ReturnType;
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
 * Format a Date as a local-calendar YYYY-MM-DD string. All parsing in this file
 * uses `dateStr + 'T00:00:00'` (local midnight), so dates must be produced from
 * local components too; toISOString() is UTC and drifts a day for non-UTC zones.
 */
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date in ISO format (YYYY-MM-DD)
 */
function getTodayDate(): string {
  return formatLocalDate(new Date());
}

/**
 * Get relative date text for agenda dates
 * Formats dates as: Today, Tomorrow, Yesterday, weekday name, or "Tue, Jan 28" format
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
    // This year - show "Tue, Jan 28" format
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } else {
    // Other years - show "Tue, Jan 28, 2025" format
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

/**
 * Get next day's date from current date
 */
function getNextDayDate(currentDate: string): string {
  const date = new Date(currentDate + 'T00:00:00');
  date.setDate(date.getDate() + 1);
  return formatLocalDate(date);
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
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => {
          if (!attributes['collapsed']) {
            return {};
          }
          return { 'data-collapsed': 'true' };
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
      toggleAgendaCollapsed:
        (agendaId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === agendaId) {
              const newCollapsed = !node.attrs['collapsed'];
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                collapsed: newCollapsed,
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
            // Get the position of the empty paragraph to delete
            const paragraphPos = $from.before($from.depth);

            // Use a single transaction to avoid position issues
            const { tr } = editor.state;

            // First, insert the new agenda at the end of the current one
            const newAgendaContent = editor.state.schema.nodes['agenda'].create(
              {
                id: generateAgendaId(),
                date: getNextDayDate(agendaNode.attrs['date']),
              },
              editor.state.schema.nodes['paragraph'].create(),
            );

            // Insert after the agenda
            tr.insert(agendaEnd, newAgendaContent);

            // Delete the empty paragraph (position is still valid since we inserted AFTER it)
            tr.delete(paragraphPos, paragraphPos + currentNode.nodeSize);

            // Set cursor inside the new agenda's paragraph
            // After deletion, positions shift. The new agenda starts at agendaEnd - currentNode.nodeSize
            const newAgendaStart = agendaEnd - currentNode.nodeSize;
            // Position inside the paragraph: newAgendaStart + 1 (agenda open) + 1 (paragraph open)
            const cursorPos = tr.doc.resolve(newAgendaStart + 2);
            tr.setSelection(TextSelection.near(cursorPos));

            editor.view.dispatch(tr);
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
    return ({ node: initialNode, getPos, editor }) => {
      // Track current node (updated in update callback)
      let node = initialNode;

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
      // Set initial collapsed state
      if (node.attrs['collapsed']) {
        dom.setAttribute('data-collapsed', 'true');
      }

      // Create header
      const header = document.createElement('div');
      header.classList.add('agenda-header');
      header.contentEditable = 'false';

      // Chevron icon
      const chevron = document.createElement('span');
      chevron.classList.add('material-symbols-rounded', 'agenda-chevron');
      chevron.textContent = node.attrs['collapsed'] ? 'chevron_right' : 'expand_more';
      header.appendChild(chevron);

      // Date display
      const dateDisplay = document.createElement('span');
      dateDisplay.classList.add('agenda-date');
      dateDisplay.textContent = getRelativeDateText(node.attrs['date']);
      header.appendChild(dateDisplay);

      // Summary/preview separator and text
      let separatorElement: HTMLElement | null = null;
      let summaryContainer: HTMLElement | null = null;

      // Helper to extract preview text from node content
      const getContentPreview = (): string => {
        let preview = '';
        node.content.forEach((child) => {
          if (preview.length < 100) {
            // Use textContent but also handle inline mentions by calling their renderText
            const text = child.textContent || '';
            preview += text + ' ';
          }
        });
        return preview.trim().slice(0, 100) || '';
      };

      // Helper to update summary/preview display
      const updateSummaryDisplay = (summaryText: string | null, showPreview: boolean) => {
        const displayText = summaryText || (showPreview ? getContentPreview() : '');

        if (displayText) {
          if (!separatorElement) {
            separatorElement = document.createElement('span');
            separatorElement.classList.add('agenda-summary-separator');
            separatorElement.textContent = '·';
            header.insertBefore(separatorElement, aiButton);
          }
          if (!summaryContainer) {
            summaryContainer = document.createElement('span');
            summaryContainer.classList.add('agenda-summary');
            header.insertBefore(summaryContainer, aiButton);
          }
          summaryContainer.textContent = displayText;
          separatorElement.style.display = '';
          summaryContainer.style.display = '';
        } else {
          if (separatorElement) separatorElement.style.display = 'none';
          if (summaryContainer) summaryContainer.style.display = 'none';
        }
      };

      // AI button (hidden by default, shown when Claude bot is available)
      // Created first so updateSummaryDisplay can insert before it
      const aiButton = document.createElement('button');
      aiButton.classList.add('agenda-ai-btn');
      aiButton.type = 'button';
      aiButton.style.display = 'none'; // Hidden by default, shown by component if Claude bot is available
      const aiIcon = document.createElement('span');
      aiIcon.classList.add('material-symbols-rounded');
      aiIcon.textContent = node.attrs['summary'] ? 'refresh' : 'auto_awesome';
      aiButton.appendChild(aiIcon);
      header.appendChild(aiButton);

      // Initial summary/preview setup
      if (node.attrs['summary']) {
        // Show summary
        updateSummaryDisplay(node.attrs['summary'], false);
      } else if (node.attrs['collapsed']) {
        // Show content preview if collapsed with no summary
        updateSummaryDisplay(null, true);
      }

      // Content area
      const content = document.createElement('div');
      content.classList.add('agenda-content');
      // Hide content if collapsed
      if (node.attrs['collapsed']) {
        content.style.display = 'none';
      }

      // Assemble
      dom.appendChild(header);
      dom.appendChild(content);

      // Toggle collapse on header click (but not on AI button or date)
      header.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.agenda-ai-btn') || target.closest('.agenda-date')) {
          return;
        }
        // Use command to toggle collapsed state (persisted in document)
        (editor.commands as any).toggleAgendaCollapsed(nodeId);
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

          // Update node reference for content preview
          node = updatedNode;

          // Update date display
          dom.setAttribute('data-date', updatedNode.attrs['date']);
          dateDisplay.textContent = getRelativeDateText(updatedNode.attrs['date']);

          // Update collapsed state
          const isCollapsed = !!updatedNode.attrs['collapsed'];
          if (isCollapsed) {
            dom.setAttribute('data-collapsed', 'true');
          } else {
            dom.removeAttribute('data-collapsed');
          }
          chevron.textContent = isCollapsed ? 'chevron_right' : 'expand_more';
          content.style.display = isCollapsed ? 'none' : '';

          // Update summary/preview
          if (updatedNode.attrs['summary']) {
            dom.setAttribute('data-summary', updatedNode.attrs['summary']);
            aiIcon.textContent = 'refresh';
            updateSummaryDisplay(updatedNode.attrs['summary'], false);
          } else {
            dom.removeAttribute('data-summary');
            aiIcon.textContent = 'auto_awesome';
            // Show preview if collapsed, hide if expanded
            updateSummaryDisplay(null, isCollapsed);
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
