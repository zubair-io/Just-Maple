import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface ImageUploadOptions {
  /**
   * Callback to upload image file and return URL
   */
  uploadFn: (file: File) => Promise<string>;
}

/**
 * Extension to handle image paste and drop with upload
 */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: 'imageUpload',

  addOptions() {
    return {
      uploadFn: async () => {
        throw new Error('uploadFn not configured');
      },
    };
  },

  addProseMirrorPlugins() {
    const uploadFn = this.options.uploadFn;

    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItems = items.filter((item) => item.type.startsWith('image/'));

            if (imageItems.length > 0) {
              event.preventDefault();

              imageItems.forEach((item) => {
                const file = item.getAsFile();
                if (file) {
                  // Insert placeholder while uploading
                  const pos = view.state.selection.from;

                  uploadFn(file)
                    .then((url) => {
                      // Create image node
                      const node = view.state.schema.nodes['image'].create({
                        src: url,
                      });

                      // Insert at position
                      const transaction = view.state.tr.replaceWith(pos, pos, node);
                      view.dispatch(transaction);
                    })
                    .catch((error) => {
                      console.error('[ImageUpload] Upload failed:', error);
                      // TODO: Show error notification to user
                    });
                }
              });

              return true;
            }

            return false;
          },

          handleDrop(view, event) {
            const hasFiles = event.dataTransfer?.files?.length;

            if (!hasFiles) {
              return false;
            }

            const files = Array.from(event.dataTransfer.files);
            const imageFiles = files.filter((file) => file.type.startsWith('image/'));

            if (imageFiles.length > 0) {
              event.preventDefault();

              // Get drop position
              const coordinates = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });

              if (!coordinates) {
                return true;
              }

              imageFiles.forEach((file) => {
                const pos = coordinates.pos;

                uploadFn(file)
                  .then((url) => {
                    // Create image node
                    const node = view.state.schema.nodes['image'].create({
                      src: url,
                    });

                    // Insert at drop position
                    const transaction = view.state.tr.replaceWith(pos, pos, node);
                    view.dispatch(transaction);
                  })
                  .catch((error) => {
                    console.error('[ImageUpload] Upload failed:', error);
                    // TODO: Show error notification to user
                  });
              });

              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
