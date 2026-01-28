import { Node, mergeAttributes } from '@tiptap/core';

export type ImageSize = 'small' | 'medium' | 'large' | 'cover';

export interface MemoImageUrls {
  original: string;
  small: string;
  medium: string;
  large: string;
  cover: string;
}

export interface ImageNodeOptions {
  HTMLAttributes: Record<string, unknown>;
  allowBase64: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    memoImage: {
      /**
       * Insert an image with URLs and optional attributes
       */
      insertMemoImage: (options: {
        urls: MemoImageUrls;
        alt?: string;
        title?: string;
        size?: ImageSize;
        loading?: boolean;
        previewUrl?: string;
      }) => ReturnType;
      /**
       * Set size for the selected image
       */
      setImageSize: (size: ImageSize) => ReturnType;
      /**
       * Update image URLs and remove loading state
       */
      updateMemoImage: (
        originalUrl: string,
        updates: { urls?: MemoImageUrls; loading?: boolean },
      ) => ReturnType;
      /**
       * Delete an image by original URL
       */
      deleteMemoImage: (originalUrl: string) => ReturnType;
    };
  }
}

/**
 * Get the appropriate URL for a given size
 */
function getUrlForSize(urls: MemoImageUrls, size: ImageSize): string {
  return urls[size] || urls.medium || urls.original;
}

/**
 * Parse URLs from node attributes (stored as JSON string or object)
 */
function parseUrls(urlsAttr: string | MemoImageUrls | null): MemoImageUrls | null {
  if (!urlsAttr) return null;
  if (typeof urlsAttr === 'object') return urlsAttr;
  try {
    return JSON.parse(urlsAttr);
  } catch {
    return null;
  }
}

/**
 * Memo Image Node Extension
 * Supports size options: small (200px), medium (400px), large (800px), cover (1200x300)
 * Stores all size URLs and displays the appropriate one based on selected size
 * Supports loading state for optimistic UI during upload
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
      urls: {
        default: null,
        parseHTML: (element) => {
          const urlsStr = element.getAttribute('data-urls');
          if (urlsStr) {
            try {
              return JSON.parse(urlsStr);
            } catch {
              return null;
            }
          }
          // Fallback: check for legacy src attribute
          const src = element.getAttribute('src');
          if (src) {
            return {
              original: src,
              small: src,
              medium: src,
              large: src,
              cover: src,
            };
          }
          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes['urls']) {
            return {};
          }
          return {
            'data-urls': JSON.stringify(attributes['urls']),
          };
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
      size: {
        default: 'medium',
        parseHTML: (element) => element.getAttribute('data-size') || 'medium',
        renderHTML: (attributes) => {
          return {
            'data-size': attributes['size'] || 'medium',
          };
        },
      },
      loading: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-loading') === 'true',
        renderHTML: (attributes) => {
          if (!attributes['loading']) {
            return {};
          }
          return { 'data-loading': 'true' };
        },
      },
      previewUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-preview-url'),
        renderHTML: (attributes) => {
          if (!attributes['previewUrl']) {
            return {};
          }
          return { 'data-preview-url': attributes['previewUrl'] };
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
    const urls = parseUrls(HTMLAttributes['urls'] || HTMLAttributes['data-urls']);
    const size = (HTMLAttributes['size'] || HTMLAttributes['data-size'] || 'medium') as ImageSize;
    const loading = HTMLAttributes['loading'] || HTMLAttributes['data-loading'] === 'true';
    const previewUrl = HTMLAttributes['previewUrl'] || HTMLAttributes['data-preview-url'];
    const src = loading && previewUrl ? previewUrl : urls ? getUrlForSize(urls, size) : '';

    return [
      'figure',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'memo-image',
        class: 'memo-image-block',
      }),
      ['img', { src, alt: HTMLAttributes['alt'] || '' }],
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
              urls: options.urls,
              alt: options.alt || '',
              title: options.title || '',
              size: options.size || 'medium',
              loading: options.loading || false,
              previewUrl: options.previewUrl || null,
            },
          });
        },
      setImageSize:
        (size: ImageSize) =>
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
              size,
            });
            dispatch(tr);
          }

          return true;
        },
      updateMemoImage:
        (originalUrl: string, updates: { urls?: MemoImageUrls; loading?: boolean }) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name) {
              const urls = parseUrls(node.attrs['urls']);
              if (urls && urls.original === originalUrl) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    ...(updates.urls && { urls: updates.urls }),
                    ...(updates.loading !== undefined && { loading: updates.loading }),
                    // Clear preview URL when done loading
                    ...(updates.loading === false && { previewUrl: null }),
                  });
                }
                found = true;
                return false;
              }
            }
            return true;
          });

          if (found && dispatch) {
            dispatch(tr);
          }

          return found;
        },
      deleteMemoImage:
        (originalUrl: string) =>
        ({ state, dispatch }) => {
          const { doc, tr } = state;
          let found = false;

          doc.descendants((node, pos) => {
            if (node.type.name === this.name) {
              const urls = parseUrls(node.attrs['urls']);
              if (urls && urls.original === originalUrl) {
                if (dispatch) {
                  tr.delete(pos, pos + node.nodeSize);
                }
                found = true;
                return false;
              }
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
      const urls = parseUrls(node.attrs['urls']) as MemoImageUrls | null;
      const alt = node.attrs['alt'] as string;
      const size = (node.attrs['size'] as ImageSize) || 'medium';
      const loading = node.attrs['loading'] as boolean;
      const previewUrl = node.attrs['previewUrl'] as string | null;

      // Create container
      const dom = document.createElement('figure');
      dom.setAttribute('data-type', 'memo-image');
      dom.setAttribute('data-size', size);
      dom.classList.add('memo-image-block', `size-${size}`);
      if (loading) {
        dom.classList.add('loading');
      }
      dom.contentEditable = 'false';

      // Create image wrapper for sizing
      const wrapper = document.createElement('div');
      wrapper.classList.add('memo-image-wrapper');

      // Create image element
      const img = document.createElement('img');
      // Use preview URL while loading, otherwise use the appropriate sized URL
      img.src = loading && previewUrl ? previewUrl : urls ? getUrlForSize(urls, size) : '';
      img.alt = alt || '';
      img.draggable = false;

      wrapper.appendChild(img);

      // Create loading overlay
      const loadingOverlay = document.createElement('div');
      loadingOverlay.classList.add('memo-image-loading');
      loadingOverlay.innerHTML = `
                <div class="loading-spinner"></div>
                <span>Uploading...</span>
            `;
      if (!loading) {
        loadingOverlay.style.display = 'none';
      }
      wrapper.appendChild(loadingOverlay);

      dom.appendChild(wrapper);

      // Create size toolbar (visible on selection, hidden during loading)
      const toolbar = document.createElement('div');
      toolbar.classList.add('memo-image-toolbar');
      if (loading) {
        toolbar.style.display = 'none';
      }
      toolbar.innerHTML = `
                <button type="button" data-size="small" title="Small (200px)" class="${size === 'small' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="7" y="7" width="10" height="10" rx="1"/>
                    </svg>
                </button>
                <button type="button" data-size="medium" title="Medium (400px)" class="${size === 'medium' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="5" y="5" width="14" height="14" rx="1"/>
                    </svg>
                </button>
                <button type="button" data-size="large" title="Large (800px)" class="${size === 'large' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                    </svg>
                </button>
                <button type="button" data-size="cover" title="Cover (full width)" class="${size === 'cover' ? 'active' : ''}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="6" width="20" height="12" rx="2"/>
                    </svg>
                </button>
            `;
      dom.appendChild(toolbar);

      // Add click handlers for size buttons
      toolbar.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const newSize = button.getAttribute('data-size') as ImageSize;
          if (newSize && typeof getPos === 'function') {
            const pos = getPos();
            if (pos !== undefined) {
              editor.chain().focus().setNodeSelection(pos).setImageSize(newSize).run();
            }
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

          const newSize = updatedNode.attrs['size'] as ImageSize;
          const newUrls = parseUrls(updatedNode.attrs['urls']);
          const newLoading = updatedNode.attrs['loading'] as boolean;
          const newPreviewUrl = updatedNode.attrs['previewUrl'] as string | null;

          // Update loading state
          if (newLoading) {
            dom.classList.add('loading');
            loadingOverlay.style.display = '';
            toolbar.style.display = 'none';
          } else {
            dom.classList.remove('loading');
            loadingOverlay.style.display = 'none';
            toolbar.style.display = '';
          }

          // Update size class
          dom.classList.remove('size-small', 'size-medium', 'size-large', 'size-cover');
          dom.classList.add(`size-${newSize}`);
          dom.setAttribute('data-size', newSize);

          // Update toolbar active state
          toolbar.querySelectorAll('button').forEach((button) => {
            const btnSize = button.getAttribute('data-size');
            button.classList.toggle('active', btnSize === newSize);
          });

          // Update image src
          const newSrc =
            newLoading && newPreviewUrl
              ? newPreviewUrl
              : newUrls
                ? getUrlForSize(newUrls, newSize)
                : '';
          if (img.src !== newSrc && newSrc) {
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
