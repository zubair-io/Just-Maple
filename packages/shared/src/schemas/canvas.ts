import { Type, Static } from '@sinclair/typebox';
import { ConnectorFieldDefSchema } from './connector-manifest';
import { WidgetTemplateSchema } from './atoms';

// --- Connector Scope ---

export const CanvasConnectorScopeSchema = Type.Object({
    notebookIds: Type.Optional(Type.Array(Type.String())),
    tagIds: Type.Optional(Type.Array(Type.String())),
});

export type CanvasConnectorScope = Static<typeof CanvasConnectorScopeSchema>;

// --- Canvas Connector ---

export const CanvasConnectorSchema = Type.Object({
    connectorId: Type.String(),
    connectorType: Type.String(),
    enabled: Type.Boolean(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    scope: Type.Optional(CanvasConnectorScopeSchema),
    authRef: Type.Optional(Type.String()),
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    fields: Type.Record(Type.String(), ConnectorFieldDefSchema),
});

export type CanvasConnector = Static<typeof CanvasConnectorSchema>;

// --- Canvas Widget ---

export const CanvasWidgetSchema = Type.Object({
    id: Type.String(),
    connectorId: Type.Optional(Type.String()),
    createdAt: Type.String({ format: 'date-time' }),
    pollInterval: Type.Optional(Type.Number()),
    template: WidgetTemplateSchema,
    initialData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    position: Type.Optional(
        Type.Object({
            x: Type.Number(),
            y: Type.Number(),
            w: Type.Number(),
            h: Type.Number(),
        }),
    ),
});

export type CanvasWidget = Static<typeof CanvasWidgetSchema>;

// --- Canvas Document ---

export const CanvasSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(),
    notebookId: Type.String(),
    userId: Type.String(),
    connectors: Type.Array(CanvasConnectorSchema),
    widgets: Type.Array(CanvasWidgetSchema),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Canvas = Static<typeof CanvasSchema>;
