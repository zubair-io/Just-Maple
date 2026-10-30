import { Type, Static } from '@sinclair/typebox';
import { PageTodoMetaSchema } from './todo';

export const PageContentSchema = Type.Object({
  type: Type.String(),
  content: Type.Optional(Type.Array(Type.Any())),
  attrs: Type.Optional(Type.Record(Type.String(), Type.Any())),
  text: Type.Optional(Type.String()),
});

export type PageContent = Static<typeof PageContentSchema>;

// Page type - for Just Maple, only 'memo' is used
export const PageTypeSchema = Type.Union([Type.Literal('memo')]);

export type PageType = Static<typeof PageTypeSchema>;

export const PageSchema = Type.Object({
  _id: Type.String(),
  id: Type.String(),
  userId: Type.String(),
  type: PageTypeSchema,
  title: Type.String(),
  content: PageContentSchema,
  folderId: Type.Optional(Type.String()),
  headerImageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  isFavorite: Type.Optional(Type.Boolean()),
  isArchived: Type.Optional(Type.Boolean()),
  isTrashed: Type.Optional(Type.Boolean()),
  trashedAt: Type.Optional(Type.String({ format: 'date-time' })),
  todoMeta: Type.Optional(PageTodoMetaSchema),
  tags: Type.Optional(Type.Array(Type.String())),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export type Page = Static<typeof PageSchema>;

export const CreatePageSchema = Type.Object({
  type: Type.Optional(PageTypeSchema),
  title: Type.Optional(Type.String({ maxLength: 500 })),
  content: Type.Optional(PageContentSchema),
  folderId: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
});

export type CreatePageInput = Static<typeof CreatePageSchema>;

export const UpdatePageSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  content: Type.Optional(PageContentSchema),
  folderId: Type.Optional(Type.String()),
  headerImageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  isFavorite: Type.Optional(Type.Boolean()),
  isArchived: Type.Optional(Type.Boolean()),
  isTrashed: Type.Optional(Type.Boolean()),
  todoMeta: Type.Optional(PageTodoMetaSchema),
  tags: Type.Optional(Type.Array(Type.String())),
});

export type UpdatePageInput = Static<typeof UpdatePageSchema>;

// Default empty page content - starts with H1 heading as title
export const DEFAULT_PAGE_CONTENT: PageContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [],
    },
    {
      type: 'paragraph',
      content: [],
    },
  ],
};
