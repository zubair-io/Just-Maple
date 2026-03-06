import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';

interface JsonDocumentDocument {
    _id: ObjectId;
    id: string; // Same as page.id - UUID for routing
    pageId: string; // Links to pages collection
    notebookId: string; // Denormalized for queries

    data: unknown; // Arbitrary JSON payload
    description?: string; // Human-readable description (helps AI understand the data)
    schema: unknown | null; // Optional JSON Schema for validation
    version: number; // Optimistic concurrency control

    createdAt: Date;
    updatedAt: Date;
}

export interface JsonDocumentResponse {
    _id: string;
    id: string;
    pageId: string;
    notebookId: string;
    data: unknown;
    description?: string;
    schema: unknown | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

function getCollection(): Collection<JsonDocumentDocument> {
    return getDb().collection<JsonDocumentDocument>('json_documents');
}

function toJsonDocumentResponse(doc: JsonDocumentDocument): JsonDocumentResponse {
    return {
        _id: doc._id.toString(),
        id: doc.id,
        pageId: doc.pageId,
        notebookId: doc.notebookId,
        data: doc.data,
        description: doc.description,
        schema: doc.schema ?? null,
        version: doc.version,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Create a new JSON document
 */
export async function createJsonDocument(
    id: string,
    pageId: string,
    notebookId: string,
    data?: unknown,
    schema?: unknown,
): Promise<JsonDocumentResponse> {
    const now = new Date();

    const doc: Omit<JsonDocumentDocument, '_id'> = {
        id,
        pageId,
        notebookId,
        data: data ?? {},
        schema: schema ?? null,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as JsonDocumentDocument);

    return {
        _id: result.insertedId.toString(),
        id,
        pageId,
        notebookId,
        data: doc.data,
        schema: doc.schema,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Find JSON document by its id (same as page.id UUID)
 */
export async function findJsonDocument(id: string): Promise<JsonDocumentResponse | null> {
    try {
        const doc = await getCollection().findOne({ id });
        if (!doc) return null;
        return toJsonDocumentResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Find JSON document by pageId
 */
export async function findJsonDocumentByPageId(
    pageId: string,
): Promise<JsonDocumentResponse | null> {
    try {
        const doc = await getCollection().findOne({ pageId });
        if (!doc) return null;
        return toJsonDocumentResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Replace entire JSON data payload (PUT semantics)
 * Uses optimistic concurrency control via version check
 */
export async function replaceJsonDocumentData(
    id: string,
    data: unknown,
    expectedVersion: number,
): Promise<JsonDocumentResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id, version: expectedVersion },
        {
            $set: {
                data,
                updatedAt: now,
            },
            $inc: { version: 1 },
        },
        { returnDocument: 'after' },
    );

    return result ? toJsonDocumentResponse(result) : null;
}

/**
 * Patch JSON data using JSON Merge Patch (RFC 7396)
 * Cosmos DB safe: fetches current, merges in application code, then $set
 */
export async function patchJsonDocumentData(
    id: string,
    patch: unknown,
    expectedVersion: number,
): Promise<JsonDocumentResponse | null> {
    const now = new Date();

    // Fetch current document with version check
    const current = await getCollection().findOne({ id, version: expectedVersion });
    if (!current) return null;

    // Deep merge patch into current data
    const mergedData = deepMergePatch(current.data, patch);

    const result = await getCollection().findOneAndUpdate(
        { id, version: expectedVersion },
        {
            $set: {
                data: mergedData,
                updatedAt: now,
            },
            $inc: { version: 1 },
        },
        { returnDocument: 'after' },
    );

    return result ? toJsonDocumentResponse(result) : null;
}

/**
 * Update JSON Schema for a document
 */
export async function updateJsonDocumentSchema(
    id: string,
    schema: unknown,
): Promise<JsonDocumentResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id },
        {
            $set: {
                schema,
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );

    return result ? toJsonDocumentResponse(result) : null;
}

/**
 * Remove JSON Schema from a document
 */
export async function removeJsonDocumentSchema(id: string): Promise<JsonDocumentResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id },
        {
            $set: {
                schema: null,
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );

    return result ? toJsonDocumentResponse(result) : null;
}

/**
 * Update JSON document description
 */
export async function updateJsonDocumentDescription(
    id: string,
    description: string,
): Promise<JsonDocumentResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id },
        {
            $set: {
                description,
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );

    return result ? toJsonDocumentResponse(result) : null;
}

/**
 * Delete JSON document (cascade from page deletion)
 */
export async function deleteJsonDocument(id: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ id });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Delete JSON document by pageId
 */
export async function deleteJsonDocumentByPageId(pageId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({ pageId });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Get only the version number (for cache validation)
 */
export async function getJsonDocumentVersion(id: string): Promise<number | null> {
    try {
        const doc = await getCollection().findOne({ id }, { projection: { version: 1 } });
        return doc?.version ?? null;
    } catch {
        return null;
    }
}

/**
 * Deep merge patch implementation (RFC 7396)
 * Handles nested objects, null removal, and array replacement
 */
function deepMergePatch(target: unknown, patch: unknown): unknown {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        return patch;
    }

    const result: Record<string, unknown> =
        target !== null && typeof target === 'object' && !Array.isArray(target)
            ? { ...(target as Record<string, unknown>) }
            : {};

    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
        if (value === null) {
            delete result[key];
        } else {
            result[key] = deepMergePatch(result[key], value);
        }
    }

    return result;
}
