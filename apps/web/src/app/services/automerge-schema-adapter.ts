import { SchemaAdapter, basicSchemaAdapter } from '@automerge/prosemirror';

/**
 * Create SchemaAdapter for Just Maple's custom ProseMirror nodes
 * Maps between ProseMirror schema and Automerge document structure
 *
 * NOTE: For now, we use the basic schema adapter as the @automerge/prosemirror package
 * API doesn't fully support custom node mappings in the way we need.
 * This is a simplified version that will work with the basic Automerge text schema.
 *
 * In the future, we may need to extend this to properly handle custom nodes like
 * Mention and BotWidget by implementing custom block mappings.
 */
export function createJustMapleSchemaAdapter(): SchemaAdapter {
  // Use the basic schema adapter provided by Automerge
  // This handles basic rich text with headings, lists, marks, etc.
  return basicSchemaAdapter;

  // TODO: Implement custom schema adapter when Automerge supports it
  // For now, custom nodes (Mention, BotWidget) will be stored as part of
  // the ProseMirror JSON content field and synced that way.
}
