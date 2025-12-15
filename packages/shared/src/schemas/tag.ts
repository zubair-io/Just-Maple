import { Type, Static } from '@sinclair/typebox';

// Access level for shared users
export const AccessLevelSchema = Type.Union([
    Type.Literal('read'),
    Type.Literal('write'),
    Type.Literal('owner'),
]);
export type AccessLevel = Static<typeof AccessLevelSchema>;

// Shared user entry
export const SharedWithEntrySchema = Type.Object({
    userId: Type.String(),
    accessLevel: AccessLevelSchema,
});
export type SharedWithEntry = Static<typeof SharedWithEntrySchema>;

// Sharing configuration
export const TagSharingSchema = Type.Object({
    sharedWith: Type.Array(SharedWithEntrySchema),
    isPublic: Type.Optional(Type.Boolean()),
});
export type TagSharing = Static<typeof TagSharingSchema>;

export const TagSchema = Type.Object({
    _id: Type.String(),
    type: Type.Literal('folder'),
    value: Type.String(), // URL-friendly slug
    label: Type.String(), // Display name
    color: Type.Optional(Type.String()), // Optional color for the tag
    parentId: Type.Optional(Type.String()), // For nested tags
    order: Type.Optional(Type.Number()), // Sort order
    sharing: TagSharingSchema, // Sharing configuration (replaces userId)
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

// Share tag with user
export const ShareTagSchema = Type.Object({
    userId: Type.String(),
    accessLevel: Type.Union([Type.Literal('read'), Type.Literal('write')]),
});
export type ShareTagInput = Static<typeof ShareTagSchema>;

// Update sharing settings
export const UpdateSharingSchema = Type.Object({
    isPublic: Type.Optional(Type.Boolean()),
});
export type UpdateSharingInput = Static<typeof UpdateSharingSchema>;
