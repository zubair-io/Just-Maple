import { Document } from '@tiptap/extension-document';

/**
 * Custom Document extension that enforces heading as the first block
 * This creates a Notion-like structure where the first line is always the title
 */
export const CustomDocument = Document.extend({
  // Enforces that the document must start with a heading,
  // followed by zero or more blocks
  content: 'heading block*',
});
