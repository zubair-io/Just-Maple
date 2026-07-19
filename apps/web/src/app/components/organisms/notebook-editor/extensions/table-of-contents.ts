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

      // Skip the (expensive) innerHTML rebuild unless the heading set actually
      // changed. `editor.on('update')` fires on every keystroke and every remote
      // collab transaction, so rebuilding unconditionally caused visible jank.
      let lastSignature = '';

      const updateToc = () => {
        const items = extractTocItems(editor);
        const signature = items.map((item) => `${item.level}:${item.text}`).join('|');
        if (signature === lastSignature) {
          return;
        }
        lastSignature = signature;

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

      // Coalesce bursts of updates (e.g. fast typing) into a single scan.
      let pending: ReturnType<typeof setTimeout> | null = null;
      const scheduleUpdate = () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          updateToc();
        }, 150);
      };

      // Initial render
      updateToc();

      // Update on document changes
      editor.on('update', scheduleUpdate);

      return {
        dom,
        destroy: () => {
          editor.off('update', scheduleUpdate);
          if (pending) {
            clearTimeout(pending);
            pending = null;
          }
        },
      };
    };
  },
});
