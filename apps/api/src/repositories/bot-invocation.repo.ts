import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { BotInvocation, InvocationStatus } from '@maple/shared';

interface BotInvocationDocument {
    _id: ObjectId;
    userBotId: ObjectId;
    templateId: ObjectId;
    sourceType: 'message' | 'note';
    sourceId: ObjectId;
    notebookId: ObjectId;
    userId: ObjectId;
    context: {
        mentionText?: string;
        fullContent?: string;
        documentTitle?: string;
        selection?: string;
        previousMessages?: unknown[];
    };
    variables: Record<string, unknown>;
    output?: unknown;
    status: InvocationStatus;
    error?: {
        code: string;
        message: string;
        step?: string;
    };
    threadId?: ObjectId;
    responseMessageId?: ObjectId;
    executionTimeMs?: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<BotInvocationDocument> {
    return getDb().collection<BotInvocationDocument>('bot_invocations');
}

function toInvocation(doc: BotInvocationDocument): BotInvocation {
    return {
        _id: doc._id.toString(),
        userBotId: doc.userBotId.toString(),
        templateId: doc.templateId.toString(),
        sourceType: doc.sourceType,
        sourceId: doc.sourceId.toString(),
        notebookId: doc.notebookId.toString(),
        userId: doc.userId.toString(),
        context: doc.context,
        variables: doc.variables as Record<string, unknown>,
        output: doc.output,
        status: doc.status,
        error: doc.error,
        threadId: doc.threadId?.toString(),
        responseMessageId: doc.responseMessageId?.toString(),
        executionTimeMs: doc.executionTimeMs,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function findInvocationById(id: string): Promise<BotInvocation | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toInvocation(doc) : null;
    } catch {
        return null;
    }
}

export async function createInvocation(data: {
    userBotId: string;
    templateId: string;
    sourceType: 'message' | 'note';
    sourceId: string;
    notebookId: string;
    userId: string;
    context: BotInvocation['context'];
}): Promise<BotInvocation> {
    const now = new Date();
    const doc: Omit<BotInvocationDocument, '_id'> = {
        userBotId: new ObjectId(data.userBotId),
        templateId: new ObjectId(data.templateId),
        sourceType: data.sourceType,
        sourceId: new ObjectId(data.sourceId),
        notebookId: new ObjectId(data.notebookId),
        userId: new ObjectId(data.userId),
        context: data.context,
        variables: {},
        status: 'pending',
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as BotInvocationDocument);
    return toInvocation({ ...doc, _id: result.insertedId } as BotInvocationDocument);
}

export async function updateInvocationStatus(
    id: string,
    status: InvocationStatus,
    updates?: Partial<
        Pick<
            BotInvocation,
            'output' | 'error' | 'threadId' | 'responseMessageId' | 'executionTimeMs' | 'variables'
        >
    >,
): Promise<BotInvocation | null> {
    try {
        const updateDoc: Record<string, unknown> = {
            status,
            updatedAt: new Date(),
        };

        if (updates?.output !== undefined) updateDoc.output = updates.output;
        if (updates?.error !== undefined) updateDoc.error = updates.error;
        if (updates?.threadId) updateDoc.threadId = new ObjectId(updates.threadId);
        if (updates?.responseMessageId) {
            updateDoc.responseMessageId = new ObjectId(updates.responseMessageId);
        }
        if (updates?.executionTimeMs !== undefined) {
            updateDoc.executionTimeMs = updates.executionTimeMs;
        }
        if (updates?.variables) updateDoc.variables = updates.variables;

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateDoc },
            { returnDocument: 'after' },
        );

        return result ? toInvocation(result) : null;
    } catch {
        return null;
    }
}

export async function findInvocationsByUserBot(
    userBotId: string,
    options?: { limit?: number },
): Promise<BotInvocation[]> {
    try {
        const docs = await getCollection()
            .find({ userBotId: new ObjectId(userBotId) })
            .sort({ createdAt: -1 })
            .limit(options?.limit || 50)
            .toArray();
        return docs.map(toInvocation);
    } catch {
        return [];
    }
}

export async function findInvocationsBySourceMessage(sourceId: string): Promise<BotInvocation[]> {
    try {
        const docs = await getCollection()
            .find({
                sourceType: 'message',
                sourceId: new ObjectId(sourceId),
            })
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toInvocation);
    } catch {
        return [];
    }
}
