import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Tag, CreateTagInput, UpdateTagInput } from '@maple/shared';

interface TagDocument {
    _id: ObjectId;
    userId: ObjectId;
    type: 'folder';
    value: string;
    label: string;
    color?: string;
    parentId?: ObjectId;
    order?: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<TagDocument> {
    return getDb().collection<TagDocument>('tags');
}

function toTagResponse(doc: TagDocument): Tag {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        type: doc.type,
        value: doc.value,
        label: doc.label,
        color: doc.color,
        parentId: doc.parentId?.toString(),
        order: doc.order,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

function labelToSlug(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

export async function findTagsByUserId(userId: string): Promise<Tag[]> {
    const docs = await getCollection()
        .find({ userId: new ObjectId(userId) })
        .sort({ order: 1, label: 1 })
        .toArray();
    return docs.map(toTagResponse);
}

export async function findTagById(id: string, userId: string): Promise<Tag | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });
        return doc ? toTagResponse(doc) : null;
    } catch {
        return null;
    }
}

export async function createTag(userId: string, data: CreateTagInput): Promise<Tag> {
    const now = new Date();
    const doc: Omit<TagDocument, '_id'> = {
        userId: new ObjectId(userId),
        type: 'folder',
        value: labelToSlug(data.label),
        label: data.label,
        color: data.color,
        parentId: data.parentId ? new ObjectId(data.parentId) : undefined,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as TagDocument);

    return {
        _id: result.insertedId.toString(),
        userId: userId,
        type: 'folder',
        value: doc.value,
        label: doc.label,
        color: doc.color,
        parentId: data.parentId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export async function updateTag(
    id: string,
    userId: string,
    data: UpdateTagInput,
): Promise<Tag | null> {
    const updateData: Partial<TagDocument> = {
        updatedAt: new Date(),
    };

    if (data.label !== undefined) {
        updateData.label = data.label;
        updateData.value = labelToSlug(data.label);
    }
    if (data.color !== undefined) {
        updateData.color = data.color;
    }
    if (data.parentId !== undefined) {
        updateData.parentId = data.parentId ? new ObjectId(data.parentId) : undefined;
    }
    if (data.order !== undefined) {
        updateData.order = data.order;
    }

    try {
        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id), userId: new ObjectId(userId) },
            { $set: updateData },
            { returnDocument: 'after' },
        );

        return result ? toTagResponse(result) : null;
    } catch {
        return null;
    }
}

export async function deleteTag(id: string, userId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}
