import { Type, Static } from '@sinclair/typebox';

export const PaperStatusSchema = Type.Union([
    Type.Literal('have'),
    Type.Literal('want'),
    Type.Literal('sold'),
    Type.Literal('none'),
]);

export type PaperStatus = Static<typeof PaperStatusSchema>;

export const PaperDataSchema = Type.Object({
    itemId: Type.String(),
    provider: Type.String(),
    registryData: Type.Optional(Type.String()),
    status: PaperStatusSchema,
    quantity: Type.Number({ minimum: 0 }),
    created: Type.String({ format: 'date-time' }),
});

export type PaperData = Static<typeof PaperDataSchema>;

export const PaperSchema = Type.Object({
    _id: Type.String(),
    tags: Type.Array(Type.String()),
    type: Type.Literal('collectible'),
    data: PaperDataSchema,
    createdBy: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Paper = Static<typeof PaperSchema>;

export const CreatePaperSchema = Type.Object({
    tags: Type.Optional(Type.Array(Type.String())),
    data: Type.Object({
        itemId: Type.String(),
        provider: Type.String(),
        registryData: Type.Optional(Type.String()),
        status: Type.Optional(PaperStatusSchema),
        quantity: Type.Optional(Type.Number({ minimum: 0 })),
    }),
});

export type CreatePaperInput = Static<typeof CreatePaperSchema>;

export const UpdatePaperSchema = Type.Object({
    tags: Type.Optional(Type.Array(Type.String())),
    data: Type.Optional(
        Type.Object({
            itemId: Type.Optional(Type.String()),
            provider: Type.Optional(Type.String()),
            registryData: Type.Optional(Type.String()),
            status: Type.Optional(PaperStatusSchema),
            quantity: Type.Optional(Type.Number({ minimum: 0 })),
        }),
    ),
});

export type UpdatePaperInput = Static<typeof UpdatePaperSchema>;
