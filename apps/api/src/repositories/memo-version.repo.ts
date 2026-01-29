import { ObjectId, Collection, Binary } from 'mongodb';
import { getDb } from '../db/client';
import type { MemoVersionListItem, MemoVersion, VersionTrigger } from '@maple/shared';

interface MemoVersionDocument {
    _id: ObjectId;
    noteId: string;
    state: Binary;
    version: number;
    byteSize: number;
    trigger: VersionTrigger;
    label?: string;
    createdAt: Date;
    contentPreview?: string;
    wordCount?: number;
    headingText?: string;
}

function getCollection(): Collection<MemoVersionDocument> {
    return getDb().collection<MemoVersionDocument>('memo_versions');
}

function toListItem(doc: MemoVersionDocument): MemoVersionListItem {
    return {
        _id: doc._id.toString(),
        noteId: doc.noteId,
        version: doc.version,
        byteSize: doc.byteSize,
        trigger: doc.trigger,
        label: doc.label,
        createdAt: doc.createdAt.toISOString(),
        contentPreview: doc.contentPreview,
        wordCount: doc.wordCount,
        headingText: doc.headingText,
    };
}

function toFullVersion(doc: MemoVersionDocument): MemoVersion {
    return {
        _id: doc._id.toString(),
        noteId: doc.noteId,
        state: doc.state.buffer, // Will be converted to base64 in API layer
        version: doc.version,
        byteSize: doc.byteSize,
        trigger: doc.trigger,
        label: doc.label,
        createdAt: doc.createdAt.toISOString(),
        contentPreview: doc.contentPreview,
        wordCount: doc.wordCount,
        headingText: doc.headingText,
    };
}

export interface CreateVersionInput {
    noteId: string;
    state: Uint8Array;
    version: number;
    trigger: VersionTrigger;
    label?: string;
    contentPreview?: string;
    wordCount?: number;
    headingText?: string;
}

/**
 * Create a new version snapshot
 */
export async function createMemoVersion(input: CreateVersionInput): Promise<MemoVersionListItem> {
    const doc: Omit<MemoVersionDocument, '_id'> = {
        noteId: input.noteId,
        state: new Binary(Buffer.from(input.state)),
        version: input.version,
        byteSize: input.state.length,
        trigger: input.trigger,
        label: input.label,
        createdAt: new Date(),
        contentPreview: input.contentPreview,
        wordCount: input.wordCount,
        headingText: input.headingText,
    };

    const result = await getCollection().insertOne(doc as MemoVersionDocument);

    return {
        _id: result.insertedId.toString(),
        noteId: doc.noteId,
        version: doc.version,
        byteSize: doc.byteSize,
        trigger: doc.trigger,
        label: doc.label,
        createdAt: doc.createdAt.toISOString(),
        contentPreview: doc.contentPreview,
        wordCount: doc.wordCount,
        headingText: doc.headingText,
    };
}

/**
 * List versions for a memo (paginated, newest first)
 */
export async function listMemoVersions(
    noteId: string,
    limit: number = 20,
    before?: Date,
): Promise<{ versions: MemoVersionListItem[]; hasMore: boolean }> {
    const query: any = { noteId };
    if (before) {
        query.createdAt = { $lt: before };
    }

    // Fetch one extra to determine if there are more
    const docs = await getCollection()
        .find(query, {
            projection: {
                state: 0, // Exclude heavy state field
            },
        })
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray();

    const hasMore = docs.length > limit;
    const versions = docs.slice(0, limit).map(toListItem);

    return { versions, hasMore };
}

/**
 * Get a specific version with full state
 */
export async function getMemoVersion(
    noteId: string,
    versionId: string,
): Promise<MemoVersion | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(versionId),
            noteId,
        });
        return doc ? toFullVersion(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Get the latest version for a memo
 */
export async function getLatestMemoVersion(noteId: string): Promise<MemoVersionListItem | null> {
    const doc = await getCollection().findOne(
        { noteId },
        {
            projection: { state: 0 },
            sort: { createdAt: -1 },
        },
    );
    return doc ? toListItem(doc) : null;
}

/**
 * Get version state as Uint8Array
 */
export async function getMemoVersionState(
    noteId: string,
    versionId: string,
): Promise<Uint8Array | null> {
    try {
        const doc = await getCollection().findOne(
            { _id: new ObjectId(versionId), noteId },
            { projection: { state: 1 } },
        );
        if (!doc) return null;
        return new Uint8Array(doc.state.buffer);
    } catch {
        return null;
    }
}

/**
 * Count versions for a memo
 */
export async function countMemoVersions(noteId: string): Promise<number> {
    return getCollection().countDocuments({ noteId });
}

/**
 * Delete a specific version
 */
export async function deleteMemoVersion(noteId: string, versionId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(versionId),
            noteId,
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Delete multiple versions by IDs
 */
export async function deleteMemoVersions(versionIds: string[]): Promise<number> {
    try {
        const objectIds = versionIds.map((id) => new ObjectId(id));
        const result = await getCollection().deleteMany({
            _id: { $in: objectIds },
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}

/**
 * Delete all versions for a memo (used when memo is deleted)
 */
export async function deleteAllMemoVersions(noteId: string): Promise<number> {
    try {
        const result = await getCollection().deleteMany({ noteId });
        return result.deletedCount;
    } catch {
        return 0;
    }
}

/**
 * Get versions older than a date for cleanup
 */
export async function getVersionsOlderThan(
    noteId: string,
    date: Date,
): Promise<MemoVersionListItem[]> {
    const docs = await getCollection()
        .find({ noteId, createdAt: { $lt: date } }, { projection: { state: 0 } })
        .sort({ createdAt: -1 })
        .toArray();
    return docs.map(toListItem);
}

/**
 * Get total storage used by versions for a memo
 */
export async function getVersionStorageSize(noteId: string): Promise<number> {
    const result = await getCollection()
        .aggregate([
            { $match: { noteId } },
            { $group: { _id: null, totalBytes: { $sum: '$byteSize' } } },
        ])
        .toArray();
    return result[0]?.totalBytes ?? 0;
}
