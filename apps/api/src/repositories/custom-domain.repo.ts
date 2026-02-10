import { ObjectId, Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type { CustomDomain, CreateCustomDomainInput, DomainStatus, SslStatus } from '@maple/shared';

interface CustomDomainDocument {
    _id: ObjectId;
    notebookId: ObjectId;
    domain: string;
    status: DomainStatus;
    verificationMethod: 'cname' | 'txt';
    verificationToken: string;
    sslStatus: SslStatus;
    createdAt: Date;
    verifiedAt?: Date;
    userId: ObjectId;
}

function getCollection(): Collection<CustomDomainDocument> {
    return getDb().collection<CustomDomainDocument>('custom_domains');
}

function toDomainResponse(doc: CustomDomainDocument): CustomDomain {
    return {
        _id: doc._id.toString(),
        notebookId: doc.notebookId.toString(),
        domain: doc.domain,
        status: doc.status,
        verificationMethod: doc.verificationMethod,
        verificationToken: doc.verificationToken,
        sslStatus: doc.sslStatus,
        createdAt: doc.createdAt.toISOString(),
        verifiedAt: doc.verifiedAt?.toISOString(),
        userId: doc.userId.toString(),
    };
}

/**
 * Generate a verification token for domain ownership verification
 */
function generateVerificationToken(): string {
    return `maple-verify-${randomUUID().replace(/-/g, '')}`;
}

/**
 * Create a custom domain record for a notebook
 */
export async function createCustomDomain(
    notebookId: string,
    userId: string,
    data: CreateCustomDomainInput,
): Promise<CustomDomain> {
    const now = new Date();
    const domain = data.domain.toLowerCase().trim();

    const doc: Omit<CustomDomainDocument, '_id'> = {
        notebookId: new ObjectId(notebookId),
        domain,
        status: 'pending',
        verificationMethod: 'cname',
        verificationToken: generateVerificationToken(),
        sslStatus: 'pending',
        createdAt: now,
        userId: new ObjectId(userId),
    };

    const result = await getCollection().insertOne(doc as CustomDomainDocument);

    return {
        _id: result.insertedId.toString(),
        notebookId,
        domain,
        status: 'pending',
        verificationMethod: 'cname',
        verificationToken: doc.verificationToken,
        sslStatus: 'pending',
        createdAt: now.toISOString(),
        userId,
    };
}

/**
 * Find all custom domains for a notebook
 */
export async function findCustomDomainsByNotebookId(notebookId: string): Promise<CustomDomain[]> {
    try {
        const docs = await getCollection()
            .find({ notebookId: new ObjectId(notebookId) })
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toDomainResponse);
    } catch {
        return [];
    }
}

/**
 * Find a custom domain by its domain name (for resolving incoming requests)
 */
export async function findCustomDomainByDomain(domain: string): Promise<CustomDomain | null> {
    try {
        const doc = await getCollection().findOne({
            domain: domain.toLowerCase(),
            status: 'active',
        });
        return doc ? toDomainResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a custom domain by ID
 */
export async function findCustomDomainById(domainId: string): Promise<CustomDomain | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(domainId) });
        return doc ? toDomainResponse(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Update domain verification status
 */
export async function updateDomainStatus(
    domainId: string,
    status: DomainStatus,
    sslStatus?: SslStatus,
): Promise<CustomDomain | null> {
    try {
        const updateData: Record<string, unknown> = { status };
        if (status === 'active') {
            updateData.verifiedAt = new Date();
        }
        if (sslStatus !== undefined) {
            updateData.sslStatus = sslStatus;
        }

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(domainId) },
            { $set: updateData },
            { returnDocument: 'after' },
        );
        return result ? toDomainResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Delete a custom domain
 */
export async function deleteCustomDomain(domainId: string, notebookId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(domainId),
            notebookId: new ObjectId(notebookId),
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Check if a domain is already registered
 */
export async function isDomainTaken(domain: string): Promise<boolean> {
    try {
        const doc = await getCollection().findOne({ domain: domain.toLowerCase() });
        return !!doc;
    } catch {
        return false;
    }
}
