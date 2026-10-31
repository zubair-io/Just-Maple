import { createHash } from 'node:crypto';
import type { AssistanceHistory, Page } from '@maple/shared';
import {
    assistanceId,
    putConversation,
    findConversation,
    conversationView,
    conversationMessages,
    messageView,
    putAssistanceMessage,
    putAssistanceTask,
    pendingAssistanceCount,
    saveConversationDraft,
    findAssistanceTask,
    listAssistanceTasks,
    taskView,
    cancelAssistance,
    rememberSavedResult,
    type ConversationDoc,
} from '../repositories/assistance.repo';
import { assistanceAccess, AssistanceError } from './assistance-access.service';
import { findPageById, createPage, yDocStateToJSON } from '../repositories/page.repo';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { getMemoState } from '../repositories/memo.repo';
import { extractTextFromContent } from '../utils/content-utils';
import { wakeAssistanceWorker, stopAssistanceTask } from './assistance-runner.service';
import { indexPage } from '../repositories/search.repo';
import { findFollowUp } from '../repositories/follow-up.repo';
import { visibleFollowUpsInNotebook } from './follow-up.service';

export async function openAssistance(userId: string, pageId: string, botId: string) {
    const page = await findPageById(pageId, userId);
    if (!page?.notebookId || page.isTrashed) throw new AssistanceError(404, 'Page not found.');
    const input = { pageId, userId, notebookId: page.notebookId, botId };
    const { bot, template } = await assistanceAccess(input);
    return conversationView(
        await putConversation({
            ...input,
            _id: assistanceId(userId, pageId, botId),
            botName: bot.displayName || template.name,
            createdAt: new Date(),
        }),
    );
}
export async function ownedConversation(id: string, userId: string): Promise<ConversationDoc> {
    const row = await findConversation(id, userId);
    if (!row) throw new AssistanceError(404, 'Conversation not found.');
    await assistanceAccess(row);
    return row;
}
export async function assistanceHistory(
    id: string,
    userId: string,
    before?: string,
): Promise<AssistanceHistory> {
    const conversation = await ownedConversation(id, userId);
    const [messages, tasks] = await Promise.all([
        conversationMessages(id, userId, before, 31),
        listAssistanceTasks(userId, { conversationId: id }, 30),
    ]);
    return {
        conversation: conversationView(conversation),
        messages: messages.slice(0, 30).reverse().map(messageView),
        tasks: tasks.map(taskView),
        hasMore: messages.length > 30,
    };
}
async function snapshot(page: Page) {
    const state = page.type === 'memo' ? await getMemoState(page.id) : null;
    const content = state ? yDocStateToJSON(state) || page.content : page.content;
    const text = extractTextFromContent(content).slice(0, 40_000);
    return {
        sourceText: text,
        sourceRevision: createHash('sha256').update(text).digest('hex').slice(0, 16),
        sourceTitle: page.title,
    };
}
export async function sendAssistance(
    id: string,
    userId: string,
    input: { requestId: string; text: string; selection?: string },
) {
    const conversation = await ownedConversation(id, userId);
    const taskId = assistanceId(id, input.requestId);
    const existing = await findAssistanceTask(taskId, userId);
    if (existing) {
        if (
            existing.question !== input.text.trim() ||
            (existing.selection || '') !== (input.selection || '')
        )
            throw new AssistanceError(
                409,
                'This request identifier already belongs to another message.',
            );
        return taskView(existing);
    }
    if ((await pendingAssistanceCount(userId)) >= 20)
        throw new AssistanceError(
            429,
            'Your work queue is full. Wait for an answer or stop some work.',
        );
    const { page } = await assistanceAccess(conversation);
    const context = await snapshot(page);
    const now = new Date();
    const question = input.text.trim();
    if (!question) throw new AssistanceError(400, 'Write or record a message first.');
    const questionMessageId = taskId + ':0-question';
    const message = await putAssistanceMessage({
        _id: questionMessageId,
        userId,
        conversationId: id,
        role: 'user',
        taskId,
        content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: question }] }],
        },
        createdAt: now,
        sourceTitle: context.sourceTitle,
        sourceRevision: context.sourceRevision,
        selection: input.selection,
    });
    if (
        extractTextFromContent(message.content) !== question ||
        (message.selection || '') !== (input.selection || '')
    )
        throw new AssistanceError(
            409,
            'This request identifier already belongs to another message.',
        );
    const task = await putAssistanceTask({
        ...context,
        _id: taskId,
        userId,
        conversationId: id,
        pageId: conversation.pageId,
        notebookId: conversation.notebookId,
        botId: conversation.botId,
        botName: conversation.botName,
        question,
        questionMessageId,
        selection: input.selection,
        status: 'pending',
        progress: 'Queued',
        createdAt: now,
        updatedAt: now,
    });
    wakeAssistanceWorker();
    return taskView(task);
}
export async function stopAssistance(id: string, userId: string) {
    const task = await findAssistanceTask(id, userId);
    if (!task) throw new AssistanceError(404, 'Work not found.');
    await ownedConversation(task.conversationId, userId);
    const updated = await cancelAssistance(id, userId);
    stopAssistanceTask(id);
    return taskView(updated || task);
}
export async function saveAssistanceResult(
    id: string,
    userId: string,
    title: string,
    targetNotebookId: string,
) {
    const task = await findAssistanceTask(id, userId);
    if (!task || task.status !== 'completed' || !task.result)
        throw new AssistanceError(404, 'A completed result is required.');
    await ownedConversation(task.conversationId, userId);
    const target = await findNotebookByIdWithAccess(targetNotebookId, userId, 'write');
    if (!target) throw new AssistanceError(403, 'You cannot save in that notebook.');
    // Results may include the user's private mail or reply draft. Save only into their private notebook.
    if (
        target.sharing.isPublic ||
        target.sharing.sharedWith.some((member) => member.userId !== userId)
    )
        throw new AssistanceError(403, 'Save this private conversation in a private notebook.');
    const h = task._id;
    const noteId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const saved = await findPageById(noteId, userId);
    if (saved) return saved;
    const sourceLink: Record<string, unknown> = {
        type: 'paragraph',
        content: [
            {
                type: 'text',
                text: `Source: ${task.sourceTitle}`,
                marks: [{ type: 'link', attrs: { href: `/${task.notebookId}/${task.pageId}` } }],
            },
            { type: 'text', text: ` · snapshot ${task.sourceRevision}` },
        ],
    };
    let page: Page;
    try {
        page = await createPage(userId, {
            id: noteId,
            notebookId: targetNotebookId,
            type: 'memo',
            title: title.trim() || `From ${task.sourceTitle}`,
            content: { type: 'doc', content: [...(task.result.content.content || []), sourceLink] },
        });
    } catch (error) {
        const duplicate = await findPageById(noteId, userId);
        if (!duplicate) throw error;
        page = duplicate;
    }
    await rememberSavedResult(id, userId, page.id);
    void indexPage(page.id).catch(() => {});
    return page;
}
export async function prepareFollowUpReply(
    notebookId: string,
    userId: string,
    followUpId: string,
    botId: string,
    requestId: string,
) {
    if (!(await findNotebookByIdWithAccess(notebookId, userId, 'read')))
        throw new AssistanceError(404, 'Notebook not found.');
    const doc = await findFollowUp(userId, followUpId);
    const followUp = doc
        ? (await visibleFollowUpsInNotebook(notebookId, userId, [doc]))[0]
        : undefined;
    if (
        !followUp ||
        followUp.status !== 'open' ||
        !['owe_reply', 'you_promised'].includes(followUp.direction)
    )
        throw new AssistanceError(404, 'An open follow-up is required.');
    const evidence = followUp.evidence[0];
    if (!evidence?.pageId)
        throw new AssistanceError(404, 'The original conversation is no longer available.');
    const conversation = await openAssistance(userId, evidence.pageId, botId);
    const task = await sendAssistance(conversation.id, userId, {
        requestId,
        text: `Prepare an editable reply draft to ${followUp.who} about: ${followUp.what}. Read the original message ${evidence.itemId} and its surrounding conversation first. Use draft_reply to save a draft for my review; do not send it.`,
    });
    return { conversation, task };
}

export async function saveAssistanceDraft(
    id: string,
    userId: string,
    text: string,
    version: number,
) {
    await ownedConversation(id, userId);
    const row = await saveConversationDraft(id, userId, text, version);
    if (!row)
        throw new AssistanceError(
            409,
            'The draft changed on another device. Your text is still here; reload before replacing it.',
        );
    return conversationView(row);
}

export async function assistanceBots(notebookId: string, userId: string) {
    const notebook = await findNotebookByIdWithAccess(notebookId, userId, 'read');
    if (!notebook) throw new AssistanceError(404, 'Notebook not found.');
    const { findUserBotByIdInternal } = await import('../repositories/user-bot.repo');
    const { findBotTemplateById } = await import('../repositories/bot-template.repo');
    const bots = await Promise.all(
        (notebook.sharing.sharedBots || []).slice(0, 100).map(async (entry) => {
            const bot = await findUserBotByIdInternal(entry.userBotId);
            if (
                !bot ||
                bot.userId !== userId ||
                bot.isEnabled === false ||
                bot.botType === 'custom' ||
                !bot.templateId
            )
                return null;
            const template = await findBotTemplateById(bot.templateId);
            if (!template?.definition.actions.some((action) => action.type === 'llm')) return null;
            return { id: bot._id, name: bot.displayName || template.name, handle: bot.handle };
        }),
    );
    return bots.filter((bot) => bot !== null);
}
