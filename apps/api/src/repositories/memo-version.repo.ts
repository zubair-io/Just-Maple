import { ObjectId, Collection, Binary } from 'mongodb';
import { getDb } from '../db/client';
import type { MemoVersionListItem, MemoVersion, VersionTrigger } from '@maple/shared';

// Compression threshold - only compress if state is larger than this
const COMPRESSION_THRESHOLD = 1024; // 1KB

interface MemoVersionDocument {
    _id: ObjectId;
    noteId: string;
    state: Binary;
    version: number;
    byteSize: number; // Original uncompressed size
    compressedSize?: number; // Compressed size (if compressed)
    compressed?: boolean; // Whether state is compressed
    trigger: VersionTrigger;
    label?: string;
    createdAt: Date;
    contentPreview?: string;
    wordCount?: number;
    headingText?: string;
}

/**
 * Compress data using gzip
 */
async function compressState(
    data: Uint8Array,
): Promise<{ compressed: Uint8Array; wasCompressed: boolean }> {
    if (data.length < COMPRESSION_THRESHOLD) {
        return { compressed: data, wasCompressed: false };
    }

    try {
        const compressed = Bun.gzipSync(data);
        // Only use compression if it actually saves space
        if (compressed.length < data.length * 0.9) {
            return { compressed, wasCompressed: true };
        }
        return { compressed: data, wasCompressed: false };
    } catch {
        return { compressed: data, wasCompressed: false };
    }
}

/**
 * Decompress data if it was compressed
 */
async function decompressState(data: Uint8Array, isCompressed: boolean): Promise<Uint8Array> {
    if (!isCompressed) {
        return data;
    }

    try {
        return Bun.gunzipSync(data);
    } catch (err) {
        console.error('[MemoVersion] Failed to decompress state:', err);
        // Return as-is if decompression fails
        return data;
    }
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

async function toFullVersion(doc: MemoVersionDocument): Promise<MemoVersion> {
    // Decompress state if it was compressed
    const rawState = new Uint8Array(doc.state.buffer);
    const state = await decompressState(rawState, doc.compressed ?? false);

    return {
        _id: doc._id.toString(),
        noteId: doc.noteId,
        state: state.buffer, // Will be converted to base64 in API layer
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
    // Compress the state
    const { compressed, wasCompressed } = await compressState(input.state);
    const originalSize = input.state.length;

    const doc: Omit<MemoVersionDocument, '_id'> = {
        noteId: input.noteId,
        state: new Binary(Buffer.from(compressed)),
        version: input.version,
        byteSize: originalSize, // Store original size for display
        compressedSize: wasCompressed ? compressed.length : undefined,
        compressed: wasCompressed,
        trigger: input.trigger,
        label: input.label,
        createdAt: new Date(),
        contentPreview: input.contentPreview,
        wordCount: input.wordCount,
        headingText: input.headingText,
    };

    const result = await getCollection().insertOne(doc as MemoVersionDocument);

    if (wasCompressed) {
        const ratio = ((1 - compressed.length / originalSize) * 100).toFixed(1);
        console.log(
            `[MemoVersion] Compressed ${originalSize} -> ${compressed.length} bytes (${ratio}% savings)`,
        );
    }

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
        return doc ? await toFullVersion(doc) : null;
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
 * Get version state as Uint8Array (decompressed)
 */
export async function getMemoVersionState(
    noteId: string,
    versionId: string,
): Promise<Uint8Array | null> {
    try {
        const doc = await getCollection().findOne(
            { _id: new ObjectId(versionId), noteId },
            { projection: { state: 1, compressed: 1 } },
        );
        if (!doc) return null;

        const rawState = new Uint8Array(doc.state.buffer);
        return decompressState(rawState, doc.compressed ?? false);
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
