import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type {
    Recording,
    RecordingState,
    CreateRecordingInput,
    TranscriptSegment,
} from '@maple/shared';

interface RecordingDocument {
    _id: ObjectId;
    recordingId: string; // Unique ID used in TipTap node (legacy)
    documentId?: string; // Links to page.documentId (new system)
    userId: ObjectId;
    audioUrl?: string;
    duration?: number;
    state: RecordingState;
    transcription?: string;
    segments?: TranscriptSegment[];
    isMultiTrack?: boolean;
    mimeType?: string;
    fileSize?: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<RecordingDocument> {
    return getDb().collection<RecordingDocument>('recordings');
}

function toRecordingResponse(doc: RecordingDocument): Recording {
    return {
        _id: doc._id.toString(),
        recordingId: doc.recordingId,
        documentId: doc.documentId,
        userId: doc.userId.toString(),
        audioUrl: doc.audioUrl,
        duration: doc.duration,
        state: doc.state,
        transcription: doc.transcription,
        segments: doc.segments,
        isMultiTrack: doc.isMultiTrack,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Create a new recording placeholder
 */
export async function createRecording(
    userId: string,
    data: CreateRecordingInput,
): Promise<Recording> {
    const now = new Date();
    // Use documentId as recordingId if no recordingId provided (for backward compatibility)
    const recordingId = data.recordingId || data.documentId || '';
    const doc: Omit<RecordingDocument, '_id'> = {
        recordingId,
        documentId: data.documentId,
        userId: new ObjectId(userId),
        state: 'empty',
        isMultiTrack: data.isMultiTrack,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as RecordingDocument);

    return {
        _id: result.insertedId.toString(),
        recordingId,
        documentId: data.documentId,
        userId: userId,
        state: 'empty',
        isMultiTrack: data.isMultiTrack,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Find recording by its unique recordingId (legacy)
 */
export async function findRecordingByRecordingId(
    recordingId: string,
    userId: string,
): Promise<Recording | null> {
    try {
        const doc = await getCollection().findOne({
            recordingId,
            userId: new ObjectId(userId),
        });
        if (!doc) return null;
        return toRecordingResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Find recording by its documentId (new system)
 */
export async function findRecordingByDocumentId(
    documentId: string,
    userId: string,
): Promise<Recording | null> {
    try {
        const doc = await getCollection().findOne({
            documentId,
            userId: new ObjectId(userId),
        });
        if (!doc) return null;
        return toRecordingResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Find recording by its MongoDB _id
 */
export async function findRecordingById(id: string, userId: string): Promise<Recording | null> {
    try {
        const doc = await getCollection().findOne({
            _id: new ObjectId(id),
            userId: new ObjectId(userId),
        });
        if (!doc) return null;
        return toRecordingResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Update recording state
 */
export async function updateRecordingState(
    recordingId: string,
    userId: string,
    state: RecordingState,
): Promise<Recording | null> {
    try {
        const result = await getCollection().findOneAndUpdate(
            {
                recordingId,
                userId: new ObjectId(userId),
            },
            {
                $set: {
                    state,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
        return result ? toRecordingResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Update recording with audio upload details
 */
export async function updateRecordingWithAudio(
    recordingId: string,
    userId: string,
    data: {
        audioUrl: string;
        duration: number;
        mimeType: string;
        fileSize: number;
    },
): Promise<Recording | null> {
    try {
        const result = await getCollection().findOneAndUpdate(
            {
                recordingId,
                userId: new ObjectId(userId),
            },
            {
                $set: {
                    audioUrl: data.audioUrl,
                    duration: data.duration,
                    mimeType: data.mimeType,
                    fileSize: data.fileSize,
                    state: 'complete' as RecordingState,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
        return result ? toRecordingResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Save transcription for a recording
 */
export async function saveRecordingTranscription(
    recordingId: string,
    userId: string,
    transcription: string,
    segments?: TranscriptSegment[],
): Promise<Recording | null> {
    try {
        const updateData: Record<string, unknown> = {
            transcription,
            updatedAt: new Date(),
        };
        if (segments) {
            updateData.segments = segments;
        }

        const result = await getCollection().findOneAndUpdate(
            {
                recordingId,
                userId: new ObjectId(userId),
            },
            { $set: updateData },
            { returnDocument: 'after' },
        );
        return result ? toRecordingResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Delete a recording by its recordingId (legacy)
 */
export async function deleteRecording(
    recordingId: string,
    userId: string,
): Promise<Recording | null> {
    try {
        // First get the recording to return it and get the audioUrl for cleanup
        const doc = await getCollection().findOne({
            recordingId,
            userId: new ObjectId(userId),
        });
        if (!doc) return null;

        await getCollection().deleteOne({
            recordingId,
            userId: new ObjectId(userId),
        });

        return toRecordingResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Delete a recording by its documentId (new system)
 */
export async function deleteRecordingByDocumentId(
    documentId: string,
    userId: string,
): Promise<Recording | null> {
    try {
        // First get the recording to return it and get the audioUrl for cleanup
        const doc = await getCollection().findOne({
            documentId,
            userId: new ObjectId(userId),
        });
        if (!doc) return null;

        await getCollection().deleteOne({
            documentId,
            userId: new ObjectId(userId),
        });

        return toRecordingResponse(doc);
    } catch {
        return null;
    }
}

/**
 * Update recording with audio upload details by documentId
 */
export async function updateRecordingWithAudioByDocumentId(
    documentId: string,
    userId: string,
    data: {
        audioUrl: string;
        duration: number;
        mimeType: string;
        fileSize: number;
    },
): Promise<Recording | null> {
    try {
        const result = await getCollection().findOneAndUpdate(
            {
                documentId,
                userId: new ObjectId(userId),
            },
            {
                $set: {
                    audioUrl: data.audioUrl,
                    duration: data.duration,
                    mimeType: data.mimeType,
                    fileSize: data.fileSize,
                    state: 'complete' as RecordingState,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        );
        return result ? toRecordingResponse(result) : null;
    } catch {
        return null;
    }
}

/**
 * Find all recordings for a user (for cleanup or admin purposes)
 */
export async function findRecordingsByUserId(userId: string): Promise<Recording[]> {
    try {
        const docs = await getCollection()
            .find({ userId: new ObjectId(userId) })
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toRecordingResponse);
    } catch {
        return [];
    }
}
