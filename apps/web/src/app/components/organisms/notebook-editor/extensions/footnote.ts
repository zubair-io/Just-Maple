import { Node, mergeAttributes } from '@tiptap/core';

export interface FootnoteAttrs {
  id: string;
  content: string;
}

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>;
}

function generateFootnoteId(): string {
  return crypto.randomUUID();
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (content?: string) => ReturnType;
    };
  }
}

/**
 * Inline footnote. The note text is stored on the node itself and shown on
 * hover / click (a self-contained "tooltip footnote" rather than a separate
 * footnotes section). The displayed number is derived from document order so it
 * stays correct as footnotes are added or removed.
 */
export const Footnote = Node.create<FootnoteOptions>({
  name: 'footnote',

  inline: true,

  group: 'inline',

  atom: true,

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-footnote-id'),
        renderHTML: (attributes) => ({
          'data-footnote-id': attributes['id'] || generateFootnoteId(),
        }),
      },
      content: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-footnote-content') || '',
        renderHTML: (attributes) => ({
          'data-footnote-content': attributes['content'] || '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes({ 'data-type': 'footnote', class: 'footnote-ref' }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      insertFootnote:
        (content = '') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { id: generateFootnoteId(), content },
          });
        },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('sup');
      dom.setAttribute('data-type', 'footnote');
      dom.classList.add('footnote-ref');
      dom.contentEditable = 'false';

      // Compute the display number = how many footnotes precede this one.
      const computeNumber = (): number => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return 0;
        let count = 0;
        editor.state.doc.descendants((child, childPos) => {
          if (child.type.name === 'footnote' && childPos < pos) count++;
          return true;
        });
        return count + 1;
      };

      const render = () => {
        dom.textContent = `[${computeNumber()}]`;
        dom.title = node.attrs['content'] || '(empty footnote — click to edit)';
      };

      render();

      dom.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null || pos === undefined) return;
        const next = window.prompt('Footnote text', node.attrs['content'] || '');
        if (next === null) return;
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, content: next });
            return true;
          })
          .run();
      });

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) return false;
          node = updatedNode;
          render();
          return true;
        },
      };
    };
  },
});
