import { Type, Static } from '@sinclair/typebox';

// ============================================
// Link Types
// ============================================

export const LinkTypeSchema = Type.Union([
    Type.Literal('inline'), // [[Page Name]] style wiki-link
    Type.Literal('block'), // Embed-style preview block
    Type.Literal('tag'), // #tag reference
]);

export type LinkType = Static<typeof LinkTypeSchema>;

// ============================================
// Page Link Schema
// ============================================

export const PageLinkSchema = Type.Object({
    pageId: Type.String(), // Target page UUID
    title: Type.String(), // Denormalized for display
    type: LinkTypeSchema,
    context: Type.Optional(Type.String()), // Surrounding text snippet
});

export type PageLink = Static<typeof PageLinkSchema>;

// ============================================
// Links Metadata Schema (stored on Page)
// ============================================

export const PageLinksMetaSchema = Type.Object({
    forwardLinks: Type.Array(PageLinkSchema), // Pages this page links to
    backlinks: Type.Array(PageLinkSchema), // Pages linking to this page
    lastIndexedAt: Type.Optional(Type.String({ format: 'date-time' })), // When links were last extracted
});

export type PageLinksMeta = Static<typeof PageLinksMetaSchema>;

// ============================================
// Link Search Result
// ============================================

export const LinkSearchResultSchema = Type.Object({
    id: Type.String(),
    title: Type.String(),
    type: Type.String(), // Page type (memo, whiteboard, etc.)
    notebookId: Type.Optional(Type.String()),
    notebookName: Type.Optional(Type.String()),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type LinkSearchResult = Static<typeof LinkSearchResultSchema>;

// ============================================
// Unlinked Mention
// ============================================

export const UnlinkedMentionSchema = Type.Object({
    pageId: Type.String(),
    title: Type.String(),
    context: Type.String(), // Text around the mention
});

export type UnlinkedMention = Static<typeof UnlinkedMentionSchema>;

// ============================================
// Graph Types
// ============================================

export const GraphNodeSchema = Type.Object({
    id: Type.String(),
    label: Type.String(),
    type: Type.String(), // Page type
    linkCount: Type.Number(),
    isCenter: Type.Optional(Type.Boolean()),
});

export type GraphNode = Static<typeof GraphNodeSchema>;

export const GraphEdgeSchema = Type.Object({
    source: Type.String(),
    target: Type.String(),
    type: LinkTypeSchema,
});

export type GraphEdge = Static<typeof GraphEdgeSchema>;

export const GraphDataSchema = Type.Object({
    nodes: Type.Array(GraphNodeSchema),
    edges: Type.Array(GraphEdgeSchema),
});

export type GraphData = Static<typeof GraphDataSchema>;
