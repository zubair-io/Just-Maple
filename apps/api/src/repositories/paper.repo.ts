import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Paper,
    CreatePaperInput,
    UpdatePaperInput,
    PaperData,
    PaperStatus,
} from '@maple/shared';
import { findTagsByUserId, findTagByIdWithAccess } from './tag.repo';

interface PaperDocument {
    _id: ObjectId;
    tags: ObjectId[];
    type: 'collectible';
    data: {
        itemId: string;
        provider: string;
        registryData?: ObjectId;
        status: PaperStatus;
        quantity: number;
        created?: Date;
    };
    createdBy: ObjectId | string;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<PaperDocument> {
    return getDb().collection<PaperDocument>('paper');
}

function toPaperResponse(doc: PaperDocument): Paper {
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

export async function findPapersByUserId(
    userId: string,
    options?: {
        tagId?: string;
        status?: PaperStatus;
    },
): Promise<Paper[]> {
    // If specific tagId is provided, verify access first
    if (options?.tagId) {
        const tag = await findTagByIdWithAccess(options.tagId, userId, 'read');
        if (!tag) {
            return []; // No access to this tag
        }

        const query: Record<string, unknown> = {
            tags: new ObjectId(options.tagId),
        };

        if (options?.status) {
            query['data.status'] = options.status;
        }

        const docs = await getCollection().find(query).sort({ updatedAt: -1 }).toArray();
        return docs.map(toPaperResponse);
    }

    // No specific tag - get all papers user has access to
    // 1. Get all tags the user has access to
    const accessibleTags = await findTagsByUserId(userId);
    const tagIds = accessibleTags.map((t) => new ObjectId(t._id));

    // 2. Find papers that:
    //    - Have at least one tag the user has access to, OR
    //    - Have no tags AND belong to the user (createdBy)
    const query: Record<string, unknown> = {
        $or: [
            { tags: { $in: tagIds } }, // Papers in accessible tags
            { tags: { $size: 0 }, createdBy: new ObjectId(userId) }, // User's untagged papers
        ],
    };

    if (options?.status) {
        query['data.status'] = options.status;
    }

    const docs = await getCollection().find(query).sort({ updatedAt: -1 }).toArray();
    return docs.map(toPaperResponse);
}

export async function findPaperById(id: string, userId: string): Promise<Paper | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check access based on tags or ownership
        if (doc.tags.length > 0) {
            // Paper has tags - check if user has access to any of them
            let hasAccess = false;
            for (const tagId of doc.tags) {
                const tag = await findTagByIdWithAccess(tagId.toString(), userId, 'read');
                if (tag) {
                    hasAccess = true;
                    break;
                }
            }
            if (!hasAccess) return null;
        } else {
            // Paper has no tags - only creator can access
            if (doc.createdBy.toString() !== userId) return null;
        }

        return toPaperResponse(doc);
    } catch {
        return null;
    }
}

export async function createPaper(userId: string, data: CreatePaperInput): Promise<Paper> {
    const now = new Date();
    const doc: Omit<PaperDocument, '_id'> = {
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

    const result = await getCollection().insertOne(doc as PaperDocument);

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

export async function updatePaper(
    id: string,
    userId: string,
    data: UpdatePaperInput,
): Promise<Paper | null> {
    try {
        // First, find the paper to check access
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return null;

        // Check write access based on tags or ownership
        if (doc.tags.length > 0) {
            // Paper has tags - check if user has write access to any of them
            let hasWriteAccess = false;
            for (const tagId of doc.tags) {
                const tag = await findTagByIdWithAccess(tagId.toString(), userId, 'write');
                if (tag) {
                    hasWriteAccess = true;
                    break;
                }
            }
            if (!hasWriteAccess) return null;
        } else {
            // Paper has no tags - only creator can update
            if (doc.createdBy.toString() !== userId) return null;
        }

        // If adding new tags, verify write access to those tags
        if (data.tags !== undefined) {
            for (const tagId of data.tags) {
                const tag = await findTagByIdWithAccess(tagId, userId, 'write');
                if (!tag) return null; // No write access to new tag
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

        return result ? toPaperResponse(result) : null;
    } catch {
        return null;
    }
}

export async function deletePaper(id: string, userId: string): Promise<boolean> {
    try {
        // First, find the paper to check access
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        if (!doc) return false;

        // Check write access based on tags or ownership
        if (doc.tags.length > 0) {
            // Paper has tags - check if user has write access to any of them
            let hasWriteAccess = false;
            for (const tagId of doc.tags) {
                const tag = await findTagByIdWithAccess(tagId.toString(), userId, 'write');
                if (tag) {
                    hasWriteAccess = true;
                    break;
                }
            }
            if (!hasWriteAccess) return false;
        } else {
            // Paper has no tags - only creator can delete
            if (doc.createdBy.toString() !== userId) return false;
        }

        const result = await getCollection().deleteOne({ _id: new ObjectId(id) });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}
