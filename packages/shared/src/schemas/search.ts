import { Type, Static } from '@sinclair/typebox';
import { PageTypeSchema } from './page';

// Schema for documents stored in the search_index collection
export const SearchIndexSchema = Type.Object({
    _id: Type.String(),
    pageId: Type.String(), // Links to pages.id
    userId: Type.String(), // Original owner
    notebookId: Type.Optional(Type.String()),
    type: PageTypeSchema,
    title: Type.String(),
    plainText: Type.String(), // Extracted searchable text from Y.js/ProseMirror
    preview: Type.String(), // First 200 chars for display
    notebookLabel: Type.Optional(Type.String()),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type SearchIndex = Static<typeof SearchIndexSchema>;

// Schema for search results returned to the client
export const SearchResultSchema = Type.Object({
    pageId: Type.String(),
    title: Type.String(),
    type: PageTypeSchema,
    notebookId: Type.Optional(Type.String()),
    notebookLabel: Type.Optional(Type.String()),
    preview: Type.String(),
    snippet: Type.String(), // Highlighted snippet with <mark> tags
    score: Type.Number(),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type SearchResult = Static<typeof SearchResultSchema>;

// Schema for search request parameters
export const SearchRequestSchema = Type.Object({
    q: Type.String({ minLength: 1 }),
    types: Type.Optional(Type.Array(PageTypeSchema)),
    notebookIds: Type.Optional(Type.Array(Type.String())),
    dateFrom: Type.Optional(Type.String({ format: 'date-time' })),
    dateTo: Type.Optional(Type.String({ format: 'date-time' })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
    offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export type SearchRequest = Static<typeof SearchRequestSchema>;

// Schema for search response
export const SearchResponseSchema = Type.Object({
    results: Type.Array(SearchResultSchema),
});

export type SearchResponse = Static<typeof SearchResponseSchema>;
