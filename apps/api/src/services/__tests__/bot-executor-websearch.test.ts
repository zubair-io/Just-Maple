import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../../repositories/web-search-usage.repo', () => ({
    incrementWebSearchUsage: vi.fn().mockResolvedValue(1),
}));
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
        { name: 'search_local_data', description: 'Search', parameters: { type: 'object' } },
    ]),
    executeMacDataTool: vi.fn().mockResolvedValue('{"results":[]}'),
}));
vi.mock('node:dns/promises', () => ({
    lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

import { BotExecutorService } from '../bot-executor.service';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findInvocationById } from '../../repositories/bot-invocation.repo';
import { createMessageInThread, findMessageById } from '../../repositories/message.repo';
import { findPageByIdForBot } from '../../repositories/page.repo';
import { incrementWebSearchUsage } from '../../repositories/web-search-usage.repo';
import { getMacDataToolContext } from '../mac-data-tools.service';

let template: any;
let userBot: any;
let invocation: any;
let requests: Array<{ url: string; body: any; headers: Record<string, string> }>;

const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const braveReply = {
    web: {
        results: [
            {
                title: 'Maple Festival 2026',
                url: 'https://festival.example/2026',
                description: 'Dates and tickets',
                page_age: '2026-10-01',
            },
        ],
    },
};

/** Answers every provider: one tool call to web_search first, then a text reply. */
function stubProviders(finalText = 'The festival is on Nov 2.') {
    requests = [];
    let round = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init: RequestInit = {}) => {
            const url = String(input);
            const body = init.body ? JSON.parse(String(init.body)) : undefined;
            requests.push({ url, body, headers: (init.headers || {}) as Record<string, string> });
            if (url.startsWith('https://api.search.brave.com/')) return json(braveReply);
            const first = round++ === 0;
            if (url === 'https://api.anthropic.com/v1/messages') {
                return json(
                    first
                        ? {
                              stop_reason: 'tool_use',
                              content: [
                                  {
                                      type: 'tool_use',
                                      id: 't1',
                                      name: 'web_search',
                                      input: { query: 'maple festival dates' },
                                  },
                              ],
                          }
                        : { stop_reason: 'end_turn', content: [{ type: 'text', text: finalText }] },
                );
            }
            if (url === 'https://api.openai.com/v1/responses') {
                return json({
                    output: first
                        ? [
                              {
                                  type: 'function_call',
                                  call_id: 'c1',
                                  name: 'web_search',
                                  arguments: '{"query":"maple festival dates"}',
                              },
                          ]
                        : [
                              {
                                  type: 'message',
                                  content: [{ type: 'output_text', text: finalText }],
                              },
                          ],
                });
            }
            if (url === 'https://llm.example.com/v1/chat/completions') {
                return json({
                    choices: [
                        {
                            message: first
                                ? {
                                      role: 'assistant',
                                      content: null,
                                      tool_calls: [
                                          {
                                              id: 'call1',
                                              function: {
                                                  name: 'web_search',
                                                  arguments: '{"query":"maple festival dates"}',
                                              },
                                          },
                                      ],
                                  }
                                : { role: 'assistant', content: finalText },
                        },
                    ],
                });
            }
            throw new Error(`Unexpected request to ${url}`);
        }),
    );
}

const llmRequests = () => requests.filter((r) => !r.url.includes('search.brave.com'));
const braveRequests = () => requests.filter((r) => r.url.includes('search.brave.com'));
const replyText = () => JSON.stringify(vi.mocked(createMessageInThread).mock.calls[0]![0].content);

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-test-key');
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
    userBot = {
        _id: 'bot',
        userId: 'owner',
        config: { apiKey: 'secret', responseMode: 'text', webSearch: true },
    };
    invocation = {
        _id: 'invocation',
        userBotId: 'bot',
        templateId: 'template',
        notebookId: 'notebook',
        userId: 'member',
        sourceId: 'source',
        sourceType: 'message',
        context: { mentionText: 'When is the maple festival?' },
    };
    vi.mocked(findBotTemplateById).mockImplementation(async () => template);
    vi.mocked(findUserBotByIdInternal).mockImplementation(async () => userBot);
    vi.mocked(findInvocationById).mockImplementation(async () => invocation);
    vi.mocked(findMessageById).mockResolvedValue({ id: 'source', pageId: 'page' } as any);
    vi.mocked(findPageByIdForBot).mockResolvedValue({ id: 'page', notebookId: 'notebook' } as any);
    vi.mocked(getMacDataToolContext).mockResolvedValue(null);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('web search tools for every provider', () => {
    it('Claude gets them as input_schema tools and runs the search', async () => {
        stubProviders();
        await new BotExecutorService().execute('invocation');
        const [first, second] = llmRequests();
        expect(first!.body.tools.map((t: any) => t.name)).toEqual(['web_search', 'fetch_page']);
        expect(first!.body.tools[0].input_schema).toMatchObject({ required: ['query'] });
        expect(first!.body.system).toMatch(/never put the user's personal details/);
        // The search ran against Brave with the server key, counted against the bot owner.
        expect(braveRequests()[0]!.headers['X-Subscription-Token']).toBe('brave-test-key');
        expect(incrementWebSearchUsage).toHaveBeenCalledWith('owner');
        // The result went back to the model as untrusted content.
        const toolResult = second!.body.messages.at(-1).content[0];
        expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
        expect(toolResult.content).toMatch(/^<untrusted_web_content source="web_search">/);
        expect(toolResult.content).toContain('https://festival.example/2026');
    });

    it('OpenAI gets them as function tools', async () => {
        template.definition.actions[0].config = {
            provider: 'openai',
            model: 'gpt-5.5',
            userPrompt: '{{$mentionText}}',
        };
        stubProviders();
        await new BotExecutorService().execute('invocation');
        const [first, second] = llmRequests();
        expect(first!.url).toBe('https://api.openai.com/v1/responses');
        expect(first!.body.tools).toEqual([
            expect.objectContaining({
                type: 'function',
                name: 'web_search',
                parameters: expect.objectContaining({ required: ['query'] }),
            }),
            expect.objectContaining({ type: 'function', name: 'fetch_page' }),
        ]);
        expect(second!.body.input.at(-1)).toMatchObject({
            type: 'function_call_output',
            call_id: 'c1',
        });
        expect(second!.body.input.at(-1).output).toContain('untrusted_web_content');
    });

    it('OpenRouter-style servers get them as chat-completions functions', async () => {
        template.definition.actions[0].config = {
            provider: 'openai-compatible',
            userPrompt: '{{$mentionText}}',
        };
        userBot.config = {
            apiKey: 'router-key',
            baseUrl: 'https://llm.example.com/v1',
            model: 'anthropic/claude-sonnet-4.5',
            responseMode: 'text',
            webSearch: true,
        };
        stubProviders();
        await new BotExecutorService().execute('invocation');
        const [first, second] = llmRequests();
        expect(first!.body.tools.map((t: any) => t.function.name)).toEqual([
            'web_search',
            'fetch_page',
        ]);
        expect(first!.body.tools[0]).toMatchObject({ type: 'function' });
        expect(second!.body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call1' });
    });

    it('adds a sources list when the reply forgot its links', async () => {
        stubProviders('The festival is on Nov 2.');
        await new BotExecutorService().execute('invocation');
        expect(replyText()).toContain('https://festival.example/2026');
        expect(replyText()).toContain('Sources');
    });

    it('offers no tools when the bot has web search off', async () => {
        userBot.config.webSearch = false;
        stubProviders();
        await new BotExecutorService().execute('invocation');
        expect(llmRequests()[0]!.body.tools).toBeUndefined();
        expect(braveRequests()).toHaveLength(0);
    });

    it('offers no tools when the server has no search key', async () => {
        vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
        stubProviders();
        await new BotExecutorService().execute('invocation');
        expect(llmRequests()[0]!.body.tools).toBeUndefined();
        expect(llmRequests()[0]!.body.system ?? '').not.toContain('web_search');
    });

    it('offers the web tools alongside Mac data tools', async () => {
        vi.mocked(getMacDataToolContext).mockResolvedValue({
            userId: 'member',
            notebookId: 'notebook',
            sources: ['mail'],
            timeZone: 'UTC',
            now: 'now',
        } as any);
        stubProviders();
        await new BotExecutorService().execute('invocation');
        expect(llmRequests()[0]!.body.tools.map((t: any) => t.name)).toEqual([
            'search_local_data',
            'web_search',
            'fetch_page',
        ]);
    });
});

describe('proactive runs', () => {
    const run = () =>
        new BotExecutorService().runProactive({
            page: { id: 'page', notebookId: 'notebook' } as any,
            userBot,
            template,
            macData: {
                userId: 'owner',
                notebookId: 'notebook',
                sources: ['mail'],
                timeZone: 'UTC',
                now: 'now',
            } as any,
            system: 'Proactive system',
            prompt: 'Anything new?',
            previousMessages: [],
        });

    it('may not search unless proactive search is turned on', async () => {
        stubProviders();
        await run();
        expect(llmRequests()[0]!.body.tools.map((t: any) => t.name)).toEqual(['search_local_data']);
    });

    it('may search when proactive search is turned on', async () => {
        userBot.config.webSearchProactive = true;
        stubProviders();
        await run();
        expect(llmRequests()[0]!.body.tools.map((t: any) => t.name)).toContain('web_search');
        expect(braveRequests()).toHaveLength(1);
    });
});
