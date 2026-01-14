import { Type, Static } from '@sinclair/typebox';

export const UserSchema = Type.Object({
    _id: Type.String(),
    email: Type.String({ format: 'email' }),
    displayName: Type.Optional(Type.String()),
    profilePictureUrl: Type.Optional(Type.String()),
    admin: Type.Optional(Type.Boolean()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type User = Static<typeof UserSchema>;

export const CreateUserSchema = Type.Object({
    email: Type.String({ format: 'email' }),
    displayName: Type.Optional(Type.String()),
});

export type CreateUser = Static<typeof CreateUserSchema>;

export const UserResponseSchema = Type.Object({
    _id: Type.String(),
    email: Type.String(),
    displayName: Type.Optional(Type.String()),
    profilePictureUrl: Type.Optional(Type.String()),
    admin: Type.Optional(Type.Boolean()),
});

export type UserResponse = Static<typeof UserResponseSchema>;
