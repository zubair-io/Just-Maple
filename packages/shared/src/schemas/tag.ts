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

// Tag value - metadata for folder content type
export const TagValueSchema = Type.Union([
    Type.Literal('mixed'),
    Type.Literal('recordings'),
    Type.Literal('notes'),
]);
export type TagValue = Static<typeof TagValueSchema>;

export const TagSchema = Type.Object({
    _id: Type.String(),
    type: Type.Literal('folder'),
    value: TagValueSchema,
    label: Type.String(),
    sharing: TagSharingSchema,
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Tag = Static<typeof TagSchema>;

export const CreateTagSchema = Type.Object({
    label: Type.String({ minLength: 1, maxLength: 100 }),
    value: Type.Optional(TagValueSchema),
});

export type CreateTagInput = Static<typeof CreateTagSchema>;

export const UpdateTagSchema = Type.Object({
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    value: Type.Optional(TagValueSchema),
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

// Tag member with full user data (for displaying member list)
export const TagMemberSchema = Type.Object({
    userId: Type.String(),
    email: Type.String({ format: 'email' }),
    displayName: Type.Optional(Type.String()),
    profilePictureUrl: Type.Optional(Type.String()),
    accessLevel: AccessLevelSchema,
});
export type TagMember = Static<typeof TagMemberSchema>;
