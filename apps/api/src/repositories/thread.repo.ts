import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Thread } from '@maple/shared';

interface ThreadDocument {
    _id: ObjectId;
    parentMessageId: string; // Message ID (UUID or legacy ObjectId string)
    notebookId: ObjectId;
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
        parentMessageId: doc.parentMessageId, // Already a string
        notebookId: doc.notebookId.toString(),
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
            parentMessageId: messageId, // String comparison
        });
        return doc ? toThread(doc) : null;
    } catch {
        return null;
    }
}

export async function createThread(data: {
    parentMessageId: string;
    notebookId: string;
    botInvocationId?: string;
}): Promise<Thread> {
    const now = new Date();
    const doc: Omit<ThreadDocument, '_id'> = {
        parentMessageId: data.parentMessageId, // Keep as string (UUID or ObjectId string)
        notebookId: new ObjectId(data.notebookId),
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

export async function findThreadsByNotebookId(
    notebookId: string,
    options?: { limit?: number },
): Promise<Thread[]> {
    try {
        const docs = await getCollection()
            .find({ notebookId: new ObjectId(notebookId) })
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
    notebookId: string;
    botInvocationId?: string;
}): Promise<Thread> {
    const now = new Date();
    const notebookOid = new ObjectId(data.notebookId);
    const botInvocationOid = data.botInvocationId ? new ObjectId(data.botInvocationId) : undefined;

    const result = await getCollection().findOneAndUpdate(
        { parentMessageId: data.parentMessageId }, // String comparison
        {
            $setOnInsert: {
                parentMessageId: data.parentMessageId, // Keep as string
                notebookId: notebookOid,
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
