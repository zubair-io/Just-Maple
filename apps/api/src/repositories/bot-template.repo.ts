import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { BotTemplate, BotDefinition } from '@maple/shared';

interface BotTemplateDocument {
    _id: ObjectId;
    name: string;
    handle: string;
    description?: string;
    avatar?: string;
    definition: BotDefinition;
    requiresConfig: boolean;
    configSchema?: unknown;
    isSystemBot: boolean;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<BotTemplateDocument> {
    return getDb().collection<BotTemplateDocument>('bot_templates');
}

function toBotTemplate(doc: BotTemplateDocument): BotTemplate {
    return {
        _id: doc._id.toString(),
        name: doc.name,
        handle: doc.handle,
        description: doc.description,
        avatar: doc.avatar,
        definition: doc.definition,
        requiresConfig: doc.requiresConfig,
        configSchema: doc.configSchema,
        isSystemBot: doc.isSystemBot,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function findAllBotTemplates(): Promise<BotTemplate[]> {
    const docs = await getCollection().find({}).toArray();
    return docs.map(toBotTemplate);
}

export async function findBotTemplateById(id: string): Promise<BotTemplate | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toBotTemplate(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Batch load bot templates by IDs - single query instead of N queries
 */
export async function findBotTemplatesByIds(ids: string[]): Promise<BotTemplate[]> {
    if (ids.length === 0) return [];

    try {
        const objectIds = ids.map((id) => new ObjectId(id));
        const docs = await getCollection()
            .find({ _id: { $in: objectIds } })
            .toArray();
        return docs.map(toBotTemplate);
    } catch {
        return [];
    }
}

export async function findBotTemplateByHandle(handle: string): Promise<BotTemplate | null> {
    const doc = await getCollection().findOne({ handle: handle.toLowerCase() });
    return doc ? toBotTemplate(doc) : null;
}

export async function createBotTemplate(
    data: Omit<BotTemplate, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<BotTemplate> {
    const now = new Date();
    const doc: Omit<BotTemplateDocument, '_id'> = {
        name: data.name,
        handle: data.handle.toLowerCase(),
        description: data.description,
        avatar: data.avatar,
        definition: data.definition,
        requiresConfig: data.requiresConfig,
        configSchema: data.configSchema,
        isSystemBot: data.isSystemBot,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as BotTemplateDocument);
    return toBotTemplate({ ...doc, _id: result.insertedId } as BotTemplateDocument);
}

export async function upsertBotTemplate(
    handle: string,
    data: Omit<BotTemplate, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<BotTemplate> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        { handle: handle.toLowerCase() },
        {
            $set: {
                name: data.name,
                description: data.description,
                avatar: data.avatar,
                definition: data.definition,
                requiresConfig: data.requiresConfig,
                configSchema: data.configSchema,
                isSystemBot: data.isSystemBot,
                updatedAt: now,
            },
            $setOnInsert: {
                handle: handle.toLowerCase(),
                createdAt: now,
            },
        },
        { upsert: true, returnDocument: 'after' },
    );

    return toBotTemplate(result!);
}

export async function searchBotTemplates(query: string): Promise<BotTemplate[]> {
    const searchRegex = new RegExp(query, 'i');
    const docs = await getCollection()
        .find({
            $or: [{ handle: searchRegex }, { name: searchRegex }, { description: searchRegex }],
        })
        .limit(20)
        .toArray();
    return docs.map(toBotTemplate);
}
