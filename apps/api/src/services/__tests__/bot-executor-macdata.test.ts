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
vi.mock('../llm-tool-loop.service', async (importOriginal) => ({
    // Chat completions run for real against the stubbed fetch.
    ...(await importOriginal<typeof import('../llm-tool-loop.service')>()),
    runAnthropicWithTools: vi.fn().mockResolvedValue('Practice is at 2:30.'),
    runOpenAIWithTools: vi.fn().mockResolvedValue('From OpenAI.'),
}));
vi.mock('node:dns/promises', () => ({
    lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34' }]),
}));

import { BotExecutorService } from '../bot-executor.service';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findInvocationById, updateInvocationStatus } from '../../repositories/bot-invocation.repo';
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
            status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
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

    describe('custom OpenAI-compatible servers', () => {
        const reply = (message: unknown, status = 200) => ({
            ok: status < 400,
            status,
            text: async () =>
                status < 400
                    ? JSON.stringify({ choices: [{ message }] })
                    : 'tools are not supported',
        });
        beforeEach(() => {
            template.definition.actions[0].config = {
                provider: 'openai-compatible',
                userPrompt: '{{$mentionText}}',
            };
            userBot.displayName = 'Groq';
            userBot.config = {
                apiKey: 'groq-key',
                baseUrl: 'https://llm.example.com/v1',
                model: 'meta-llama/llama-3.3-70b',
            };
        });

        it('calls the saved server with the Mac data tools', async () => {
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce(
                    reply({
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: 'call1',
                                function: {
                                    name: 'search_local_data',
                                    arguments: '{"query":"practice"}',
                                },
                            },
                        ],
                    }),
                )
                .mockResolvedValueOnce(reply({ role: 'assistant', content: 'At 2:30.' }));
            vi.stubGlobal('fetch', fetchMock);
            await new BotExecutorService().execute('invocation');
            expect(fetchMock.mock.calls[0]![0]).toBe('https://llm.example.com/v1/chat/completions');
            expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer groq-key');
            const first = JSON.parse(fetchMock.mock.calls[0]![1].body);
            expect(first.model).toBe('meta-llama/llama-3.3-70b');
            expect(first.tools[0].function.name).toBe('search_local_data');
            const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
            expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call1' });
            expect(executeMacDataTool).toHaveBeenCalledWith(
                expect.anything(),
                'search_local_data',
                { query: 'practice' },
            );
            expect(createMessageInThread).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('answers from one search when the server rejects tools', async () => {
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce(reply(null, 400))
                .mockResolvedValueOnce(reply({ role: 'assistant', content: 'At 2:30.' }));
            vi.stubGlobal('fetch', fetchMock);
            await new BotExecutorService().execute('invocation');
            const retry = JSON.parse(fetchMock.mock.calls[1]![1].body);
            expect(retry.tools).toBeUndefined();
            expect(retry.messages[0].content).toContain('"mail:1"');
            expect(createMessageInThread).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('calls an open server without a key or auth header', async () => {
            delete userBot.config.apiKey;
            const fetchMock = vi
                .fn()
                .mockResolvedValue(reply({ role: 'assistant', content: 'Hi' }));
            vi.stubGlobal('fetch', fetchMock);
            await new BotExecutorService().execute('invocation');
            expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined();
            expect(createMessageInThread).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it("refuses a server on the user's own machine instead of calling it", async () => {
            userBot.config.baseUrl = 'http://localhost:11434/v1';
            const fetchMock = vi.fn();
            vi.stubGlobal('fetch', fetchMock);
            await expect(new BotExecutorService().execute('invocation')).rejects.toThrow('tunnel');
            expect(fetchMock).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('refuses an internet name that points into a private network', async () => {
            userBot.config.baseUrl = 'https://intranet.example.com/v1';
            const dns = await import('node:dns/promises');
            vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: '10.1.2.3' }] as never);
            const fetchMock = vi.fn();
            vi.stubGlobal('fetch', fetchMock);
            await expect(new BotExecutorService().execute('invocation')).rejects.toThrow(
                'private networks',
            );
            expect(fetchMock).not.toHaveBeenCalled();
            expect(updateInvocationStatus).toHaveBeenCalledWith(
                'invocation',
                'failed',
                expect.anything(),
            );
            vi.unstubAllGlobals();
        });
    });

    it('keeps ordinary replies in a thread even if an old invocation requests top-level output', async () => {
        invocation.context.replyTopLevel = true;
        await new BotExecutorService().execute('invocation');
        expect(createMessageInThread).toHaveBeenCalled();
        expect(createTopLevelBotMessage).not.toHaveBeenCalled();
    });

    it('answers in the conversation itself on a proactive page', async () => {
        invocation.context.replyTopLevel = true;
        vi.mocked(findPageByIdForBot).mockResolvedValue({
            id: 'page',
            notebookId: 'notebook',
            proactive: { enabled: true, userBotId: userBot._id, ownerUserId: invocation.userId },
        } as any);
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
            'page',
            'mongo',
            undefined,
            'Claude',
            undefined,
            expect.anything(),
        );
    });
});
