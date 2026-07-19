import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { getCurrentTime, getCurrentDate } from './inline-mention';

/**
 * Slash command item definition
 */
export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

/**
 * Default slash commands
 */
export const defaultSlashCommands: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Create a simple bullet list',
    icon: '•',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Create a numbered list',
    icon: '1.',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleOrderedList().run();
    },
  },
  {
    title: 'To-do List',
    description: 'Track tasks with checkboxes',
    icon: '☑',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleTaskList().run();
    },
  },
  {
    title: 'To-do Box',
    description: 'Named todo list with status tracking',
    icon: '📋',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).insertTodoBox().run();
    },
  },
  {
    title: 'Quote',
    description: 'Capture a quote',
    icon: '"',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleBlockquote().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Add a code snippet',
    icon: '</>',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleCodeBlock().run();
    },
  },
  {
    title: 'Inline Code',
    description: 'Mark text as code',
    icon: '`',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).toggleCode().run();
    },
  },
  {
    title: 'API Block',
    description: 'Interactive API endpoint tester',
    icon: '{}',
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setCodeBlock({ language: 'api' })
        .insertContent('path: /api/v1/resource\nmethod: GET\nserver: http://localhost:3000')
        .run();
    },
  },
  {
    title: 'Toggle',
    description: 'Collapsible toggle block',
    icon: '▸',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).setDetails().run();
    },
  },
  {
    title: 'Divider',
    description: 'Visual divider line',
    icon: '—',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).setHorizontalRule().run();
    },
  },
  {
    title: 'Table',
    description: 'Insert a table',
    icon: '▦',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any)
        .insertTable({
          rows: 3,
          cols: 3,
          withHeaderRow: true,
        })
        .run();
    },
  },
  {
    title: 'Table of Contents',
    description: 'Auto-generated navigation',
    icon: '☰',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).insertTableOfContents().run();
    },
  },
  {
    title: 'Date',
    description: 'Insert current date',
    icon: '📅',
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: 'inlineMention',
            attrs: { type: 'date', value: getCurrentDate() },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
  },
  {
    title: 'Time',
    description: 'Insert current time',
    icon: '🕐',
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: 'inlineMention',
            attrs: { type: 'time', value: getCurrentTime() },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
  },
  {
    title: 'Agenda',
    description: 'Add a date-based section',
    icon: '📆',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).insertAgenda().run();
    },
  },
  {
    title: 'Google Calendar',
    description: 'Show events from Google Calendar',
    icon: '📆',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).insertGoogleCalendarAgenda().run();
    },
  },
  {
    title: 'Voice Recording',
    description: 'Record audio with your microphone',
    icon: '🎙️',
    command: ({ editor, range }) => {
      // Dispatch event with range info so the handler can delete and insert atomically
      editor.view.dom.dispatchEvent(
        new CustomEvent('create-recording-embed', {
          bubbles: true,
          detail: { range },
        }),
      );
    },
  },
  {
    title: 'Whiteboard',
    description: 'Draw and sketch ideas',
    icon: '🎨',
    command: ({ editor, range }) => {
      // Dispatch event with range info so the handler can delete and insert atomically
      editor.view.dom.dispatchEvent(
        new CustomEvent('create-whiteboard-embed', {
          bubbles: true,
          detail: { range },
        }),
      );
    },
  },
  {
    title: 'Image',
    description: 'Upload an image',
    icon: '🖼️',
    command: ({ editor, range }) => {
      // Dispatch event with range info so the handler can delete and insert atomically
      editor.view.dom.dispatchEvent(
        new CustomEvent('upload-image', {
          bubbles: true,
          detail: { range },
        }),
      );
    },
  },
  {
    title: 'Claude Widget',
    description: 'AI assistant widget for document editing',
    icon: '🤖',
    command: ({ editor, range }) => {
      // Delete the slash command text and insert AI bot widget
      editor.chain().focus().deleteRange(range).run();
      // Dispatch event to insert AI bot widget
      editor.view.dom.dispatchEvent(
        new CustomEvent('create-ai-bot-widget', {
          bubbles: true,
          detail: { range },
        }),
      );
    },
  },
  {
    title: 'Page Link',
    description: 'Link to another page',
    icon: '🔗',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Dispatch event to open page link search
      editor.view.dom.dispatchEvent(
        new CustomEvent('open-page-link-search', {
          bubbles: true,
          detail: { range, mode: 'inline' },
        }),
      );
    },
  },
  {
    title: 'Page Embed',
    description: 'Embed a page with preview',
    icon: '📎',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Dispatch event to open page link search for embed
      editor.view.dom.dispatchEvent(
        new CustomEvent('open-page-link-search', {
          bubbles: true,
          detail: { range, mode: 'block' },
        }),
      );
    },
  },
  {
    title: 'New Page',
    description: 'Create a new page and link to it',
    icon: '📄+',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Dispatch event to create new page and auto-link
      editor.view.dom.dispatchEvent(
        new CustomEvent('create-new-page-link', {
          bubbles: true,
          detail: { range },
        }),
      );
    },
  },
  {
    title: 'Tag',
    description: 'Add a hashtag for organization',
    icon: '#',
    command: ({ editor, range }) => {
      // Delete the slash command and insert # to trigger hashtag suggestions
      editor.chain().focus().deleteRange(range).insertContent('#').run();
    },
  },
  {
    title: 'JSON Reference',
    description: 'Insert a live value from a JSON page',
    icon: '{ }',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      editor.view.dom.dispatchEvent(
        new CustomEvent('insert-json-ref', {
          bubbles: true,
          detail: { range },
        }),
      );
    },
  },
  {
    title: 'JSON Table',
    description: 'Display JSON array data as a table or list',
    icon: '[ ]',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      editor.view.dom.dispatchEvent(
        new CustomEvent('insert-json-loop', {
          bubbles: true,
          detail: { range, renderAs: 'table' },
        }),
      );
    },
  },
];

export interface SlashCommandsOptions {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, 'editor'>;
}

/**
 * Slash Commands Extension
 * Enables Notion-like "/" menu for inserting blocks
 */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

/**
 * Filter commands by query
 */
export function filterCommands(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  return items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
}
