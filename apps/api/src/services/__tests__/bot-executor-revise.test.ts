import { beforeEach, describe, expect, it, vi } from 'vitest';

// A proactive pass that revises the bot's unread post in place (runProactive `revise`).

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('../../repositories/bot-template.repo', () => ({ findBotTemplateById: vi.fn() }));
vi.mock('../../repositories/user-bot.repo', () => ({ findUserBotByIdInternal: vi.fn() }));
vi.mock('../../repositories/bot-invocation.repo', () => ({
    findInvocationById: vi.fn(),
    updateInvocationStatus: vi.fn(),
    createInvocation: vi.fn(),
}));
vi.mock('../../repositories/thread.repo', () => ({
    getOrCreateThread: vi.fn(),
    incrementThreadMessageCount: vi.fn(),
    findThreadByParentMessage: vi.fn(),
}));
vi.mock('../../repositories/message.repo', () => ({
    createMessageInThread: vi.fn(),
    createTopLevelBotMessage: vi.fn().mockResolvedValue({ _id: 'mongo-new', id: 'new' }),
    markMessageHasThread: vi.fn(),
    findMessagesByThreadId: vi.fn(),
    findMessageById: vi.fn(),
    reviseBotMessage: vi.fn(),
}));
vi.mock('../../repositories/page.repo', () => ({ findPageByIdForBot: vi.fn() }));
vi.mock('../../repositories/unread.repo', () => ({ getLastReadAtByPageId: vi.fn() }));
vi.mock('../realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../notification.service', () => ({
    sendMessageReceivedNotification: vi.fn().mockResolvedValue('n'),
}));
vi.mock('../webhook.service', () => ({
    buildWebhookPayload: vi.fn(),
    invokeWebhookWithRetry: vi.fn(),
}));
vi.mock('../proactive-settings.service', () => ({ appendProactiveInstruction: vi.fn() }));
vi.mock('../mac-data-tools.service', () => ({
    getMacDataToolContext: vi.fn(),
    macDataSystemPrompt: vi.fn(() => 'MAC DATA PROMPT'),
    macDataToolDefinitions: vi.fn(() => [
        { name: 'search_local_data', description: 'Search', input_schema: { type: 'object' } },
    ]),
    executeMacDataTool: vi.fn(),
}));
vi.mock('../llm-tool-loop.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llm-tool-loop.service')>()),
    runAnthropicWithTools: vi.fn(),
}));

import { BotExecutorService } from '../bot-executor.service';
import { createTopLevelBotMessage, reviseBotMessage } from '../../repositories/message.repo';
import { broadcastChatEvent } from '../realtime.service';
import { sendMessageReceivedNotification } from '../notification.service';
import { runAnthropicWithTools } from '../llm-tool-loop.service';
import { extractTextFromContent } from '../../utils/content-utils';
import { getLastReadAtByPageId } from '../../repositories/unread.repo';

const template: any = {
    _id: 'template',
    name: 'Maple',
    definition: {
        actions: [
            { type: 'llm', id: 'reply', config: { model: 'claude-haiku-5-5', userPrompt: '' } },
        ],
    },
};
const userBot: any = { _id: 'bot', userId: 'owner', config: { apiKey: 'secret' } };
const macData: any = { userId: 'owner', notebookId: 'notebook', sources: ['mail'], now: 'now' };

const run = (revise?: { messageId: string; push?: string }) =>
    new BotExecutorService().runProactive({
        page: { id: 'page', notebookId: 'notebook', title: 'Family' } as any,
        userBot,
        template,
        macData,
        system: 'PROACTIVE',
        prompt: 'batch',
        previousMessages: [],
        proactiveMeta: { kind: 'news', urgency: 2 },
        ...(revise ? { revise } : {}),
    });

const revised = {
    _id: 'mongo-earlier',
    id: 'earlier',
    pageId: 'page',
    notebookId: 'notebook',
    revisedAt: '2026-10-28T18:00:00.000Z',
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runAnthropicWithTools).mockResolvedValue('Practice moved to 6 at Westside.');
    vi.mocked(reviseBotMessage).mockResolvedValue(revised as any);
});

describe('revising an unread proactive post', () => {
    it('replaces the post through the normal edit event, without a notification', async () => {
        expect(await run({ messageId: 'earlier' })).toMatchObject({ id: 'earlier' });
        expect(reviseBotMessage).toHaveBeenCalledWith(
            'earlier',
            'bot',
            expect.objectContaining({ proactiveMeta: { kind: 'news', urgency: 2 } }),
            expect.objectContaining({ stillUnread: expect.any(Function) }),
        );
        const update = vi.mocked(reviseBotMessage).mock.calls[0]![2];
        expect(extractTextFromContent(update.content)).toContain('Practice moved to 6');
        expect(broadcastChatEvent).toHaveBeenCalledWith(
            'notebook',
            expect.objectContaining({ action: 'edited', pageId: 'page', data: revised }),
        );
        expect(createTopLevelBotMessage).not.toHaveBeenCalled();
        expect(sendMessageReceivedNotification).not.toHaveBeenCalled();
    });

    it('sends one push saying what changed when urgency rose', async () => {
        await run({ messageId: 'earlier', push: 'Practice cancelled tonight' });
        expect(sendMessageReceivedNotification).toHaveBeenCalledTimes(1);
        const [owner, notebook, pageId, messageId, , name, , content] = vi.mocked(
            sendMessageReceivedNotification,
        ).mock.calls[0]!;
        expect([owner, notebook, pageId, messageId, name]).toEqual([
            'owner',
            'notebook',
            'page',
            'mongo-earlier',
            'Maple',
        ]);
        expect(extractTextFromContent(content)).toBe('Updated: Practice cancelled tonight');
    });

    it('posts a new message when the post can no longer be revised', async () => {
        vi.mocked(reviseBotMessage).mockResolvedValueOnce(null);
        expect(await run({ messageId: 'earlier' })).toMatchObject({ id: 'new' });
        expect(createTopLevelBotMessage).toHaveBeenCalledWith(
            expect.objectContaining({ proactiveMeta: { kind: 'news', urgency: 2 } }),
        );
        expect(broadcastChatEvent).toHaveBeenCalledWith(
            'notebook',
            expect.objectContaining({ action: 'message' }),
        );
        expect(sendMessageReceivedNotification).toHaveBeenCalledTimes(1);
    });

    it("re-checks the owner's read marker just before writing", async () => {
        await run({ messageId: 'earlier' });
        const guard = vi.mocked(reviseBotMessage).mock.calls[0]![3]!;
        const postedAt = new Date('2026-10-28T13:30:00Z');
        vi.mocked(getLastReadAtByPageId).mockResolvedValueOnce(null);
        expect(await guard.stillUnread!(postedAt)).toBe(true);
        vi.mocked(getLastReadAtByPageId).mockResolvedValueOnce(new Date('2026-10-28T13:00:00Z'));
        expect(await guard.stillUnread!(postedAt)).toBe(true);
        // Read after it was posted (even before a revision): never revised again.
        vi.mocked(getLastReadAtByPageId).mockResolvedValueOnce(new Date('2026-10-28T13:31:00Z'));
        expect(await guard.stillUnread!(postedAt)).toBe(false);
        expect(getLastReadAtByPageId).toHaveBeenCalledWith('owner', 'page');
    });

    it('leaves the post alone on NO_UPDATE', async () => {
        vi.mocked(runAnthropicWithTools).mockResolvedValueOnce('NO_UPDATE');
        expect(await run({ messageId: 'earlier' })).toBeNull();
        expect(reviseBotMessage).not.toHaveBeenCalled();
        expect(broadcastChatEvent).not.toHaveBeenCalled();
    });
});
