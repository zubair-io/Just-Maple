import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

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
    title: 'Agenda',
    description: 'Add a date-based section',
    icon: '📅',
    command: ({ editor, range }) => {
      (editor.chain().focus().deleteRange(range) as any).insertAgenda().run();
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
    title: 'Claude',
    description: 'AI assistant for document editing',
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
