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
    getOrCreateThread: vi.fn(),
    incrementThreadMessageCount: vi.fn(),
    findThreadByParentMessage: vi.fn(),
}));
vi.mock('../../repositories/message.repo', () => ({
    createMessageInThread: vi.fn(),
    markMessageHasThread: vi.fn(),
    findMessagesByThreadId: vi.fn(),
    findMessageById: vi.fn(),
}));
vi.mock('../realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../webhook.service', () => ({
    buildWebhookPayload: vi.fn(),
    invokeWebhookWithRetry: vi.fn(),
}));

import { BotExecutorService } from '../bot-executor.service';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findInvocationById, updateInvocationStatus } from '../../repositories/bot-invocation.repo';
import { getOrCreateThread } from '../../repositories/thread.repo';
import { createMessageInThread, findMessageById } from '../../repositories/message.repo';
import { broadcastChatEvent } from '../realtime.service';

let template: any;
let userBot: any;
let invocation: any;
let fetchMock: ReturnType<typeof vi.fn>;
const uiText = 'A plan.\n```openui\ncard = Card("Plan", "Step one")\nroot = Response([card])\n```';
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
                    config: {
                        model: 'claude-sonnet-4-20250514',
                        userPrompt: '{{$mentionText}}',
                        maxTokens: 4096,
                    },
                },
            ],
        },
    };
    userBot = {
        _id: 'bot',
        userId: 'owner',
        config: { apiKey: 'secret', model: 'claude-opus-4-20250514' },
    };
    invocation = {
        _id: 'invocation',
        userBotId: 'bot',
        templateId: 'template',
        notebookId: 'notebook',
        userId: 'owner',
        sourceId: 'parent',
        sourceType: 'message',
        context: { mentionText: 'Make a plan', pageId: 'page' },
    };
    vi.mocked(findBotTemplateById).mockImplementation(async () => template);
    vi.mocked(findUserBotByIdInternal).mockImplementation(async () => userBot);
    vi.mocked(findInvocationById).mockImplementation(async () => invocation);
    vi.mocked(getOrCreateThread).mockResolvedValue({ _id: 'thread' } as any);
    vi.mocked(findMessageById).mockResolvedValue({ pageId: 'page' } as any);
    vi.mocked(createMessageInThread).mockImplementation(
        async (data) => ({ ...data, id: 'reply-uuid', _id: 'reply-db-id' }) as any,
    );
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: uiText }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
});

describe('bot provider and UI integration', () => {
    it('uses the saved Claude model and persists portable UI with the message page', async () => {
        await new BotExecutorService().execute('invocation');
        const [url, options] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        const body = JSON.parse(options.body);
        expect(body.model).toBe(userBot.config.model);
        expect(body.system).toContain('Response');
        expect(createMessageInThread).toHaveBeenCalledWith(
            expect.objectContaining({
                pageId: 'page',
                botModel: userBot.config.model,
                botUI: {
                    version: 1,
                    format: 'openui',
                    blocks: [{ type: 'card', title: 'Plan', content: 'Step one' }],
                },
            }),
        );
        expect(updateInvocationStatus).toHaveBeenLastCalledWith(
            'invocation',
            'completed',
            expect.objectContaining({ responseMessageId: 'reply-uuid' }),
        );
        expect(broadcastChatEvent).toHaveBeenCalledWith(
            'notebook',
            expect.objectContaining({ action: 'thread_message', pageId: 'page' }),
        );
    });
    it('gives a per-message model override precedence over the saved default', async () => {
        invocation.context.model = 'claude-3-5-haiku-latest';
        await new BotExecutorService().execute('invocation');
        expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe(invocation.context.model);
    });
    it('routes OpenAI through Responses and extracts all output text blocks', async () => {
        template.definition.actions[0].config.provider = 'openai';
        template.definition.actions[0].config.model = 'gpt-4.1';
        userBot.config.model = 'gpt-4.1-mini';
        invocation.context.model = 'gpt-4.1-nano';
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                output: [
                    { type: 'reasoning' },
                    { content: [{ type: 'output_text', text: uiText }] },
                ],
            }),
        });
        await new BotExecutorService().execute('invocation');
        const [url, options] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://api.openai.com/v1/responses');
        expect(JSON.parse(options.body)).toMatchObject({
            model: 'gpt-4.1-nano',
            store: false,
            input: [{ role: 'user', content: 'Make a plan' }],
        });
        expect(createMessageInThread).toHaveBeenCalledWith(
            expect.objectContaining({ botModel: 'gpt-4.1-nano', botUI: expect.any(Object) }),
        );
    });
    it('rejects a model belonging to another provider before using credentials', async () => {
        invocation.context.model = 'gpt-4.1';
        await expect(new BotExecutorService().execute('invocation')).rejects.toThrow(
            'does not match',
        );
        expect(fetchMock).not.toHaveBeenCalled();
        expect(createMessageInThread).not.toHaveBeenCalled();
    });
    it('does not request UI in text-only mode', async () => {
        userBot.config.responseMode = 'text';
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ content: [{ type: 'text', text: 'A text response' }] }),
        });
        await new BotExecutorService().execute('invocation');
        expect(JSON.parse(fetchMock.mock.calls[0]![1].body).system).toBeUndefined();
        expect(createMessageInThread).toHaveBeenCalledWith(
            expect.objectContaining({ botUI: undefined }),
        );
    });
    it.each(['anthropic', 'openai'])(
        'keeps saved UI details in %s follow-up history',
        async (provider) => {
            template.definition.actions[0].config.provider = provider;
            userBot.config.model =
                provider === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-4-20250514';
            invocation.context.previousMessages = [
                {
                    senderType: 'bot',
                    content: 'Here is the plan.',
                    botUI: {
                        version: 1,
                        format: 'openui',
                        blocks: [{ type: 'card', title: 'Option A', content: 'Costs $200' }],
                    },
                },
            ];
            if (provider === 'openai')
                fetchMock.mockResolvedValue({
                    ok: true,
                    json: async () => ({
                        output: [{ content: [{ type: 'output_text', text: 'A follow-up' }] }],
                    }),
                });
            await new BotExecutorService().execute('invocation');
            const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
            const history = provider === 'openai' ? body.input : body.messages;
            expect(JSON.stringify(history)).toContain('Costs $200');
        },
    );
    it('reports OpenAI authentication errors without posting a broken response', async () => {
        template.definition.actions[0].config.provider = 'openai';
        userBot.config.model = 'gpt-4.1';
        fetchMock.mockResolvedValue({ ok: false, status: 401 });
        await expect(new BotExecutorService().execute('invocation')).rejects.toThrow(
            'OpenAI request failed (401)',
        );
        expect(createMessageInThread).not.toHaveBeenCalled();
        expect(updateInvocationStatus).toHaveBeenLastCalledWith(
            'invocation',
            'failed',
            expect.objectContaining({
                error: expect.objectContaining({ code: 'EXECUTION_ERROR' }),
            }),
        );
    });
});
