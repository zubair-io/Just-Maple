import { Type, Static } from '@sinclair/typebox';

// User preferences schema
export const UserPreferencesSchema = Type.Object({
    // Tag colors: maps tag names to color hex values
    tagColors: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type UserPreferences = Static<typeof UserPreferencesSchema>;

export const UserSchema = Type.Object({
    _id: Type.String(),
    email: Type.Optional(Type.String({ format: 'email' })),
    displayName: Type.Optional(Type.String()),
    profilePictureUrl: Type.Optional(Type.String()),
    profilePictureFullUrl: Type.Optional(Type.String()),
    profilePictureThumbnailUrl: Type.Optional(Type.String()),
    admin: Type.Optional(Type.Boolean()),
    preferences: Type.Optional(UserPreferencesSchema),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type User = Static<typeof UserSchema>;

export const CreateUserSchema = Type.Object({
    email: Type.Optional(Type.String({ format: 'email' })),
    displayName: Type.Optional(Type.String()),
});

export type CreateUser = Static<typeof CreateUserSchema>;

export const UserResponseSchema = Type.Object({
    _id: Type.String(),
    email: Type.Optional(Type.String()),
    displayName: Type.Optional(Type.String()),
    profilePictureUrl: Type.Optional(Type.String()),
    profilePictureFullUrl: Type.Optional(Type.String()),
    profilePictureThumbnailUrl: Type.Optional(Type.String()),
    admin: Type.Optional(Type.Boolean()),
});

export type UserResponse = Static<typeof UserResponseSchema>;
