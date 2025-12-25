import { ObjectId, Collection } from 'mongodb';
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
// Uses atomic findOneAndUpdate with upsert to handle race conditions
export async function getOrCreateThread(data: {
    parentMessageId: string;
    tagId: string;
    botInvocationId?: string;
}): Promise<Thread> {
    const now = new Date();
    const parentMessageOid = new ObjectId(data.parentMessageId);
    const tagOid = new ObjectId(data.tagId);
    const botInvocationOid = data.botInvocationId ? new ObjectId(data.botInvocationId) : undefined;

    const result = await getCollection().findOneAndUpdate(
        { parentMessageId: parentMessageOid },
        {
            $setOnInsert: {
                parentMessageId: parentMessageOid,
                tagId: tagOid,
                botInvocationId: botInvocationOid,
                messageCount: 0,
                createdAt: now,
            },
            $set: { updatedAt: now },
        },
        { upsert: true, returnDocument: 'after' },
    );

    if (!result) {
        throw new Error('Failed to get or create thread');
    }

    return toThread(result);
}
