import { Type, Static } from '@sinclair/typebox';

export const RegistryTagSchema = Type.Object({
    type: Type.String(),
    value: Type.String(),
    label: Type.String(),
});

export type RegistryTag = Static<typeof RegistryTagSchema>;

export const CollectibleRegistrySchema = Type.Object({
    _id: Type.String(),
    title: Type.String(),
    description: Type.Optional(Type.Any()), // ProseMirror JSON
    images: Type.Array(Type.String()),
    providerId: Type.String(),
    provider: Type.String(),
    tags: Type.Array(RegistryTagSchema),
    providerData: Type.Optional(Type.Any()),
    upc: Type.Optional(Type.String()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type CollectibleRegistry = Static<typeof CollectibleRegistrySchema>;
