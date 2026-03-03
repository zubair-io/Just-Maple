import { Type, Static } from '@sinclair/typebox';

// --- Connector Field Definition ---

export const ConnectorFieldDefSchema = Type.Object({
    type: Type.Union([
        Type.Literal('string'),
        Type.Literal('number'),
        Type.Literal('boolean'),
        Type.Literal('date'),
        Type.Literal('select'),
    ]),
    label: Type.String(),
    description: Type.Optional(Type.String()),
    required: Type.Optional(Type.Boolean()),
    defaultValue: Type.Optional(Type.Unknown()),
    options: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.String() }))),
});

export type ConnectorFieldDef = Static<typeof ConnectorFieldDefSchema>;

// --- Connector Manifest ---

export const ConnectorManifestSchema = Type.Object({
    connectorType: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),
    fields: Type.Record(Type.String(), ConnectorFieldDefSchema),
});

export type ConnectorManifest = Static<typeof ConnectorManifestSchema>;
