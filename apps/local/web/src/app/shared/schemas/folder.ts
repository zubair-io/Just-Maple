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
export const FolderSharingSchema = Type.Object({
  sharedWith: Type.Array(SharedWithEntrySchema),
  isPublic: Type.Optional(Type.Boolean()),
  sharedBots: Type.Optional(Type.Array(SharedBotEntrySchema)),
});
export type FolderSharing = Static<typeof FolderSharingSchema>;

// Folder value - metadata for folder content type
export const FolderValueSchema = Type.Union([
  Type.Literal('mixed'),
  Type.Literal('recordings'),
  Type.Literal('notes'),
]);
export type FolderValue = Static<typeof FolderValueSchema>;

// Public folder configuration
export const PublicConfigSchema = Type.Object({
  displayName: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  faviconUrl: Type.Optional(Type.String()),
  logoUrl: Type.Optional(Type.String()),
  landingPageId: Type.Optional(Type.String()),
  showPageList: Type.Optional(Type.Boolean()),
});
export type PublicConfig = Static<typeof PublicConfigSchema>;

export const FolderSchema = Type.Object({
  _id: Type.String(),
  type: Type.Literal('folder'),
  value: FolderValueSchema,
  label: Type.String(),
  sharing: FolderSharingSchema,
  slug: Type.Optional(Type.String()),
  publicConfig: Type.Optional(PublicConfigSchema),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export type Folder = Static<typeof FolderSchema>;

export const CreateFolderSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 100 }),
  value: Type.Optional(FolderValueSchema),
});

export type CreateFolderInput = Static<typeof CreateFolderSchema>;

export const UpdateFolderSchema = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  value: Type.Optional(FolderValueSchema),
});

export type UpdateFolderInput = Static<typeof UpdateFolderSchema>;

// Share folder with user
export const ShareFolderSchema = Type.Object({
  userId: Type.String(),
  accessLevel: Type.Union([Type.Literal('read'), Type.Literal('write')]),
});
export type ShareFolderInput = Static<typeof ShareFolderSchema>;

// Update sharing settings
export const UpdateSharingSchema = Type.Object({
  isPublic: Type.Optional(Type.Boolean()),
});
export type UpdateSharingInput = Static<typeof UpdateSharingSchema>;

// Folder member with full user data (for displaying member list)
export const FolderMemberSchema = Type.Object({
  userId: Type.String(),
  email: Type.String({ format: 'email' }),
  displayName: Type.Optional(Type.String()),
  profilePictureUrl: Type.Optional(Type.String()),
  accessLevel: AccessLevelSchema,
});
export type FolderMember = Static<typeof FolderMemberSchema>;

// Update public config input
export const UpdatePublicConfigSchema = Type.Object({
  isPublic: Type.Optional(Type.Boolean()),
  publicConfig: Type.Optional(PublicConfigSchema),
});
export type UpdatePublicConfigInput = Static<typeof UpdatePublicConfigSchema>;
