import { Type, Static } from '@sinclair/typebox';
import { PageContentSchema } from './page';

export const TemplateCategorySchema = Type.Union([
    Type.Literal('work'),
    Type.Literal('personal'),
    Type.Literal('planning'),
    Type.Literal('custom'),
]);

export type TemplateCategory = Static<typeof TemplateCategorySchema>;

export const TemplateSchema = Type.Object({
    id: Type.String(),
    userId: Type.Union([Type.String(), Type.Null()]), // null = system template
    title: Type.String(),
    description: Type.String(),
    category: TemplateCategorySchema,
    content: PageContentSchema,
    icon: Type.Optional(Type.String()), // Emoji or icon name
    isSystem: Type.Boolean(),
    usageCount: Type.Optional(Type.Number()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Template = Static<typeof TemplateSchema>;

export const CreateTemplateSchema = Type.Object({
    title: Type.String({ minLength: 1, maxLength: 255 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    category: Type.Optional(TemplateCategorySchema),
    icon: Type.Optional(Type.String()),
    content: Type.Optional(PageContentSchema),
    pageId: Type.Optional(Type.String()), // Copy content from existing page
});

export type CreateTemplateInput = Static<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    category: Type.Optional(TemplateCategorySchema),
    icon: Type.Optional(Type.String()),
    content: Type.Optional(PageContentSchema),
});

export type UpdateTemplateInput = Static<typeof UpdateTemplateSchema>;

export const CreatePageFromTemplateSchema = Type.Object({
    notebookId: Type.String(),
    title: Type.Optional(Type.String()),
    notebookName: Type.Optional(Type.String()),
});

export type CreatePageFromTemplateInput = Static<typeof CreatePageFromTemplateSchema>;
