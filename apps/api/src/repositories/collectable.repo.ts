import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Collectable,
    CreateCollectableInput,
    UpdateCollectableInput,
    CollectableData,
    CollectableStatus,
} from '@maple/shared';
import { findNotebooksByUserId, findNotebookByIdWithAccess } from './notebook.repo';

interface CollectableDocument {
    _id: ObjectId;
    tags: ObjectId[];
    type: 'collectible';
    data: {
        itemId: string;
        provider: string;
        registryData?: ObjectId;
        status: CollectableStatus;
        quantity: number;
        created?: Date;
    };
    createdBy: ObjectId | string;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<CollectableDocument> {
    return getDb().collection<CollectableDocument>('collectables');
}

function toCollectableResponse(doc: CollectableDocument): Collectable {
    return {
        _id: doc._id.toString(),
        tags: doc.tags?.map((t) => t.toString()) ?? [],
        type: doc.type ?? 'collectible',
        data: {
            itemId: doc.data?.itemId ?? '',
            provider: doc.data?.provider ?? '',
            registryData: doc.data?.registryData?.toString(),
            status: doc.data?.status ?? 'want',
            quantity: doc.data?.quantity ?? 1,
            created:
                doc.data?.created?.toISOString() ??
                doc.createdAt?.toISOString() ??
                new Date().toISOString(),
        },
        createdBy:
            typeof doc.createdBy === 'string' ? doc.createdBy : (doc.createdBy?.toString() ?? ''),
        createdAt: doc.createdAt?.toISOString() ?? new Date().toISOString(),
        updatedAt: doc.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
}

export async function findCollectablesByUserId(
    userId: string,
    options?: {
        notebookId?: string;
        status?: CollectableStatus;
        updatedAfter?: string;
    },
): Promise<Collectable[]> {
    // If specific notebookId is provided, verify access first
    if (options?.notebookId) {
        const notebook = await findNotebookByIdWithAccess(options.notebookId, userId, 'read');
        if (!notebook) {
            return []; // No access to this notebook
        }

        const query: Record<string, unknown> = {
            tags: new ObjectId(options.notebookId),
        };

        if (options?.status) {
            query['data.status'] = options.status;
        }

        // Incremental sync: only return collectables updated after the given timestamp
        if (options?.updatedAfter) {
            query.updatedAt = { $gt: new Date(options.updatedAfter) };
        }

        const docs = await getCollection().find(query).sort({ updatedAt: -1 }).toArray();
        return docs.map(toCollectableResponse);
    }

    // No specific notebook - get all collectables user has access to
    // 1. Get all notebooks the user has access to
    const accessibleNotebooks = await findNotebooksByUserId(userId);
    const notebookIds = accessibleNotebooks.map((t) => new ObjectId(t._id));

    // 2. Find collectables that:
    //    - Have at least one tag the user has access to, OR
    //    - Have no tags AND belong to the user (createdBy)
    const query: Record<string, unknown> = {
        $or: [
            { tags: { $in: notebookIds } }, // Collectables in accessible notebooks
            { tags: { $size: 0 }, createdBy: new ObjectId(userId) }, // User's untagged collectables
        ],
    };

    if (options?.status) {
        query['data.status'] = options.status;
    }

    // Incremental sync: only return collectables updated after the given timestamp
    if (options?.updatedAfter) {
        query.updatedAt = { $gt: new Date(options.updatedAfter) };
    }

    const docs = await getCollection().find(query).sort({ updatedAt: -1 }).toArray();
    return docs.map(toCollectableResponse);
}

export async function findCollectableById(id: string, userId: string): Promise<Collectable | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check access based on tags or ownership
        if (doc.tags.length > 0) {
            // Collectable has tags - check if user has access to any of them
            let hasAccess = false;
            for (const notebookId of doc.tags) {
                const notebook = await findNotebookByIdWithAccess(
                    notebookId.toString(),
                    userId,
                    'read',
                );
                if (notebook) {
                    hasAccess = true;
                    break;
                }
            }
            if (!hasAccess) return null;
        } else {
            // Collectable has no tags - only creator can access
            if (doc.createdBy.toString() !== userId) return null;
        }

        return toCollectableResponse(doc);
    } catch {
        return null;
    }
}

export async function createCollectable(
    userId: string,
    data: CreateCollectableInput,
): Promise<Collectable> {
    const now = new Date();
    const doc: Omit<CollectableDocument, '_id'> = {
        tags: data.tags?.map((t) => new ObjectId(t)) || [],
        type: 'collectible',
        data: {
            itemId: data.data.itemId,
            provider: data.data.provider,
            registryData: data.data.registryData ? new ObjectId(data.data.registryData) : undefined,
            status: data.data.status || 'have',
            quantity: data.data.quantity ?? 1,
            created: now,
        },
        createdBy: new ObjectId(userId),
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as CollectableDocument);

    return {
        _id: result.insertedId.toString(),
        tags: data.tags || [],
        type: 'collectible',
        data: {
            itemId: data.data.itemId,
            provider: data.data.provider,
            registryData: data.data.registryData,
            status: data.data.status || 'have',
            quantity: data.data.quantity ?? 1,
            created: now.toISOString(),
        },
        createdBy: userId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export async function updateCollectable(
    id: string,
    userId: string,
    data: UpdateCollectableInput,
): Promise<Collectable | null> {
    try {
        // First, find the collectable to check access
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check write access based on tags or ownership
        if (doc.tags.length > 0) {
            // Collectable has tags - check if user has write access to any of them
            let hasWriteAccess = false;
            for (const notebookId of doc.tags) {
                const notebook = await findNotebookByIdWithAccess(
                    notebookId.toString(),
                    userId,
                    'write',
                );
                if (notebook) {
                    hasWriteAccess = true;
                    break;
                }
            }
            if (!hasWriteAccess) return null;
        } else {
            // Collectable has no tags - only creator can update
            if (doc.createdBy.toString() !== userId) return null;
        }

        // If adding new tags, verify write access to those notebooks
        if (data.tags !== undefined) {
            for (const notebookId of data.tags) {
                const notebook = await findNotebookByIdWithAccess(notebookId, userId, 'write');
                if (!notebook) return null; // No write access to new notebook
            }
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (data.tags !== undefined) {
            updateData.tags = data.tags.map((t) => new ObjectId(t));
        }
        if (data.data) {
            if (data.data.itemId !== undefined) {
                updateData['data.itemId'] = data.data.itemId;
            }
            if (data.data.provider !== undefined) {
                updateData['data.provider'] = data.data.provider;
            }
            if (data.data.registryData !== undefined) {
                updateData['data.registryData'] = new ObjectId(data.data.registryData);
            }
            if (data.data.status !== undefined) {
                updateData['data.status'] = data.data.status;
            }
            if (data.data.quantity !== undefined) {
                updateData['data.quantity'] = data.data.quantity;
            }
        }

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateData },
            { returnDocument: 'after' },
        );

        return result ? toCollectableResponse(result) : null;
    } catch {
        return null;
    }
}

export async function findCollectableByRegistryData(
    registryId: string,
    notebookId: string,
    userId: string,
): Promise<Collectable | null> {
    try {
        // Verify user has access to the notebook
        const notebook = await findNotebookByIdWithAccess(notebookId, userId, 'read');
        if (!notebook) return null;

        const doc = await getCollection().findOne({
            'data.registryData': new ObjectId(registryId),
            tags: new ObjectId(notebookId),
        });

        if (!doc) return null;

        return toCollectableResponse(doc);
    } catch {
        return null;
    }
}

export async function deleteCollectable(id: string, userId: string): Promise<boolean> {
    try {
        // First, find the collectable to check access
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return false;

        // Check write access based on tags or ownership
        if (doc.tags.length > 0) {
            // Collectable has tags - check if user has write access to any of them
            let hasWriteAccess = false;
            for (const notebookId of doc.tags) {
                const notebook = await findNotebookByIdWithAccess(
                    notebookId.toString(),
                    userId,
                    'write',
                );
                if (notebook) {
                    hasWriteAccess = true;
                    break;
                }
            }
            if (!hasWriteAccess) return false;
        } else {
            // Collectable has no tags - only creator can delete
            if (doc.createdBy.toString() !== userId) return false;
        }

        const result = await getCollection().deleteOne({ _id: new ObjectId(id) });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}
