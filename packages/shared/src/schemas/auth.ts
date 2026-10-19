import { Type, Static } from '@sinclair/typebox';

export const AuthResponseSchema = Type.Object({
    accessToken: Type.String(),
    user: Type.Object({
        _id: Type.String(),
        email: Type.Optional(Type.String()),
        displayName: Type.Optional(Type.String()),
    }),
});

export type AuthResponse = Static<typeof AuthResponseSchema>;

export const JWTPayloadSchema = Type.Object({
    sub: Type.String(),
    email: Type.Optional(Type.String()),
    iat: Type.Number(),
    exp: Type.Number(),
});

export type JWTPayload = Static<typeof JWTPayloadSchema>;

export const ErrorResponseSchema = Type.Object({
    error: Type.String(),
    message: Type.Optional(Type.String()),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
