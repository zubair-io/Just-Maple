import { createHash } from 'node:crypto';
import type { Collection, Filter } from 'mongodb';
import { getDb } from '../db/client';
import type {
    AssistanceConversation,
    AssistanceMessage,
    AssistanceTask,
    AssistanceStatus,
} from '@maple/shared';

export interface ConversationDoc extends Omit<AssistanceConversation, 'id' | 'createdAt'> {
    _id: string;
    userId: string;
    createdAt: Date;
}
export interface MessageDoc extends Omit<AssistanceMessage, 'id' | 'createdAt'> {
    _id: string;
    userId: string;
    createdAt: Date;
}
export interface TaskDoc extends Omit<AssistanceTask, 'id' | 'createdAt' | 'updatedAt'> {
    _id: string;
    userId: string;
    botId: string;
    questionMessageId: string;
    sourceText: string;
    sourceTitle: string;
    sourceRevision: string;
    selection?: string;
    createdAt: Date;
    updatedAt: Date;
    leaseOwner?: string;
    leaseUntil?: Date;
    cancelRequested?: boolean;
    completedAt?: Date;
    result?: AssistanceMessage;
}
const conversations = () => getDb().collection<ConversationDoc>('assistance_conversations');
const messages = () => getDb().collection<MessageDoc>('assistance_messages');
const tasks = () => getDb().collection<TaskDoc>('assistance_tasks');
export const assistanceId = (...parts: string[]) =>
    createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function conversationView(doc: ConversationDoc): AssistanceConversation {
    const { _id, userId: _, createdAt, ...rest } = doc;
    return { ...rest, id: _id, createdAt: createdAt.toISOString() };
}
export function messageView(doc: MessageDoc): AssistanceMessage {
    const { _id, userId: _, createdAt, ...rest } = doc;
    return { ...rest, id: _id, createdAt: createdAt.toISOString() };
}
export function taskView(doc: TaskDoc): AssistanceTask {
    return {
        id: doc._id,
        conversationId: doc.conversationId,
        pageId: doc.pageId,
        notebookId: doc.notebookId,
        botName: doc.botName,
        question: doc.question,
        status: doc.status,
        progress: doc.progress,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        ...(doc.error ? { error: doc.error } : {}),
        ...(doc.actionIds ? { actionIds: doc.actionIds } : {}),
        ...(doc.savedPageId ? { savedPageId: doc.savedPageId } : {}),
    };
}
async function insertOnce<T extends { _id: string }>(
    collection: Collection<T>,
    doc: T,
): Promise<T> {
    try {
        await collection.insertOne(doc as never);
        return doc;
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const existing = await collection.findOne({ _id: doc._id } as Filter<T>);
        if (!existing) throw error;
        return existing as T;
    }
}
export const putConversation = (doc: ConversationDoc) => insertOnce(conversations(), doc);
export const putAssistanceMessage = (doc: MessageDoc) => insertOnce(messages(), doc);
export const putAssistanceTask = (doc: TaskDoc) => insertOnce(tasks(), doc);
export const findConversation = (id: string, userId: string) =>
    conversations().findOne({ _id: id, userId });
export const findAssistanceTask = (id: string, userId?: string) =>
    tasks().findOne({ _id: id, ...(userId ? { userId } : {}) });
export const findAssistanceMessage = (id: string, userId: string) =>
    messages().findOne({ _id: id, userId });
/** Pair earlier turns with their completed answers, even if the next turn was queued first. */
export async function assistanceContext(
    task: TaskDoc,
): Promise<{ role: 'user' | 'assistant'; content: AssistanceMessage['content'] }[]> {
    const current = await findAssistanceMessage(task.questionMessageId, task.userId);
    if (!current) return [];
    const human = await messages()
        .find({
            conversationId: task.conversationId,
            userId: task.userId,
            $or: [
                { createdAt: { $lt: current.createdAt } },
                { createdAt: current.createdAt, _id: { $lt: current._id } },
            ],
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(12)
        .toArray();
    const answers = await tasks()
        .find({
            conversationId: task.conversationId,
            userId: task.userId,
            status: 'completed',
            questionMessageId: { $in: human.map((row) => row._id) },
        })
        .limit(12)
        .toArray();
    const byQuestion = new Map(answers.map((row) => [row.questionMessageId, row.result]));
    return human
        .reverse()
        .flatMap((row) => {
            const answer = byQuestion.get(row._id);
            return [
                { role: row.role, content: row.content },
                ...(answer ? [{ role: answer.role, content: answer.content }] : []),
            ];
        })
        .slice(-12);
}
export async function conversationMessages(
    conversationId: string,
    userId: string,
    before?: string,
    limit = 30,
): Promise<MessageDoc[]> {
    let cursor: { createdAt: Date; id: string } | undefined;
    if (before) {
        const human = await messages().findOne({ _id: before, conversationId, userId });
        const answer =
            !human && before.endsWith(':answer')
                ? await tasks().findOne({
                      _id: before.slice(0, -7),
                      conversationId,
                      userId,
                      status: 'completed',
                  })
                : null;
        if (human) cursor = { createdAt: human.createdAt, id: human._id };
        else if (answer?.result && answer.completedAt)
            cursor = { createdAt: answer.completedAt, id: answer.result.id };
        else return [];
    }
    const cut = (field: string, id: string) =>
        cursor
            ? {
                  $or: [
                      { [field]: { $lt: cursor.createdAt } },
                      { [field]: cursor.createdAt, _id: { $lt: id } },
                  ],
              }
            : {};
    const [human, answers] = await Promise.all([
        messages()
            .find({ conversationId, userId, ...cut('createdAt', cursor?.id || '') })
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit)
            .toArray(),
        tasks()
            .find({
                conversationId,
                userId,
                status: 'completed',
                ...cut('completedAt', cursor?.id.replace(/:answer$/, '') || ''),
            })
            .sort({ completedAt: -1, _id: -1 })
            .limit(limit)
            .toArray(),
    ]);
    return [
        ...human,
        ...answers
            .filter((row) => row.result && row.completedAt)
            .map((row) => {
                const { id, createdAt: _, ...rest } = row.result!;
                return { ...rest, _id: id, userId, createdAt: row.completedAt! };
            }),
    ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id.localeCompare(a._id))
        .slice(0, limit);
}
export async function listAssistanceTasks(
    userId: string,
    scope: {
        notebookId?: string;
        conversationId?: string;
        statuses?: AssistanceStatus[];
        before?: string;
    },
    limit = 30,
): Promise<TaskDoc[]> {
    const cursor = scope.before ? await findAssistanceTask(scope.before, userId) : null;
    if (
        scope.before &&
        (!cursor ||
            (scope.notebookId && cursor.notebookId !== scope.notebookId) ||
            (scope.conversationId && cursor.conversationId !== scope.conversationId))
    )
        return [];
    return tasks()
        .find({
            userId,
            ...(scope.notebookId ? { notebookId: scope.notebookId } : {}),
            ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
            ...(scope.statuses ? { status: { $in: scope.statuses } } : {}),
            ...(cursor
                ? {
                      $or: [
                          { createdAt: { $lt: cursor.createdAt } },
                          { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
                      ],
                  }
                : {}),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .toArray();
}
export const pendingAssistanceCount = (userId: string) =>
    tasks().countDocuments({ userId, status: { $in: ['pending', 'running'] } });
export async function claimAssistance(owner: string, now = new Date()): Promise<TaskDoc | null> {
    // This deployment has one queue worker. Keep turns in each conversation sequential.
    const running = await tasks()
        .find({ status: 'running' })
        .project({ conversationId: 1 })
        .limit(100)
        .toArray();
    const candidate = await tasks()
        .find({
            status: 'pending',
            conversationId: { $nin: running.map((row) => row.conversationId) },
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(1)
        .next();
    if (!candidate) return null;
    return tasks().findOneAndUpdate(
        { _id: candidate._id, status: 'pending' },
        {
            $set: {
                status: 'running',
                progress: 'Preparing context',
                leaseOwner: owner,
                leaseUntil: new Date(now.getTime() + 60_000),
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );
}
export async function renewAssistance(
    id: string,
    owner: string,
    now = new Date(),
): Promise<TaskDoc | null> {
    return tasks().findOneAndUpdate(
        { _id: id, status: 'running', leaseOwner: owner },
        {
            $set: {
                leaseUntil: new Date(now.getTime() + 60_000),
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );
}
export async function updateRunningAssistance(
    id: string,
    owner: string,
    update: Partial<Pick<TaskDoc, 'status' | 'progress' | 'error' | 'actionIds'>>,
): Promise<TaskDoc | null> {
    return tasks().findOneAndUpdate(
        { _id: id, status: 'running', leaseOwner: owner, cancelRequested: { $ne: true } },
        { $set: { ...update, updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
}
export async function cancelAssistance(id: string, userId: string): Promise<TaskDoc | null> {
    return tasks().findOneAndUpdate(
        { _id: id, userId, status: { $in: ['pending', 'running'] } },
        {
            $set: {
                cancelRequested: true,
                status: 'cancelled',
                progress: 'Stopped; review Activity for actions already started',
                updatedAt: new Date(),
            },
        },
        { returnDocument: 'after' },
    );
}
export async function expireAssistanceLeases(now = new Date()): Promise<void> {
    // Interrupted runs can have external effects. They are never automatically replayed.
    await tasks().updateMany(
        { status: 'running', leaseUntil: { $lt: now } },
        {
            $set: {
                status: 'interrupted',
                progress: 'Interrupted — check Activity before starting again',
                error: 'The worker stopped before confirming the outcome. Existing actions have not been replayed.',
                updatedAt: now,
            },
        },
    );
}
export async function rememberSavedResult(
    id: string,
    userId: string,
    pageId: string,
): Promise<void> {
    await tasks().updateOne(
        { _id: id, userId, status: 'completed' },
        { $set: { savedPageId: pageId } },
    );
}

export async function completeAssistance(
    id: string,
    owner: string,
    result: AssistanceMessage,
    actionIds: string[],
): Promise<TaskDoc | null> {
    const now = new Date();
    // Result and terminal state commit together. A cancelled task cannot publish later.
    return tasks().findOneAndUpdate(
        { _id: id, status: 'running', leaseOwner: owner, cancelRequested: { $ne: true } },
        {
            $set: {
                result,
                status: 'completed',
                progress: 'Ready',
                completedAt: new Date(result.createdAt),
                actionIds,
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );
}

export async function saveConversationDraft(
    id: string,
    userId: string,
    draft: string,
    version: number,
) {
    return conversations().findOneAndUpdate(
        {
            _id: id,
            userId,
            ...(version === 0
                ? { $or: [{ draftVersion: 0 }, { draftVersion: { $exists: false } }] }
                : { draftVersion: version }),
        },
        { $set: { draft, draftVersion: version + 1 } },
        { returnDocument: 'after' },
    );
}
