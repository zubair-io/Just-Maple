/**
 * Represents a node in the content tree (ProseMirror JSON)
 */
export interface ContentNode {
  type: string;
  content?: ContentNode[];
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}
