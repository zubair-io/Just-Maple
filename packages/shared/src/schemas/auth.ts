import { Type, Static } from '@sinclair/typebox';

export const MagicLinkRequestSchema = Type.Object({
    email: Type.String({ format: 'email' }),
});

export type MagicLinkRequest = Static<typeof MagicLinkRequestSchema>;

export const MagicLinkResponseSchema = Type.Object({
    message: Type.String(),
    // In dev mode, we include the token and code for testing
    devToken: Type.Optional(Type.String()),
    devCode: Type.Optional(Type.String()),
});

export type MagicLinkResponse = Static<typeof MagicLinkResponseSchema>;

export const VerifyTokenRequestSchema = Type.Object({
    token: Type.String(),
});

export type VerifyTokenRequest = Static<typeof VerifyTokenRequestSchema>;

export const AuthResponseSchema = Type.Object({
    accessToken: Type.String(),
    user: Type.Object({
        _id: Type.String(),
        email: Type.String(),
        displayName: Type.Optional(Type.String()),
    }),
});

export type AuthResponse = Static<typeof AuthResponseSchema>;

export const JWTPayloadSchema = Type.Object({
    sub: Type.String(),
    email: Type.String(),
    iat: Type.Number(),
    exp: Type.Number(),
});

export type JWTPayload = Static<typeof JWTPayloadSchema>;

export const MagicLinkSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    email: Type.String(),
    token: Type.String(),
    expiresAt: Type.String({ format: 'date-time' }),
    createdAt: Type.String({ format: 'date-time' }),
});

export type MagicLink = Static<typeof MagicLinkSchema>;

export const ErrorResponseSchema = Type.Object({
    error: Type.String(),
    message: Type.Optional(Type.String()),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
