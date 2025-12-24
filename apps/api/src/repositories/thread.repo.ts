import { ObjectId, Collection, MongoServerError } from 'mongodb';
import { getDb } from '../db/client';
import type { Thread } from '@maple/shared';

interface ThreadDocument {
    _id: ObjectId;
    parentMessageId: ObjectId;
    tagId: ObjectId;
    botInvocationId?: ObjectId;
    messageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<ThreadDocument> {
    return getDb().collection<ThreadDocument>('threads');
}

function toThread(doc: ThreadDocument): Thread {
    return {
        _id: doc._id.toString(),
        parentMessageId: doc.parentMessageId.toString(),
        tagId: doc.tagId.toString(),
        botInvocationId: doc.botInvocationId?.toString(),
        messageCount: doc.messageCount,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function findThreadById(id: string): Promise<Thread | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toThread(doc) : null;
    } catch {
        return null;
    }
}

export async function findThreadByParentMessage(messageId: string): Promise<Thread | null> {
    try {
        const doc = await getCollection().findOne({
            parentMessageId: new ObjectId(messageId),
        });
        return doc ? toThread(doc) : null;
    } catch {
        return null;
    }
}

export async function createThread(data: {
    parentMessageId: string;
    tagId: string;
    botInvocationId?: string;
}): Promise<Thread> {
    const now = new Date();
    const doc: Omit<ThreadDocument, '_id'> = {
        parentMessageId: new ObjectId(data.parentMessageId),
        tagId: new ObjectId(data.tagId),
        botInvocationId: data.botInvocationId ? new ObjectId(data.botInvocationId) : undefined,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as ThreadDocument);
    return toThread({ ...doc, _id: result.insertedId } as ThreadDocument);
}

export async function incrementThreadMessageCount(threadId: string): Promise<void> {
    await getCollection().updateOne(
        { _id: new ObjectId(threadId) },
        {
            $inc: { messageCount: 1 },
            $set: { updatedAt: new Date() },
        },
    );
}

export async function findThreadsByTagId(
    tagId: string,
    options?: { limit?: number },
): Promise<Thread[]> {
    try {
        const docs = await getCollection()
            .find({ tagId: new ObjectId(tagId) })
            .sort({ updatedAt: -1 })
            .limit(options?.limit || 50)
            .toArray();
        return docs.map(toThread);
    } catch {
        return [];
    }
}

// Get or create thread for a parent message
// Uses atomic operations to handle race conditions
export async function getOrCreateThread(data: {
    parentMessageId: string;
    tagId: string;
    botInvocationId?: string;
}): Promise<Thread> {
    try {
        // Try to create first (atomic operation)
        return await createThread(data);
    } catch (error) {
        // If duplicate key error (code 11000), thread already exists from concurrent request
        if (error instanceof MongoServerError && error.code === 11000) {
            // Thread was created by another concurrent request, fetch it
            const existing = await findThreadByParentMessage(data.parentMessageId);
            if (existing) return existing;

            // Shouldn't happen, but throw if we still can't find it
            throw new Error(
                'Thread creation failed: concurrent creation detected but thread not found',
            );
        }
        throw error;
    }
}
