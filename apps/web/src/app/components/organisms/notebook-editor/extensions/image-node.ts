import { Node, mergeAttributes } from '@tiptap/core';

export type ImageAlignment = 'left' | 'center' | 'right' | 'full';

export interface ImageNodeOptions {
  HTMLAttributes: Record<string, unknown>;
  allowBase64: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    memoImage: {
      /**
       * Insert an image with URL and optional attributes
       */
      insertMemoImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        alignment?: ImageAlignment;
        width?: number;
        height?: number;
      }) => ReturnType;
      /**
       * Set alignment for the selected image
       */
      setImageAlignment: (alignment: ImageAlignment) => ReturnType;
      /**
       * Delete an image by src
       */
      deleteMemoImage: (src: string) => ReturnType;
    };
  }
}

/**
 * Memo Image Node Extension
 * Supports alignment options: left, center, right, full width
 */
export const ImageNode = Node.create<ImageNodeOptions>({
  name: 'memoImage',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      allowBase64: false,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attributes) => {
          if (!attributes['src']) {
            return {};
          }
          return { src: attributes['src'] };
        },
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('alt'),
        renderHTML: (attributes) => {
          if (!attributes['alt']) {
            return {};
          }
          return { alt: attributes['alt'] };
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes) => {
          if (!attributes['title']) {
            return {};
          }
          return { title: attributes['title'] };
        },
      },
      alignment: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-alignment') || 'center',
        renderHTML: (attributes) => {
          return {
            'data-alignment': attributes['alignment'] || 'center',
          };
        },
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.getAttribute('data-width');
          return width ? parseInt(width, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes['width']) {
            return {};
          }
          return { 'data-width': attributes['width'] };
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const height = element.getAttribute('data-height');
          return height ? parseInt(height, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes['height']) {
            return {};
          }
          return { 'data-height': attributes['height'] };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="memo-image"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'memo-image',
        class: 'memo-image-block',
      }),
      ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt || '' }],
    ];
  },

  addCommands() {
    return {
      insertMemoImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              src: options.src,
              alt: options.alt || '',
              title: options.title || '',
              alignment: options.alignment || 'center',
              width: options.width,
              height: options.height,
            },
          });
        },
      setImageAlignment:
        (alignment: ImageAlignment) =>
        ({ state, dispatch }) => {
          const { selection } = state;
          const node = state.doc.nodeAt(selection.from);

          if (!node || node.type.name !== this.name) {
            return false;
          }

          if (dispatch) {
            const { tr } = state;
            tr.setNodeMarkup(selection.from, undefined, {
              ...node.attrs,
              alignment,
            });
            dispatch(tr);
          }

          return true;
        },
      deleteMemoImage:
        (src: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['src'] === src) {
              if (dispatch) {
                tr.delete(pos, pos + node.nodeSize);
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
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const src = node.attrs['src'] as string;
      const alt = node.attrs['alt'] as string;
      const alignment = (node.attrs['alignment'] as ImageAlignment) || 'center';
      const width = node.attrs['width'] as number | null;
      const height = node.attrs['height'] as number | null;

      // Create container
      const dom = document.createElement('figure');
      dom.setAttribute('data-type', 'memo-image');
      dom.setAttribute('data-alignment', alignment);
      dom.classList.add('memo-image-block', `align-${alignment}`);
      dom.contentEditable = 'false';

      // Create image wrapper for sizing
      const wrapper = document.createElement('div');
      wrapper.classList.add('memo-image-wrapper');

      // Create image element
      const img = document.createElement('img');
      img.src = src;
      img.alt = alt || '';
      img.draggable = false;
      if (width) {
        img.style.width = `${width}px`;
      }
      if (height) {
        img.style.height = `${height}px`;
      }

      wrapper.appendChild(img);
      dom.appendChild(wrapper);

      // Create alignment toolbar (visible on selection)
      const toolbar = document.createElement('div');
      toolbar.classList.add('memo-image-toolbar');
      toolbar.innerHTML = `
                <button type="button" data-alignment="left" title="Align left" class="${alignment === 'left' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <button type="button" data-alignment="center" title="Center" class="${alignment === 'center' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <button type="button" data-alignment="right" title="Align right" class="${alignment === 'right' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>
                <button type="button" data-alignment="full" title="Full width" class="${alignment === 'full' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                    </svg>
                </button>
            `;
      dom.appendChild(toolbar);

      // Add click handlers for alignment buttons
      toolbar.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newAlignment = button.getAttribute('data-alignment') as ImageAlignment;
          if (newAlignment && typeof getPos === 'function') {
            const pos = getPos();
            editor.chain().focus().setNodeSelection(pos).setImageAlignment(newAlignment).run();
          }
        });
      });

      // Handle selection state for showing toolbar
      const updateSelected = (selected: boolean) => {
        if (selected) {
          dom.classList.add('selected');
        } else {
          dom.classList.remove('selected');
        }
      };

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== this.name) {
            return false;
          }

          const newAlignment = updatedNode.attrs['alignment'] as ImageAlignment;
          const newSrc = updatedNode.attrs['src'] as string;

          // Update alignment class
          dom.classList.remove('align-left', 'align-center', 'align-right', 'align-full');
          dom.classList.add(`align-${newAlignment}`);
          dom.setAttribute('data-alignment', newAlignment);

          // Update toolbar active state
          toolbar.querySelectorAll('button').forEach((button) => {
            const btnAlignment = button.getAttribute('data-alignment');
            button.classList.toggle('active', btnAlignment === newAlignment);
          });

          // Update image src if changed
          if (img.src !== newSrc) {
            img.src = newSrc;
          }

          return true;
        },
        selectNode: () => updateSelected(true),
        deselectNode: () => updateSelected(false),
      };
    };
  },
});
