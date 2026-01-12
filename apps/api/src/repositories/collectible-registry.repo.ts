import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { CollectibleRegistry, RegistryTag } from '@maple/shared';

interface CollectibleRegistryDocument {
    _id: ObjectId;
    title: string;
    description?: unknown;
    images: string[];
    providerId: string;
    provider: string;
    tags: RegistryTag[];
    providerData?: unknown;
    upc?: string;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<CollectibleRegistryDocument> {
    return getDb().collection<CollectibleRegistryDocument>('collectibleregistries');
}

function toRegistryResponse(doc: CollectibleRegistryDocument): CollectibleRegistry {
    return {
        _id: doc._id.toString(),
        title: doc.title,
        description: doc.description,
        images: doc.images,
        providerId: doc.providerId,
        provider: doc.provider,
        tags: doc.tags,
        providerData: doc.providerData,
        upc: doc.upc,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function findAllRegistries(options?: {
    provider?: string;
    limit?: number;
    offset?: number;
    updatedAt?: string; // ISO timestamp - only return items updated after this
}): Promise<CollectibleRegistry[]> {
    const query: Record<string, unknown> = {};

    if (options?.provider) {
        query.provider = options.provider;
    }

    // Incremental sync - only return items updated after the given timestamp
    if (options?.updatedAt) {
        query.updatedAt = { $gt: new Date(options.updatedAt) };
    }

    let cursor = getCollection().find(query).sort({ updatedAt: -1 });

    if (options?.offset) {
        cursor = cursor.skip(options.offset);
    }
    if (options?.limit) {
        cursor = cursor.limit(options.limit);
    }

    const docs = await cursor.toArray();
    return docs.map(toRegistryResponse);
}

export async function findRegistryById(id: string): Promise<CollectibleRegistry | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toRegistryResponse(doc) : null;
    } catch {
        return null;
    }
}

export async function findRegistryByUpc(upc: string): Promise<CollectibleRegistry | null> {
    const doc = await getCollection().findOne({ upc });
    return doc ? toRegistryResponse(doc) : null;
}

export async function findRegistryByProviderId(
    provider: string,
    providerId: string,
): Promise<CollectibleRegistry | null> {
    const doc = await getCollection().findOne({ provider, providerId });
    return doc ? toRegistryResponse(doc) : null;
}

export async function searchRegistries(
    query: string,
    options?: {
        provider?: string;
        limit?: number;
    },
): Promise<CollectibleRegistry[]> {
    const filter: Record<string, unknown> = {
        $or: [
            { title: { $regex: query, $options: 'i' } },
            { providerId: { $regex: query, $options: 'i' } },
            { upc: query },
        ],
    };

    if (options?.provider) {
        filter.provider = options.provider;
    }

    let cursor = getCollection().find(filter).sort({ title: 1 });

    if (options?.limit) {
        cursor = cursor.limit(options.limit);
    }

    const docs = await cursor.toArray();
    return docs.map(toRegistryResponse);
}

export async function createRegistry(
    data: Omit<CollectibleRegistry, '_id'> & { _id: string },
): Promise<CollectibleRegistry> {
    const doc: CollectibleRegistryDocument = {
        _id: new ObjectId(data._id),
        title: data.title,
        description: data.description,
        images: data.images,
        providerId: data.providerId,
        provider: data.provider,
        tags: data.tags,
        providerData: data.providerData,
        upc: data.upc,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
    };

    await getCollection().insertOne(doc);
    return toRegistryResponse(doc);
}

export async function updateRegistry(
    id: string,
    data: Partial<Omit<CollectibleRegistry, '_id' | 'createdAt' | 'updatedAt'>>,
): Promise<CollectibleRegistry | null> {
    const updateDoc: Partial<CollectibleRegistryDocument> = {
        ...data,
        updatedAt: new Date(),
    };

    const result = await getCollection().findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateDoc },
        { returnDocument: 'after' },
    );

    return result ? toRegistryResponse(result) : null;
}
