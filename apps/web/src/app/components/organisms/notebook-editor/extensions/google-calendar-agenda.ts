import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { GoogleCalendarEvent, GoogleCalendarEntry } from '@maple/shared';

export interface GoogleCalendarAgendaAttrs {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  calendarId: string | null;
  calendarName: string | null;
  collapsed: boolean;
  collapsedDays: string; // JSON array of collapsed date strings
}

export interface GoogleCalendarAgendaOptions {
  HTMLAttributes: Record<string, unknown>;
  getCalendarList: () => Promise<GoogleCalendarEntry[]>;
  getEvents: (
    calendarId: string,
    startDate: string,
    endDate: string,
  ) => Promise<GoogleCalendarEvent[]>;
  isConnected: () => boolean;
  onConnect: () => void;
  onRefresh: () => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    googleCalendarAgenda: {
      insertGoogleCalendarAgenda: (attrs?: Partial<GoogleCalendarAgendaAttrs>) => ReturnType;
      updateGoogleCalendarAgendaAttrs: (
        agendaId: string,
        attrs: Partial<Omit<GoogleCalendarAgendaAttrs, 'id'>>,
      ) => ReturnType;
      toggleGoogleCalendarAgendaCollapsed: (agendaId: string) => ReturnType;
    };
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

/**
 * Get all dates between start and end (inclusive).
 */
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Format a date for day row display.
 */
function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  let label = '';
  if (targetDate.getTime() === today.getTime()) {
    label = 'Today';
  } else if (targetDate.getTime() === tomorrow.getTime()) {
    label = 'Tomorrow';
  } else if (targetDate.getTime() === yesterday.getTime()) {
    label = 'Yesterday';
  } else {
    label = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  return label;
}

/**
 * Format event time for display.
 */
function formatEventTime(event: GoogleCalendarEvent): string {
  if (event.start.date) {
    return 'All day';
  }
  if (event.start.dateTime) {
    const start = new Date(event.start.dateTime);
    const end = event.end.dateTime ? new Date(event.end.dateTime) : null;

    const startStr = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    if (end) {
      const endStr = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `${startStr} – ${endStr}`;
    }

    return startStr;
  }
  return '';
}

/**
 * Get the date string (YYYY-MM-DD) that an event belongs to.
 */
function getEventDate(event: GoogleCalendarEvent): string {
  if (event.start.date) {
    return event.start.date;
  }
  if (event.start.dateTime) {
    return event.start.dateTime.split('T')[0];
  }
  return '';
}

/**
 * Group events by date.
 */
function groupEventsByDate(
  events: GoogleCalendarEvent[],
  dates: string[],
): Map<string, GoogleCalendarEvent[]> {
  const grouped = new Map<string, GoogleCalendarEvent[]>();

  // Initialize all dates with empty arrays
  for (const date of dates) {
    grouped.set(date, []);
  }

  // Assign events to their dates
  for (const event of events) {
    const eventDate = getEventDate(event);

    // For multi-day all-day events, add to each day in range
    if (event.start.date && event.end.date) {
      const eventStart = event.start.date;
      const eventEnd = event.end.date;
      for (const date of dates) {
        if (date >= eventStart && date < eventEnd) {
          const dayEvents = grouped.get(date) || [];
          dayEvents.push(event);
          grouped.set(date, dayEvents);
        }
      }
    } else if (grouped.has(eventDate)) {
      const dayEvents = grouped.get(eventDate)!;
      dayEvents.push(event);
    }
  }

  return grouped;
}

/**
 * Google Calendar Agenda TipTap Extension.
 * Renders a collapsible calendar view with day-by-day event listing.
 */
export const GoogleCalendarAgenda = Node.create<GoogleCalendarAgendaOptions>({
  name: 'googleCalendarAgenda',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      getCalendarList: async () => [],
      getEvents: async () => [],
      isConnected: () => false,
      onConnect: () => {},
      onRefresh: () => {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-gcal-id'),
        renderHTML: (attributes) => ({
          'data-gcal-id': attributes['id'] || generateId(),
        }),
      },
      title: {
        default: 'Google Calendar',
        parseHTML: (element) => element.getAttribute('data-gcal-title'),
        renderHTML: (attributes) => ({
          'data-gcal-title': attributes['title'],
        }),
      },
      startDate: {
        default: getTodayDate(),
        parseHTML: (element) => element.getAttribute('data-gcal-start'),
        renderHTML: (attributes) => ({
          'data-gcal-start': attributes['startDate'],
        }),
      },
      endDate: {
        default: getDefaultEndDate(),
        parseHTML: (element) => element.getAttribute('data-gcal-end'),
        renderHTML: (attributes) => ({
          'data-gcal-end': attributes['endDate'],
        }),
      },
      calendarId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-gcal-calendar-id'),
        renderHTML: (attributes) => {
          if (!attributes['calendarId']) return {};
          return { 'data-gcal-calendar-id': attributes['calendarId'] };
        },
      },
      calendarName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-gcal-calendar-name'),
        renderHTML: (attributes) => {
          if (!attributes['calendarName']) return {};
          return { 'data-gcal-calendar-name': attributes['calendarName'] };
        },
      },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => {
          if (!attributes['collapsed']) return {};
          return { 'data-collapsed': 'true' };
        },
      },
      collapsedDays: {
        default: '[]',
        parseHTML: (element) => element.getAttribute('data-gcal-collapsed-days') || '[]',
        renderHTML: (attributes) => {
          if (attributes['collapsedDays'] === '[]') return {};
          return { 'data-gcal-collapsed-days': attributes['collapsedDays'] };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="google-calendar-agenda"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'google-calendar-agenda',
      }),
    ];
  },

  addCommands() {
    return {
      insertGoogleCalendarAgenda:
        (attrs?: Partial<GoogleCalendarAgendaAttrs>) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              id: attrs?.id || generateId(),
              title: attrs?.title || 'Google Calendar',
              startDate: attrs?.startDate || getTodayDate(),
              endDate: attrs?.endDate || getDefaultEndDate(),
              calendarId: attrs?.calendarId || null,
              calendarName: attrs?.calendarName || null,
            },
          });
        },
      updateGoogleCalendarAgendaAttrs:
        (agendaId: string, attrs: Partial<Omit<GoogleCalendarAgendaAttrs, 'id'>>) =>
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
      toggleGoogleCalendarAgendaCollapsed:
        (agendaId: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['id'] === agendaId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                collapsed: !node.attrs['collapsed'],
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

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: new PluginKey('googleCalendarAgendaUniqueIds'),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const { tr } = newState;
          const seenIds = new Set<string>();
          const nodesToFix: { pos: number; node: any }[] = [];

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

          if (nodesToFix.length === 0) return null;

          nodesToFix.forEach(({ pos, node }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              id: generateId(),
            });
          });

          return tr;
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      const options = this.options;
      let node = initialNode;
      const nodeId = node.attrs['id'] || generateId();

      // Ensure node has an ID
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

      // ── DOM Structure ──────────────────────────────────────────

      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'google-calendar-agenda');
      dom.setAttribute('data-gcal-id', nodeId);
      dom.classList.add('gcal-agenda');

      // Main header
      const header = document.createElement('div');
      header.classList.add('gcal-agenda-header');
      header.contentEditable = 'false';

      // Chevron
      const chevron = document.createElement('span');
      chevron.classList.add('material-symbols-rounded', 'gcal-agenda-chevron');
      chevron.textContent = node.attrs['collapsed'] ? 'chevron_right' : 'expand_more';
      header.appendChild(chevron);

      // Calendar icon
      const calIcon = document.createElement('span');
      calIcon.classList.add('material-symbols-rounded', 'gcal-agenda-icon');
      calIcon.textContent = 'calendar_month';
      header.appendChild(calIcon);

      // Title (editable)
      const titleEl = document.createElement('span');
      titleEl.classList.add('gcal-agenda-title');
      titleEl.textContent = node.attrs['title'] || 'Google Calendar';
      titleEl.contentEditable = 'true';
      titleEl.spellcheck = false;
      titleEl.addEventListener('blur', () => {
        const newTitle = titleEl.textContent?.trim() || 'Google Calendar';
        if (newTitle !== node.attrs['title']) {
          (editor.commands as any).updateGoogleCalendarAgendaAttrs(nodeId, {
            title: newTitle,
          });
        }
      });
      titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          titleEl.blur();
        }
      });
      header.appendChild(titleEl);

      // Spacer
      const spacer = document.createElement('span');
      spacer.classList.add('gcal-agenda-spacer');
      header.appendChild(spacer);

      // Date range display
      const dateRangeEl = document.createElement('span');
      dateRangeEl.classList.add('gcal-agenda-date-range');
      dateRangeEl.textContent = formatDateRange(node.attrs['startDate'], node.attrs['endDate']);
      header.appendChild(dateRangeEl);

      // Refresh button
      const refreshBtn = document.createElement('button');
      refreshBtn.classList.add('gcal-agenda-btn');
      refreshBtn.type = 'button';
      refreshBtn.title = 'Refresh events';
      const refreshIcon = document.createElement('span');
      refreshIcon.classList.add('material-symbols-rounded');
      refreshIcon.textContent = 'refresh';
      refreshBtn.appendChild(refreshIcon);
      header.appendChild(refreshBtn);

      // Settings button
      const settingsBtn = document.createElement('button');
      settingsBtn.classList.add('gcal-agenda-btn');
      settingsBtn.type = 'button';
      settingsBtn.title = 'Settings';
      const settingsIcon = document.createElement('span');
      settingsIcon.classList.add('material-symbols-rounded');
      settingsIcon.textContent = 'settings';
      settingsBtn.appendChild(settingsIcon);
      header.appendChild(settingsBtn);

      dom.appendChild(header);

      // Content area (holds the settings panel and days)
      const content = document.createElement('div');
      content.classList.add('gcal-agenda-content');
      content.contentEditable = 'false';
      if (node.attrs['collapsed']) {
        content.style.display = 'none';
      }
      dom.appendChild(content);

      // Settings panel (hidden by default)
      const settingsPanel = document.createElement('div');
      settingsPanel.classList.add('gcal-agenda-settings');
      settingsPanel.style.display = 'none';
      content.appendChild(settingsPanel);

      // Days container
      const daysContainer = document.createElement('div');
      daysContainer.classList.add('gcal-agenda-days');
      content.appendChild(daysContainer);

      // ── State ──────────────────────────────────────────────────

      let collapsedDays: Set<string> = new Set(JSON.parse(node.attrs['collapsedDays'] || '[]'));
      let settingsVisible = false;
      let currentEvents: GoogleCalendarEvent[] = [];

      // ── Settings Panel Build ────────────────────────────────────

      function buildSettingsPanel(): void {
        settingsPanel.innerHTML = '';

        // Date range row
        const dateRow = document.createElement('div');
        dateRow.classList.add('gcal-settings-row');

        const dateLabel = document.createElement('label');
        dateLabel.textContent = 'Date range';
        dateLabel.classList.add('gcal-settings-label');
        dateRow.appendChild(dateLabel);

        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.value = node.attrs['startDate'];
        startInput.classList.add('gcal-settings-input');
        startInput.addEventListener('change', () => {
          (editor.commands as any).updateGoogleCalendarAgendaAttrs(nodeId, {
            startDate: startInput.value,
          });
        });
        dateRow.appendChild(startInput);

        const toSpan = document.createElement('span');
        toSpan.textContent = 'to';
        toSpan.classList.add('gcal-settings-separator');
        dateRow.appendChild(toSpan);

        const endInput = document.createElement('input');
        endInput.type = 'date';
        endInput.value = node.attrs['endDate'];
        endInput.classList.add('gcal-settings-input');
        endInput.addEventListener('change', () => {
          (editor.commands as any).updateGoogleCalendarAgendaAttrs(nodeId, {
            endDate: endInput.value,
          });
        });
        dateRow.appendChild(endInput);

        settingsPanel.appendChild(dateRow);

        // Calendar selection row
        const calRow = document.createElement('div');
        calRow.classList.add('gcal-settings-row');

        const calLabel = document.createElement('label');
        calLabel.textContent = 'Calendar';
        calLabel.classList.add('gcal-settings-label');
        calRow.appendChild(calLabel);

        if (!options.isConnected()) {
          const connectBtn = document.createElement('button');
          connectBtn.classList.add('gcal-connect-btn');
          connectBtn.textContent = 'Connect Google Calendar';
          connectBtn.addEventListener('click', () => {
            options.onConnect();
          });
          calRow.appendChild(connectBtn);
        } else {
          const calSelect = document.createElement('select');
          calSelect.classList.add('gcal-settings-select');

          const defaultOpt = document.createElement('option');
          defaultOpt.value = '';
          defaultOpt.textContent = 'Loading calendars...';
          calSelect.appendChild(defaultOpt);

          calRow.appendChild(calSelect);

          // Fetch calendars
          options.getCalendarList().then((calendars) => {
            calSelect.innerHTML = '';

            if (calendars.length === 0) {
              const noOpt = document.createElement('option');
              noOpt.value = '';
              noOpt.textContent = 'No calendars found';
              calSelect.appendChild(noOpt);
              return;
            }

            const placeholderOpt = document.createElement('option');
            placeholderOpt.value = '';
            placeholderOpt.textContent = 'Select a calendar...';
            calSelect.appendChild(placeholderOpt);

            for (const cal of calendars) {
              const opt = document.createElement('option');
              opt.value = cal.id;
              opt.textContent = cal.summary;
              if (cal.id === node.attrs['calendarId']) {
                opt.selected = true;
              }
              calSelect.appendChild(opt);
            }
          });

          calSelect.addEventListener('change', () => {
            const selectedOption = calSelect.options[calSelect.selectedIndex];
            (editor.commands as any).updateGoogleCalendarAgendaAttrs(nodeId, {
              calendarId: calSelect.value || null,
              calendarName: calSelect.value ? selectedOption?.textContent || null : null,
            });
          });
        }

        settingsPanel.appendChild(calRow);
      }

      // ── Render Days ─────────────────────────────────────────────

      function renderDays(): void {
        daysContainer.innerHTML = '';

        const startDate = node.attrs['startDate'];
        const endDate = node.attrs['endDate'];
        const dates = getDateRange(startDate, endDate);
        const grouped = groupEventsByDate(currentEvents, dates);

        if (!options.isConnected()) {
          const connectMsg = document.createElement('div');
          connectMsg.classList.add('gcal-agenda-empty');
          const connectBtn = document.createElement('button');
          connectBtn.classList.add('gcal-connect-btn');
          connectBtn.textContent = 'Connect Google Calendar';
          connectBtn.addEventListener('click', () => {
            options.onConnect();
          });
          connectMsg.appendChild(connectBtn);
          daysContainer.appendChild(connectMsg);
          return;
        }

        if (!node.attrs['calendarId']) {
          const emptyMsg = document.createElement('div');
          emptyMsg.classList.add('gcal-agenda-empty');
          emptyMsg.textContent = 'Select a calendar in settings to view events.';
          daysContainer.appendChild(emptyMsg);
          return;
        }

        for (const date of dates) {
          const dayEvents = grouped.get(date) || [];
          const isDayCollapsed = collapsedDays.has(date);

          // Day row
          const dayRow = document.createElement('div');
          dayRow.classList.add('gcal-day');
          if (isDayCollapsed) {
            dayRow.classList.add('gcal-day-collapsed');
          }

          // Day header
          const dayHeader = document.createElement('div');
          dayHeader.classList.add('gcal-day-header');

          const dayChevron = document.createElement('span');
          dayChevron.classList.add('material-symbols-rounded', 'gcal-day-chevron');
          dayChevron.textContent = isDayCollapsed ? 'chevron_right' : 'expand_more';
          dayHeader.appendChild(dayChevron);

          const dayLabel = document.createElement('span');
          dayLabel.classList.add('gcal-day-label');
          dayLabel.textContent = formatDayLabel(date);
          dayHeader.appendChild(dayLabel);

          const dayDate = document.createElement('span');
          dayDate.classList.add('gcal-day-date');
          const dateObj = new Date(date + 'T00:00:00');
          dayDate.textContent = dateObj.toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
          });
          dayHeader.appendChild(dayDate);

          const eventCount = document.createElement('span');
          eventCount.classList.add('gcal-day-count');
          eventCount.textContent =
            dayEvents.length > 0
              ? `${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''}`
              : '';
          dayHeader.appendChild(eventCount);

          // Toggle day collapse
          dayHeader.addEventListener('click', () => {
            if (collapsedDays.has(date)) {
              collapsedDays.delete(date);
            } else {
              collapsedDays.add(date);
            }

            (editor.commands as any).updateGoogleCalendarAgendaAttrs(nodeId, {
              collapsedDays: JSON.stringify([...collapsedDays]),
            });
          });

          dayRow.appendChild(dayHeader);

          // Events container
          if (!isDayCollapsed) {
            const eventsContainer = document.createElement('div');
            eventsContainer.classList.add('gcal-day-events');

            if (dayEvents.length === 0) {
              const noEvents = document.createElement('div');
              noEvents.classList.add('gcal-event-empty');
              noEvents.textContent = 'No events';
              eventsContainer.appendChild(noEvents);
            } else {
              for (const event of dayEvents) {
                const eventEl = document.createElement('div');
                eventEl.classList.add('gcal-event');

                const eventDot = document.createElement('span');
                eventDot.classList.add('gcal-event-dot');
                eventEl.appendChild(eventDot);

                const eventTime = document.createElement('span');
                eventTime.classList.add('gcal-event-time');
                eventTime.textContent = formatEventTime(event);
                eventEl.appendChild(eventTime);

                const eventTitle = document.createElement('span');
                eventTitle.classList.add('gcal-event-title');
                eventTitle.textContent = event.summary || '(No title)';
                eventEl.appendChild(eventTitle);

                if (event.location) {
                  const eventLocation = document.createElement('span');
                  eventLocation.classList.add('gcal-event-location');
                  eventLocation.textContent = event.location;
                  eventEl.appendChild(eventLocation);
                }

                // Open in Google Calendar on click
                if (event.htmlLink) {
                  eventEl.style.cursor = 'pointer';
                  eventEl.addEventListener('click', () => {
                    window.open(event.htmlLink, '_blank');
                  });
                }

                eventsContainer.appendChild(eventEl);
              }
            }

            dayRow.appendChild(eventsContainer);
          }

          daysContainer.appendChild(dayRow);
        }
      }

      // ── Event Handlers ──────────────────────────────────────────

      // Toggle main collapse
      header.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('.gcal-agenda-btn') ||
          target.closest('.gcal-agenda-title') ||
          target.closest('.gcal-agenda-date-range')
        ) {
          return;
        }
        (editor.commands as any).toggleGoogleCalendarAgendaCollapsed(nodeId);
      });

      // Refresh
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onRefresh();
        loadEvents();
      });

      // Toggle settings
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsVisible = !settingsVisible;
        settingsPanel.style.display = settingsVisible ? '' : 'none';
        if (settingsVisible) {
          buildSettingsPanel();
        }
      });

      // ── Load Events ─────────────────────────────────────────────

      async function loadEvents(): Promise<void> {
        const calendarId = node.attrs['calendarId'];
        if (!calendarId || !options.isConnected()) {
          currentEvents = [];
          renderDays();
          return;
        }

        // Show loading state
        daysContainer.innerHTML = '';
        const loading = document.createElement('div');
        loading.classList.add('gcal-agenda-loading');
        loading.textContent = 'Loading events...';
        daysContainer.appendChild(loading);

        try {
          currentEvents = await options.getEvents(
            calendarId,
            node.attrs['startDate'],
            node.attrs['endDate'],
          );
          renderDays();
        } catch (err) {
          daysContainer.innerHTML = '';
          const errorEl = document.createElement('div');
          errorEl.classList.add('gcal-agenda-error');
          errorEl.textContent = err instanceof Error ? err.message : 'Failed to load events';
          daysContainer.appendChild(errorEl);
        }
      }

      // Initial load
      loadEvents();

      // ── Return NodeView ─────────────────────────────────────────

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;

          const updatedId = updatedNode.attrs['id'];
          if (updatedId && nodeId && updatedId !== nodeId) return false;

          const prevNode = node;
          node = updatedNode;

          // Update collapsed state
          const isCollapsed = !!updatedNode.attrs['collapsed'];
          chevron.textContent = isCollapsed ? 'chevron_right' : 'expand_more';
          content.style.display = isCollapsed ? 'none' : '';

          if (isCollapsed) {
            dom.setAttribute('data-collapsed', 'true');
          } else {
            dom.removeAttribute('data-collapsed');
          }

          // Update title
          if (titleEl.textContent !== updatedNode.attrs['title']) {
            titleEl.textContent = updatedNode.attrs['title'] || 'Google Calendar';
          }

          // Update date range display
          dateRangeEl.textContent = formatDateRange(
            updatedNode.attrs['startDate'],
            updatedNode.attrs['endDate'],
          );

          // Update collapsed days
          collapsedDays = new Set(JSON.parse(updatedNode.attrs['collapsedDays'] || '[]'));

          // Re-fetch events if calendar or date range changed
          if (
            prevNode.attrs['calendarId'] !== updatedNode.attrs['calendarId'] ||
            prevNode.attrs['startDate'] !== updatedNode.attrs['startDate'] ||
            prevNode.attrs['endDate'] !== updatedNode.attrs['endDate']
          ) {
            loadEvents();
          } else {
            // Just re-render days (for collapse state changes)
            renderDays();
          }

          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
      };
    };
  },
});

/**
 * Format a date range for display in the header.
 */
function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (start.getFullYear() !== end.getFullYear()) {
    const startFull = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const endFull = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startFull} – ${endFull}`;
  }

  return `${startStr} – ${endStr}`;
}
