import { Type, Static } from '@sinclair/typebox';

// JSON document stored alongside a JSON-type page
export const JsonDocumentSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // Same as page.id - UUID for routing
    pageId: Type.String(), // Links to pages collection
    notebookId: Type.String(), // Denormalized for queries
    data: Type.Unknown(), // Arbitrary JSON payload
    description: Type.Optional(Type.String({ maxLength: 500 })), // Human-readable description (helps AI understand the data)
    schema: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])), // Optional JSON Schema for validation
    version: Type.Number(), // Optimistic concurrency control
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type JsonDocument = Static<typeof JsonDocumentSchema>;

// Input for creating a JSON document
export const CreateJsonDocumentSchema = Type.Object({
    data: Type.Optional(Type.Unknown()),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    schema: Type.Optional(Type.Unknown()),
});

// Input for updating JSON document description
export const UpdateJsonDescriptionSchema = Type.Object({
    description: Type.String({ maxLength: 500 }),
});

export type UpdateJsonDescriptionInput = Static<typeof UpdateJsonDescriptionSchema>;

export type CreateJsonDocumentInput = Static<typeof CreateJsonDocumentSchema>;

// Input for replacing JSON data (PUT)
export const ReplaceJsonDataSchema = Type.Object({
    data: Type.Unknown(),
    version: Type.Number(), // Required for optimistic concurrency
});

export type ReplaceJsonDataInput = Static<typeof ReplaceJsonDataSchema>;

// Input for patching JSON data (PATCH - JSON Merge Patch RFC 7396)
export const PatchJsonDataSchema = Type.Object({
    patch: Type.Unknown(),
    version: Type.Number(), // Required for optimistic concurrency
});

export type PatchJsonDataInput = Static<typeof PatchJsonDataSchema>;

// Input for setting JSON Schema
export const SetJsonSchemaSchema = Type.Object({
    schema: Type.Unknown(),
});

export type SetJsonSchemaInput = Static<typeof SetJsonSchemaSchema>;
