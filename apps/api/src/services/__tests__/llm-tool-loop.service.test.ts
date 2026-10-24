import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAnthropicWithTools, runOpenAIWithTools } from '../llm-tool-loop.service';

const tools = [
    { name: 'search_local_data', description: 'Search', parameters: { type: 'object' } },
];
const json = (body: unknown) => ({ ok: true, json: async () => body, text: async () => '' });

afterEach(() => vi.unstubAllGlobals());

describe('runAnthropicWithTools', () => {
    it('runs tool calls and returns the final text', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                json({
                    stop_reason: 'tool_use',
                    content: [
                        { type: 'text', text: 'Let me check.' },
                        {
                            type: 'tool_use',
                            id: 't1',
                            name: 'search_local_data',
                            input: { query: 'lacrosse' },
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(
                json({
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: 'Practice is 2:30.' }],
                }),
            );
        vi.stubGlobal('fetch', fetchMock);
        const execute = vi.fn().mockResolvedValue('{"results":[]}');

        const text = await runAnthropicWithTools({
            apiKey: 'oauth-token',
            isOAuthToken: true,
            model: 'claude-haiku-5-5',
            system: 'system',
            turns: [
                { role: 'assistant', content: 'Earlier bot post' },
                { role: 'user', content: 'What time is practice?' },
            ],
            maxTokens: 1000,
            tools,
            execute,
        });

        expect(text).toBe('Practice is 2:30.');
        expect(execute).toHaveBeenCalledWith('search_local_data', { query: 'lacrosse' });
        const [, first] = fetchMock.mock.calls[0]!;
        expect(first.headers).toMatchObject({
            Authorization: 'Bearer oauth-token',
            'anthropic-beta': 'oauth-2025-04-20',
        });
        const firstBody = JSON.parse(first.body);
        // Claude needs the conversation to start with the user.
        expect(firstBody.messages[0].role).toBe('user');
        expect(firstBody.tools[0]).toMatchObject({
            name: 'search_local_data',
            input_schema: { type: 'object' },
        });
        const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
        expect(secondBody.messages.at(-1)).toEqual({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"results":[]}' }],
        });
    });

    it('surfaces API errors', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }),
        );
        await expect(
            runAnthropicWithTools({
                apiKey: 'k',
                model: 'claude-haiku-5-5',
                turns: [{ role: 'user', content: 'hi' }],
                maxTokens: 10,
                tools,
                execute: vi.fn(),
            }),
        ).rejects.toThrow('Claude API error: 401 - bad key');
    });
});

describe('runOpenAIWithTools', () => {
    it('replays function calls and their outputs', async () => {
        const call = {
            type: 'function_call',
            call_id: 'c1',
            name: 'search_local_data',
            arguments: '{"query":"ups"}',
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ output: [call] }))
            .mockResolvedValueOnce(
                json({
                    output: [
                        {
                            type: 'message',
                            content: [{ type: 'output_text', text: 'Due by 9pm.' }],
                        },
                    ],
                }),
            );
        vi.stubGlobal('fetch', fetchMock);
        const execute = vi.fn().mockResolvedValue('{"results":[1]}');

        const text = await runOpenAIWithTools({
            apiKey: 'k',
            model: 'gpt-5',
            system: 'system',
            turns: [{ role: 'user', content: 'When is UPS coming?' }],
            maxTokens: 1000,
            tools,
            execute,
        });

        expect(text).toBe('Due by 9pm.');
        expect(execute).toHaveBeenCalledWith('search_local_data', { query: 'ups' });
        const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
        expect(second.input.slice(-2)).toEqual([
            call,
            { type: 'function_call_output', call_id: 'c1', output: '{"results":[1]}' },
        ]);
        expect(second.tools[0]).toMatchObject({ type: 'function', name: 'search_local_data' });
    });

    it('forces an answer after the last round', async () => {
        const call = {
            type: 'function_call',
            call_id: 'c',
            name: 'search_local_data',
            arguments: '{}',
        };
        const fetchMock = vi.fn().mockResolvedValue(json({ output: [call] }));
        vi.stubGlobal('fetch', fetchMock);
        await runOpenAIWithTools({
            apiKey: 'k',
            model: 'gpt-5',
            turns: [{ role: 'user', content: 'loop' }],
            maxTokens: 10,
            tools,
            execute: vi.fn().mockResolvedValue('x'),
        });
        expect(fetchMock).toHaveBeenCalledTimes(7);
        expect(JSON.parse(fetchMock.mock.calls[6]![1].body).tool_choice).toBe('none');
    });
});
