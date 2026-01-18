import { Type, Static } from '@sinclair/typebox';

export const CollectableStatusSchema = Type.Union([
    Type.Literal('have'),
    Type.Literal('want'),
    Type.Literal('sold'),
    Type.Literal('none'),
]);

export type CollectableStatus = Static<typeof CollectableStatusSchema>;

export const CollectableDataSchema = Type.Object({
    itemId: Type.String(),
    provider: Type.String(),
    registryData: Type.Optional(Type.String()),
    status: CollectableStatusSchema,
    quantity: Type.Number({ minimum: 0 }),
    created: Type.String({ format: 'date-time' }),
});

export type CollectableData = Static<typeof CollectableDataSchema>;

export const CollectableSchema = Type.Object({
    _id: Type.String(),
    tags: Type.Array(Type.String()),
    type: Type.Literal('collectible'),
    data: CollectableDataSchema,
    createdBy: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Collectable = Static<typeof CollectableSchema>;

export const CreateCollectableSchema = Type.Object({
    tags: Type.Optional(Type.Array(Type.String())),
    data: Type.Object({
        itemId: Type.String(),
        provider: Type.String(),
        registryData: Type.Optional(Type.String()),
        status: Type.Optional(CollectableStatusSchema),
        quantity: Type.Optional(Type.Number({ minimum: 0 })),
    }),
});

export type CreateCollectableInput = Static<typeof CreateCollectableSchema>;

export const UpdateCollectableSchema = Type.Object({
    tags: Type.Optional(Type.Array(Type.String())),
    data: Type.Optional(
        Type.Object({
            itemId: Type.Optional(Type.String()),
            provider: Type.Optional(Type.String()),
            registryData: Type.Optional(Type.String()),
            status: Type.Optional(CollectableStatusSchema),
            quantity: Type.Optional(Type.Number({ minimum: 0 })),
        }),
    ),
});

export type UpdateCollectableInput = Static<typeof UpdateCollectableSchema>;
