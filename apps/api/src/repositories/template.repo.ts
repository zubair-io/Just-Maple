import { ObjectId, Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type {
    Template,
    TemplateCategory,
    CreateTemplateInput,
    UpdateTemplateInput,
    PageContent,
} from '@maple/shared';

interface TemplateDocument {
    _id: ObjectId;
    id: string;
    userId: ObjectId | null; // null = system template
    title: string;
    description: string;
    category: TemplateCategory;
    content: PageContent;
    icon?: string;
    isSystem: boolean;
    usageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<TemplateDocument> {
    return getDb().collection<TemplateDocument>('templates');
}

function toTemplateResponse(doc: TemplateDocument): Template {
    return {
        id: doc.id,
        userId: doc.userId?.toHexString() ?? null,
        title: doc.title,
        description: doc.description,
        category: doc.category,
        content: doc.content,
        icon: doc.icon,
        isSystem: doc.isSystem,
        usageCount: doc.usageCount,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Sort templates: system first, then by updatedAt descending
 * Note: Cosmos DB doesn't support $or with sorting, so we sort in application code
 */
function sortTemplates(docs: TemplateDocument[]): TemplateDocument[] {
    return docs.sort((a, b) => {
        // System templates first
        if (a.isSystem !== b.isSystem) {
            return a.isSystem ? -1 : 1;
        }
        // Then by updatedAt descending
        return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
}

/**
 * Get all templates (system + user's custom)
 */
export async function findTemplates(userId: string): Promise<Template[]> {
    const collection = getCollection();
    // Note: Cosmos DB doesn't support $or with sorting, so we fetch without sort
    const docs = await collection
        .find({
            $or: [{ isSystem: true }, { userId: new ObjectId(userId) }],
        })
        .toArray();
    return sortTemplates(docs).map(toTemplateResponse);
}

/**
 * Get templates filtered by category
 */
export async function findTemplatesByCategory(
    userId: string,
    category: TemplateCategory,
): Promise<Template[]> {
    const collection = getCollection();
    // Note: Cosmos DB doesn't support $or with sorting, so we fetch without sort
    const docs = await collection
        .find({
            category,
            $or: [{ isSystem: true }, { userId: new ObjectId(userId) }],
        })
        .toArray();
    return sortTemplates(docs).map(toTemplateResponse);
}

/**
 * Get template by ID
 */
export async function findTemplateById(id: string): Promise<Template | null> {
    const collection = getCollection();
    const doc = await collection.findOne({ id });
    return doc ? toTemplateResponse(doc) : null;
}

/**
 * Create custom template
 */
export async function createTemplate(userId: string, data: CreateTemplateInput): Promise<Template> {
    const collection = getCollection();
    const now = new Date();
    const doc: TemplateDocument = {
        _id: new ObjectId(),
        id: randomUUID(),
        userId: new ObjectId(userId),
        title: data.title,
        description: data.description ?? '',
        category: data.category ?? 'custom',
        content: data.content ?? { type: 'doc', content: [] },
        icon: data.icon,
        isSystem: false,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    await collection.insertOne(doc);
    return toTemplateResponse(doc);
}

/**
 * Create system template (for seeding)
 */
export async function createSystemTemplate(data: {
    title: string;
    description: string;
    category: TemplateCategory;
    content: PageContent;
    icon?: string;
}): Promise<Template> {
    const collection = getCollection();
    const now = new Date();

    // Check if system template with this title already exists
    const existing = await collection.findOne({ title: data.title, isSystem: true });
    if (existing) {
        return toTemplateResponse(existing);
    }

    const doc: TemplateDocument = {
        _id: new ObjectId(),
        id: randomUUID(),
        userId: null,
        title: data.title,
        description: data.description,
        category: data.category,
        content: data.content,
        icon: data.icon,
        isSystem: true,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    await collection.insertOne(doc);
    return toTemplateResponse(doc);
}

/**
 * Update template (only owner can update)
 */
export async function updateTemplate(
    id: string,
    userId: string,
    data: UpdateTemplateInput,
): Promise<Template | null> {
    const collection = getCollection();

    const updateData: Partial<TemplateDocument> = {
        updatedAt: new Date(),
    };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.content !== undefined) updateData.content = data.content;

    const result = await collection.findOneAndUpdate(
        { id, userId: new ObjectId(userId), isSystem: false },
        { $set: updateData },
        { returnDocument: 'after' },
    );
    return result ? toTemplateResponse(result) : null;
}

/**
 * Delete template (only owner can delete)
 */
export async function deleteTemplate(id: string, userId: string): Promise<boolean> {
    const collection = getCollection();
    const result = await collection.deleteOne({
        id,
        userId: new ObjectId(userId),
        isSystem: false,
    });
    return result.deletedCount === 1;
}

/**
 * Increment usage count when template is used
 */
export async function incrementUsageCount(id: string): Promise<void> {
    const collection = getCollection();
    await collection.updateOne({ id }, { $inc: { usageCount: 1 } });
}

/**
 * Ensure indexes exist for templates collection
 */
export async function ensureTemplateIndexes(): Promise<void> {
    const collection = getCollection();
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ userId: 1, updatedAt: -1 });
    await collection.createIndex({ isSystem: 1 });
    await collection.createIndex({ category: 1 });
}
