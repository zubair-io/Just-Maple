import { Extension } from '@tiptap/core';

// Zero-width space to create visible empty code element
const ZERO_WIDTH_SPACE = '\u200B';

/**
 * Extension to handle Enter key inside inline code marks.
 * - First Enter: inserts a hard break + empty code element
 * - Second Enter (on empty line): exits code mode and creates new paragraph
 */
export const CodeEnterHandler = Extension.create({
  name: 'codeEnterHandler',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        // Check if we're inside inline code (not code block)
        if (editor.isActive('code') && !editor.isActive('codeBlock')) {
          const { state } = editor;
          const { $from } = state.selection;

          // Get the text content around cursor
          const textBefore = $from.nodeBefore?.text || '';
          const textAfter = $from.nodeAfter?.text || '';

          // Check if we're on an empty code line (only zero-width space)
          const isEmptyCodeLine =
            (textBefore === ZERO_WIDTH_SPACE || textBefore === '') &&
            (textAfter === ZERO_WIDTH_SPACE || textAfter === '');

          if (isEmptyCodeLine) {
            // Double enter - exit code mode
            // Delete the zero-width space and create new paragraph
            editor
              .chain()
              .unsetMark('code')
              .deleteRange({
                from: $from.pos - 1,
                to: $from.pos + 1,
              })
              .insertContent({ type: 'paragraph' })
              .run();
            return true;
          }

          // First enter - insert hard break + empty code element
          editor
            .chain()
            .setHardBreak()
            .insertContent({
              type: 'text',
              text: ZERO_WIDTH_SPACE,
              marks: [{ type: 'code' }],
            })
            .run();
          return true;
        }
        return false;
      },
    };
  },
});
