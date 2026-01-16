import { Node, mergeAttributes, type Editor } from '@tiptap/core';

export interface TocItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

/**
 * Extract table of contents items from the editor
 */
export function extractTocItems(editor: Editor): TocItem[] {
  const items: TocItem[] = [];
  const doc = editor.state.doc;

  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const id = `heading-${pos}`;
      items.push({
        id,
        level: node.attrs['level'] as number,
        text: node.textContent,
        pos,
      });
    }
  });

  return items;
}

export interface TableOfContentsOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

/**
 * Table of Contents Node Extension
 * Renders a navigable list of headings in the document
 */
export const TableOfContents = Node.create<TableOfContentsOptions>({
  name: 'tableOfContents',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="table-of-contents"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'table-of-contents',
        class: 'toc-container',
      }),
      ['div', { class: 'toc-title' }, 'Table of Contents'],
      ['div', { class: 'toc-items' }],
    ];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
          });
        },
    };
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'table-of-contents');
      dom.classList.add('toc-container');
      dom.contentEditable = 'false';

      const title = document.createElement('div');
      title.classList.add('toc-title');
      title.textContent = 'Table of Contents';
      dom.appendChild(title);

      const itemsContainer = document.createElement('div');
      itemsContainer.classList.add('toc-items');
      dom.appendChild(itemsContainer);

      const updateToc = () => {
        const items = extractTocItems(editor);
        itemsContainer.innerHTML = '';

        if (items.length === 0) {
          const empty = document.createElement('div');
          empty.classList.add('toc-empty');
          empty.textContent = 'No headings found';
          itemsContainer.appendChild(empty);
          return;
        }

        items.forEach((item) => {
          const link = document.createElement('a');
          link.classList.add('toc-item', `toc-level-${item.level}`);
          link.textContent = item.text || 'Untitled';
          link.href = '#';
          link.onclick = (e) => {
            e.preventDefault();
            editor.commands.setTextSelection(item.pos);
            editor.commands.scrollIntoView();
          };
          itemsContainer.appendChild(link);
        });
      };

      // Initial render
      updateToc();

      // Update on document changes
      const unsubscribe = editor.on('update', updateToc);

      return {
        dom,
        destroy: () => {
          editor.off('update', updateToc);
        },
      };
    };
  },
});
