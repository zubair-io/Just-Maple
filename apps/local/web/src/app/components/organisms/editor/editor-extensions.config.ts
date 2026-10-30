import { Editor, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import DragHandle from '@tiptap/extension-drag-handle';
import {
  CustomDocument,
  EmojiReplacer,
  SlashCommands,
  defaultSlashCommands,
  filterCommands,
  getTableExtensions,
  TableOfContents,
  EnhancedTaskItem,
  EnhancedTaskList,
  ImageNode,
  PageLink,
  PageLinkBlock,
  HashTag,
  MarkdownPaste,
  CodeBlockWithLanguage,
  type SlashCommandItem,
  type PageLinkSuggestion,
} from './extensions';
import type { Observable } from 'rxjs';

export interface EditorExtensionsConfig {
  /** Search pages for [[ link suggestions */
  searchPages: (query: string) => Promise<PageLinkSuggestion[]>;
  /** Navigate to a linked page */
  onLinkClick: (pageId: string) => void;
  /** Get reactive page title */
  getPageTitle$: (pageId: string) => Observable<string>;
  /** Create slash menu renderer */
  createSlashMenuRenderer: () => any;
  /** Create page link suggestion renderer */
  createPageLinkSuggestionRenderer: () => any;
  /** Create hashtag suggestion renderer */
  createHashTagSuggestionRenderer: () => any;
}

/**
 * Build the TipTap extensions array for the markdown editor.
 */
export function buildEditorExtensions(config: EditorExtensionsConfig): AnyExtension[] {
  return [
    CustomDocument,
    StarterKit.configure({
      document: false,
      codeBlock: false,
      trailingNode: { node: 'paragraph' },
    } as any),
    Placeholder.configure({
      placeholder: "Type '/' for commands...",
    }) as any,
    CodeBlockWithLanguage,
    EmojiReplacer,
    MarkdownPaste,
    EnhancedTaskList,
    EnhancedTaskItem.configure({ nested: true }),
    ...getTableExtensions(),
    TableOfContents,
    ImageNode,
    PageLink.configure({
      searchPages: config.searchPages,
      onLinkClick: config.onLinkClick,
      getPageTitle$: config.getPageTitle$,
      suggestion: {
        render: () => config.createPageLinkSuggestionRenderer(),
      },
    }),
    PageLinkBlock.configure({
      onLinkClick: config.onLinkClick,
      getPageTitle$: config.getPageTitle$,
    }),
    HashTag.configure({
      getTags: () => [],
      getTagColor: (_tag: string): string | null => null,
      onTagClick: () => {},
      suggestion: {
        render: () => config.createHashTagSuggestionRenderer(),
      },
    }),
    DragHandle.configure({
      render: () => {
        const handle = document.createElement('div');
        handle.classList.add('drag-handle');
        handle.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                        <circle cx="4" cy="3" r="1.5"/>
                        <circle cx="10" cy="3" r="1.5"/>
                        <circle cx="4" cy="7" r="1.5"/>
                        <circle cx="10" cy="7" r="1.5"/>
                        <circle cx="4" cy="11" r="1.5"/>
                        <circle cx="10" cy="11" r="1.5"/>
                    </svg>
                `;
        return handle;
      },
    }),
    SlashCommands.configure({
      suggestion: {
        items: ({ query }: { query: string }) => filterCommands(defaultSlashCommands, query),
        render: () => config.createSlashMenuRenderer(),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: any;
          props: SlashCommandItem;
        }) => {
          props.command({ editor, range });
        },
      },
    }),
  ];
}
