import { Type, Static } from '@sinclair/typebox';

export const TagSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    type: Type.Literal('folder'),
    value: Type.String(), // URL-friendly slug
    label: Type.String(), // Display name
    color: Type.Optional(Type.String()), // Optional color for the tag
    parentId: Type.Optional(Type.String()), // For nested tags
    order: Type.Optional(Type.Number()), // Sort order
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Tag = Static<typeof TagSchema>;

export const CreateTagSchema = Type.Object({
    label: Type.String({ minLength: 1, maxLength: 100 }),
    color: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.String()),
});

export type CreateTagInput = Static<typeof CreateTagSchema>;

export const UpdateTagSchema = Type.Object({
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    color: Type.Optional(Type.String()),
    parentId: Type.Optional(Type.String()),
    order: Type.Optional(Type.Number()),
});

export type UpdateTagInput = Static<typeof UpdateTagSchema>;
