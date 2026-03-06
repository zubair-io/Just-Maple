import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { CanvasWidget, CanvasConnector } from '@maple/shared';

interface CanvasDocument {
    _id: ObjectId;
    id: string; // Same as page.id — UUID v4
    notebookId: string;
    userId: string;
    connectors: CanvasConnector[];
    widgets: CanvasWidget[];
    createdAt: Date;
    updatedAt: Date;
}

export interface CanvasResponse {
    _id: string;
    id: string;
    notebookId: string;
    userId: string;
    connectors: CanvasConnector[];
    widgets: CanvasWidget[];
    createdAt: string;
    updatedAt: string;
}

function getCollection(): Collection<CanvasDocument> {
    return getDb().collection<CanvasDocument>('canvases');
}

function toCanvasResponse(doc: CanvasDocument): CanvasResponse {
    return {
        _id: doc._id.toString(),
        id: doc.id,
        notebookId: doc.notebookId,
        userId: doc.userId,
        connectors: doc.connectors,
        widgets: doc.widgets,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Find canvas by page ID
 */
export async function findCanvasById(id: string): Promise<CanvasResponse | null> {
    try {
        const doc = await getCollection().findOne({ id });
        if (!doc) return null;
        return toCanvasResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Find or create canvas for a page.
 * Auto-creates an empty canvas on first load.
 */
export async function findOrCreateCanvas(
    pageId: string,
    notebookId: string,
    userId: string,
): Promise<CanvasResponse> {
    const existing = await getCollection().findOne({ id: pageId });
    if (existing) return toCanvasResponse(existing);

    const now = new Date();
    const doc: Omit<CanvasDocument, '_id'> = {
        id: pageId,
        notebookId,
        userId,
        connectors: [],
        widgets: [],
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as CanvasDocument);

    return {
        _id: result.insertedId.toString(),
        id: pageId,
        notebookId,
        userId,
        connectors: [],
        widgets: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Update canvas fields
 */
export async function updateCanvas(
    id: string,
    update: Partial<Pick<CanvasResponse, 'widgets' | 'connectors'>>,
): Promise<CanvasResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id },
        {
            $set: {
                ...update,
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );

    return result ? toCanvasResponse(result) : null;
}

/**
 * Add a widget to the canvas
 */
export async function addWidget(
    canvasId: string,
    widget: CanvasWidget,
): Promise<CanvasResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id: canvasId },
        {
            $push: { widgets: widget },
            $set: { updatedAt: now },
        },
        { returnDocument: 'after' },
    );

    return result ? toCanvasResponse(result) : null;
}

/**
 * Update a specific widget within a canvas
 */
export async function updateWidget(
    canvasId: string,
    widgetId: string,
    update: Partial<CanvasWidget>,
): Promise<CanvasResponse | null> {
    const now = new Date();

    // Fetch current canvas to find and update widget
    const canvas = await getCollection().findOne({ id: canvasId });
    if (!canvas) return null;

    const widgetIndex = canvas.widgets.findIndex((w) => w.id === widgetId);
    if (widgetIndex === -1) return null;

    // Build $set fields for widget update
    const setFields: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(update)) {
        setFields[`widgets.${widgetIndex}.${key}`] = value;
    }

    const result = await getCollection().findOneAndUpdate(
        { id: canvasId },
        { $set: setFields },
        { returnDocument: 'after' },
    );

    return result ? toCanvasResponse(result) : null;
}

/**
 * Remove a widget from the canvas
 */
export async function removeWidget(
    canvasId: string,
    widgetId: string,
): Promise<CanvasResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id: canvasId },
        {
            $pull: { widgets: { id: widgetId } },
            $set: { updatedAt: now },
        },
        { returnDocument: 'after' },
    );

    return result ? toCanvasResponse(result) : null;
}

/**
 * Add a connector to the canvas
 */
export async function addConnector(
    canvasId: string,
    connector: CanvasConnector,
): Promise<CanvasResponse | null> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { id: canvasId },
        {
            $push: { connectors: connector },
            $set: { updatedAt: now },
        },
        { returnDocument: 'after' },
    );

    return result ? toCanvasResponse(result) : null;
}
