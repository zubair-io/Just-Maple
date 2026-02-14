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

// Shared bot entry
export const SharedBotEntrySchema = Type.Object({
    userBotId: Type.String(),
});
export type SharedBotEntry = Static<typeof SharedBotEntrySchema>;

// Sharing configuration
export const NotebookSharingSchema = Type.Object({
    sharedWith: Type.Array(SharedWithEntrySchema),
    isPublic: Type.Optional(Type.Boolean()),
    sharedBots: Type.Optional(Type.Array(SharedBotEntrySchema)),
});
export type NotebookSharing = Static<typeof NotebookSharingSchema>;

// Notebook value - metadata for folder content type
export const NotebookValueSchema = Type.Union([
    Type.Literal('mixed'),
    Type.Literal('recordings'),
    Type.Literal('notes'),
]);
export type NotebookValue = Static<typeof NotebookValueSchema>;

// Public notebook configuration
export const PublicConfigSchema = Type.Object({
    displayName: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    faviconUrl: Type.Optional(Type.String()),
    logoUrl: Type.Optional(Type.String()),
    landingPageId: Type.Optional(Type.String()),
    showPageList: Type.Optional(Type.Boolean()),
});
export type PublicConfig = Static<typeof PublicConfigSchema>;

export const NotebookSchema = Type.Object({
    _id: Type.String(),
    type: Type.Literal('folder'),
    value: NotebookValueSchema,
    label: Type.String(),
    sharing: NotebookSharingSchema,
    slug: Type.Optional(Type.String()),
    publicConfig: Type.Optional(PublicConfigSchema),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Notebook = Static<typeof NotebookSchema>;

export const CreateNotebookSchema = Type.Object({
    label: Type.String({ minLength: 1, maxLength: 100 }),
    value: Type.Optional(NotebookValueSchema),
});

export type CreateNotebookInput = Static<typeof CreateNotebookSchema>;

export const UpdateNotebookSchema = Type.Object({
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    value: Type.Optional(NotebookValueSchema),
});

export type UpdateNotebookInput = Static<typeof UpdateNotebookSchema>;

// Share notebook with user
export const ShareNotebookSchema = Type.Object({
    userId: Type.String(),
    accessLevel: Type.Union([Type.Literal('read'), Type.Literal('write')]),
});
export type ShareNotebookInput = Static<typeof ShareNotebookSchema>;

// Update sharing settings
export const UpdateSharingSchema = Type.Object({
    isPublic: Type.Optional(Type.Boolean()),
});
export type UpdateSharingInput = Static<typeof UpdateSharingSchema>;

// Notebook member with full user data (for displaying member list)
export const NotebookMemberSchema = Type.Object({
    userId: Type.String(),
    email: Type.String({ format: 'email' }),
    displayName: Type.Optional(Type.String()),
    profilePictureUrl: Type.Optional(Type.String()),
    accessLevel: AccessLevelSchema,
});
export type NotebookMember = Static<typeof NotebookMemberSchema>;

// Update public config input
export const UpdatePublicConfigSchema = Type.Object({
    isPublic: Type.Optional(Type.Boolean()),
    publicConfig: Type.Optional(PublicConfigSchema),
});
export type UpdatePublicConfigInput = Static<typeof UpdatePublicConfigSchema>;
