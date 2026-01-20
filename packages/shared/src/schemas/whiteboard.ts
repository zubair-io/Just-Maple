import { Type, Static } from '@sinclair/typebox';

// Tool types available in the whiteboard
export const WhiteboardToolTypeSchema = Type.Union([
    Type.Literal('select'),
    Type.Literal('pen'),
    Type.Literal('line'),
    Type.Literal('rectangle'),
    Type.Literal('ellipse'),
    Type.Literal('arrow'),
    Type.Literal('text'),
    Type.Literal('eraser'),
]);

export type WhiteboardToolType = Static<typeof WhiteboardToolTypeSchema>;

// Transform for positioning elements
export const TransformSchema = Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    rotation: Type.Optional(Type.Number({ default: 0 })),
    scaleX: Type.Optional(Type.Number({ default: 1 })),
    scaleY: Type.Optional(Type.Number({ default: 1 })),
});

export type Transform = Static<typeof TransformSchema>;

// Individual point in a stroke with pressure data
export const StrokePointSchema = Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    pressure: Type.Optional(Type.Number({ default: 0.5 })),
});

export type StrokePoint = Static<typeof StrokePointSchema>;

// Stroke style properties
export const StrokeStyleSchema = Type.Object({
    color: Type.String({ default: '#000000' }),
    size: Type.Number({ default: 4 }),
    opacity: Type.Optional(Type.Number({ default: 1 })),
});

export type StrokeStyle = Static<typeof StrokeStyleSchema>;

// Base element properties shared by all elements
export const BaseElementSchema = Type.Object({
    id: Type.String(),
    createdBy: Type.String(), // User ID
    createdAt: Type.Number(), // Timestamp
    updatedAt: Type.Number(), // Timestamp
    transform: TransformSchema,
    locked: Type.Optional(Type.Boolean({ default: false })),
});

// Freehand stroke element
export const StrokeElementSchema = Type.Composite([
    BaseElementSchema,
    Type.Object({
        type: Type.Literal('stroke'),
        points: Type.Array(StrokePointSchema),
        style: StrokeStyleSchema,
    }),
]);

export type StrokeElement = Static<typeof StrokeElementSchema>;

// Shape types
export const ShapeTypeSchema = Type.Union([
    Type.Literal('rectangle'),
    Type.Literal('ellipse'),
    Type.Literal('line'),
    Type.Literal('arrow'),
]);

export type ShapeType = Static<typeof ShapeTypeSchema>;

// Shape element (rectangle, ellipse, line, arrow)
export const ShapeElementSchema = Type.Composite([
    BaseElementSchema,
    Type.Object({
        type: Type.Literal('shape'),
        shapeType: ShapeTypeSchema,
        width: Type.Number(),
        height: Type.Number(),
        style: Type.Object({
            strokeColor: Type.String({ default: '#000000' }),
            fillColor: Type.Optional(Type.String()),
            strokeWidth: Type.Number({ default: 2 }),
            opacity: Type.Optional(Type.Number({ default: 1 })),
        }),
        // For line/arrow: start and end points relative to bounding box
        startPoint: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
        endPoint: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
    }),
]);

export type ShapeElement = Static<typeof ShapeElementSchema>;

// Text element
export const TextElementSchema = Type.Composite([
    BaseElementSchema,
    Type.Object({
        type: Type.Literal('text'),
        content: Type.String(),
        fontSize: Type.Number({ default: 16 }),
        fontFamily: Type.String({ default: 'Inter, sans-serif' }),
        color: Type.String({ default: '#000000' }),
        textAlign: Type.Optional(
            Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')]),
        ),
    }),
]);

export type TextElement = Static<typeof TextElementSchema>;

// Union of all element types
export const WhiteboardElementSchema = Type.Union([
    StrokeElementSchema,
    ShapeElementSchema,
    TextElementSchema,
]);

export type WhiteboardElement = Static<typeof WhiteboardElementSchema>;

// Layer containing multiple elements
export const LayerSchema = Type.Object({
    id: Type.String(),
    name: Type.String({ default: 'Layer 1' }),
    visible: Type.Boolean({ default: true }),
    locked: Type.Boolean({ default: false }),
    opacity: Type.Number({ default: 1 }),
    elements: Type.Array(Type.String()), // Array of element IDs (elements stored separately)
});

export type Layer = Static<typeof LayerSchema>;

// Camera/viewport state
export const CameraSchema = Type.Object({
    x: Type.Number({ default: 0 }),
    y: Type.Number({ default: 0 }),
    zoom: Type.Number({ default: 1 }),
});

export type Camera = Static<typeof CameraSchema>;

// Whiteboard metadata stored in Y.Map
export const WhiteboardMetadataSchema = Type.Object({
    camera: CameraSchema,
    activeLayerId: Type.String(),
    gridVisible: Type.Optional(Type.Boolean({ default: false })),
    snapToGrid: Type.Optional(Type.Boolean({ default: false })),
    gridSize: Type.Optional(Type.Number({ default: 20 })),
});

export type WhiteboardMetadata = Static<typeof WhiteboardMetadataSchema>;

// Awareness state for collaborative cursors and pending strokes
export const WhiteboardAwarenessStateSchema = Type.Object({
    user: Type.Optional(
        Type.Object({
            id: Type.String(),
            name: Type.String(),
            color: Type.String(),
        }),
    ),
    cursor: Type.Optional(
        Type.Object({
            x: Type.Number(),
            y: Type.Number(),
        }),
    ),
    selectedIds: Type.Optional(Type.Array(Type.String())),
    activeTool: Type.Optional(WhiteboardToolTypeSchema),
    // Pending stroke being drawn (for real-time collaboration)
    pendingStroke: Type.Optional(
        Type.Object({
            points: Type.Array(
                Type.Object({
                    x: Type.Number(),
                    y: Type.Number(),
                    pressure: Type.Optional(Type.Number()),
                }),
            ),
            color: Type.String(),
            size: Type.Number(),
        }),
    ),
    // Pending shape being drawn (for real-time collaboration)
    pendingShape: Type.Optional(
        Type.Object({
            type: ShapeTypeSchema,
            startPoint: Type.Object({ x: Type.Number(), y: Type.Number() }),
            endPoint: Type.Object({ x: Type.Number(), y: Type.Number() }),
            style: Type.Object({
                strokeColor: Type.String(),
                strokeWidth: Type.Number(),
            }),
        }),
    ),
});

export type WhiteboardAwarenessState = Static<typeof WhiteboardAwarenessStateSchema>;
