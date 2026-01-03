import { SchemaAdapter, basicSchemaAdapter } from '@automerge/prosemirror';

/**
 * Create SchemaAdapter for Just Maple's custom ProseMirror nodes
 * Maps between ProseMirror schema and Automerge document structure
 */
export function createJustMapleSchemaAdapter(): SchemaAdapter {
  // Use the basic schema adapter provided by Automerge
  // This handles basic rich text with headings, lists, marks, etc.
  return basicSchemaAdapter;

  // TODO: Implement custom schema adapter to support custom nodes
  // (Mention, BotWidget) by extending basicSchemaAdapter
}
