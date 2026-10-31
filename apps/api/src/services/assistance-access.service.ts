import { findPageById } from '../repositories/page.repo';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { findUserBotByIdInternal } from '../repositories/user-bot.repo';
import { findBotTemplateById } from '../repositories/bot-template.repo';
import type { ConversationDoc } from '../repositories/assistance.repo';

export class AssistanceError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}
export async function assistanceAccess(
    conversation: Pick<ConversationDoc, 'pageId' | 'userId' | 'botId' | 'notebookId'>,
) {
    const [page, notebook, bot] = await Promise.all([
        findPageById(conversation.pageId, conversation.userId),
        findNotebookByIdWithAccess(conversation.notebookId, conversation.userId, 'read'),
        findUserBotByIdInternal(conversation.botId),
    ]);
    if (!page || page.isTrashed || page.notebookId !== conversation.notebookId || !notebook)
        throw new AssistanceError(404, 'This page is no longer available.');
    if (
        !bot ||
        bot.userId !== conversation.userId ||
        bot.isEnabled === false ||
        bot.botType === 'custom' ||
        !notebook.sharing.sharedBots?.some((entry) => entry.userBotId === bot._id)
    )
        throw new AssistanceError(
            403,
            'Choose one of your enabled AI bots shared with this notebook.',
        );
    const template = bot.templateId ? await findBotTemplateById(bot.templateId) : null;
    const llm = template?.definition.actions.find((action) => action.type === 'llm');
    if (!template || !llm)
        throw new AssistanceError(400, 'This bot does not support conversations.');
    return { page, notebook, bot, template, llm };
}
