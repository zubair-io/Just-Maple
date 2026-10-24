import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
vi.mock('../../repositories/bot-template.repo', () => ({ findBotTemplateById: vi.fn() }));
vi.mock('../../repositories/user-bot.repo', () => ({ findUserBotByIdInternal: vi.fn() }));
vi.mock('../../repositories/bot-invocation.repo', () => ({
    findInvocationById: vi.fn(),
    updateInvocationStatus: vi.fn(),
    createInvocation: vi.fn(),
}));
vi.mock('../../repositories/thread.repo', () => ({
    getOrCreateThread: vi.fn().mockResolvedValue({ _id: 'thread' }),
    incrementThreadMessageCount: vi.fn(),
    findThreadByParentMessage: vi.fn(),
}));
vi.mock('../../repositories/message.repo', () => ({
    createMessageInThread: vi.fn().mockResolvedValue({ id: 'reply' }),
    createTopLevelBotMessage: vi.fn().mockResolvedValue({ _id: 'mongo', id: 'top' }),
    markMessageHasThread: vi.fn(),
    findMessagesByThreadId: vi.fn(),
    findMessageById: vi.fn(),
}));
vi.mock('../../repositories/page.repo', () => ({ findPageByIdForBot: vi.fn() }));
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
    macDataToolDefinitions: vi.fn(() => [{ name: 'search_local_data' }]),
    executeMacDataTool: vi.fn().mockResolvedValue('{"results":[{"id":"mail:1"}]}'),
}));
vi.mock('../llm-tool-loop.service', () => ({
    runAnthropicWithTools: vi.fn().mockResolvedValue('Practice is at 2:30.'),
    runOpenAIWithTools: vi.fn().mockResolvedValue('From OpenAI.'),
}));

import { BotExecutorService } from '../bot-executor.service';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findInvocationById } from '../../repositories/bot-invocation.repo';
import {
    createMessageInThread,
    createTopLevelBotMessage,
    findMessageById,
} from '../../repositories/message.repo';
import { findPageByIdForBot } from '../../repositories/page.repo';
import { sendMessageReceivedNotification } from '../notification.service';
import { getMacDataToolContext, executeMacDataTool } from '../mac-data-tools.service';
import { runAnthropicWithTools } from '../llm-tool-loop.service';

const macData = {
    userId: 'owner',
    notebookId: 'notebook',
    sources: ['mail'],
    online: true,
    timeZone: 'UTC',
    now: 'now',
};
let template: any;
let userBot: any;
let invocation: any;

beforeEach(() => {
    vi.clearAllMocks();
    template = {
        _id: 'template',
        name: 'Claude',
        definition: {
            actions: [
                {
                    type: 'llm',
                    id: 'reply',
                    config: { model: 'claude-haiku-5-5', userPrompt: '{{$mentionText}}' },
                },
            ],
        },
    };
    userBot = { _id: 'bot', userId: 'owner', config: { apiKey: 'secret', isOAuthToken: true } };
    invocation = {
        _id: 'invocation',
        userBotId: 'bot',
        templateId: 'template',
        notebookId: 'notebook',
        userId: 'owner',
        sourceId: 'source',
        sourceType: 'message',
        context: { mentionText: 'What time is practice?' },
    };
    vi.mocked(findBotTemplateById).mockImplementation(async () => template);
    vi.mocked(findUserBotByIdInternal).mockImplementation(async () => userBot);
    vi.mocked(findInvocationById).mockImplementation(async () => invocation);
    vi.mocked(findMessageById).mockResolvedValue({ id: 'source', pageId: 'page' } as any);
    vi.mocked(findPageByIdForBot).mockResolvedValue({ id: 'page', notebookId: 'notebook' } as any);
    vi.mocked(getMacDataToolContext).mockResolvedValue({ ...macData } as any);
});

describe('bots with Mac data', () => {
    it('gives Claude bots the local-data tools, with their own model and OAuth token', async () => {
        await new BotExecutorService().execute('invocation');
        const call = vi.mocked(runAnthropicWithTools).mock.calls[0]![0];
        expect(call).toMatchObject({
            apiKey: 'secret',
            isOAuthToken: true,
            model: 'claude-haiku-5-5',
        });
        expect(call.system).toMatch(/^You are Claude Code/);
        expect(call.system).toContain('MAC DATA PROMPT');
        expect(call.turns.at(-1)).toEqual({ role: 'user', content: 'What time is practice?' });
        expect(createMessageInThread).toHaveBeenCalled();
    });

    it('runs exactly as before when the notebook has no Mac data', async () => {
        vi.mocked(getMacDataToolContext).mockResolvedValue(null);
        userBot.config.isOAuthToken = false;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ content: [{ type: 'text', text: 'Hi' }] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        await new BotExecutorService().execute('invocation');
        expect(runAnthropicWithTools).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.anthropic.com/v1/messages',
            expect.anything(),
        );
        vi.unstubAllGlobals();
    });

    it('searches up front for Inception bots, which cannot call tools', async () => {
        template.definition.actions[0].config = {
            provider: 'inception',
            model: 'mercury-2',
            userPrompt: '{{$mentionText}}',
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        await new BotExecutorService().execute('invocation');
        expect(executeMacDataTool).toHaveBeenCalledWith(expect.anything(), 'search_local_data', {
            query: 'What time is practice?',
        });
        const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
        expect(body.messages[0].content).toContain('"mail:1"');
        vi.unstubAllGlobals();
    });

    it('answers in the conversation itself on a proactive page', async () => {
        invocation.context.replyTopLevel = true;
        await new BotExecutorService().execute('invocation');
        expect(createTopLevelBotMessage).toHaveBeenCalledWith(
            expect.objectContaining({ pageId: 'page', userBotId: 'bot' }),
        );
        expect(createMessageInThread).not.toHaveBeenCalled();
    });
});

describe('runProactive', () => {
    const run = () =>
        new BotExecutorService().runProactive({
            page: { id: 'page', notebookId: 'notebook', title: 'Family' } as any,
            userBot,
            template,
            macData: macData as any,
            system: 'PROACTIVE',
            prompt: 'batch',
            previousMessages: [],
        });

    it('stays quiet on NO_UPDATE', async () => {
        vi.mocked(runAnthropicWithTools).mockResolvedValueOnce('NO_UPDATE');
        expect(await run()).toBeNull();
        expect(createTopLevelBotMessage).not.toHaveBeenCalled();
    });

    it('posts and notifies the Mac owner when there is news', async () => {
        vi.mocked(runAnthropicWithTools).mockResolvedValueOnce(
            'UPS now expects the package by 5pm.',
        );
        expect(await run()).toMatchObject({ id: 'top' });
        const call = vi.mocked(runAnthropicWithTools).mock.calls[0]![0];
        expect(call.system).toContain('PROACTIVE');
        expect(call.turns.at(-1)).toEqual({ role: 'user', content: 'batch' });
        expect(sendMessageReceivedNotification).toHaveBeenCalledWith(
            'owner',
            'notebook',
            'mongo',
            undefined,
            'Claude',
            undefined,
            expect.anything(),
        );
    });
});
