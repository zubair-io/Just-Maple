import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
    queue: [] as { _id: string }[],
    waiting: [] as { id: string; resolve: (text: string) => void; signal?: AbortSignal }[],
}));
vi.mock('../../repositories/assistance.repo', () => ({
    claimAssistance: vi.fn(async () => state.queue.shift() || null),
    renewAssistance: vi.fn(async () => ({})),
    expireAssistanceLeases: vi.fn(async () => {}),
    updateRunningAssistance: vi.fn(async () => ({})),
    completeAssistance: vi.fn(async () => ({})),
    assistanceContext: vi.fn(async () => []),
}));
vi.mock('../assistance-access.service', () => ({
    assistanceAccess: vi.fn(async () => ({
        bot: { _id: 'bot', userId: 'me', config: { apiKey: 'test' } },
        template: { name: 'Maple' },
        llm: { config: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } },
    })),
}));
vi.mock('../mac-data-tools.service', () => ({
    getMacDataToolContext: vi.fn(async () => null),
    macDataSystemPrompt: vi.fn(),
    macDataToolDefinitions: vi.fn(),
    executeMacDataTool: vi.fn(),
}));
vi.mock('../llm-tool-loop.service', async (original) => ({
    ...(await original<object>()),
    runAnthropicWithTools: vi.fn(
        (params: { turns: { content: string }[]; signal: AbortSignal }) =>
            new Promise<string>((resolve) =>
                state.waiting.push({
                    id: params.turns.at(-1)!.content,
                    resolve,
                    signal: params.signal,
                }),
            ),
    ),
}));
import {
    startAssistanceWorker,
    stopAssistanceWorker,
    stopAssistanceTask,
} from '../assistance-runner.service';
import { completeAssistance, updateRunningAssistance } from '../../repositories/assistance.repo';

afterEach(async () => {
    stopAssistanceWorker();
    for (const row of state.waiting) row.resolve('Stopped');
    await Promise.resolve();
});
it('bounds work to two concurrent jobs and cancels a late answer before publishing it', async () => {
    state.queue.push(
        ...['one', 'two', 'three'].map((id) => ({
            _id: id,
            userId: 'me',
            notebookId: 'n',
            conversationId: 'c',
            question: id,
            questionMessageId: id,
            sourceTitle: 'A page',
            sourceRevision: '1',
            sourceText: 'Source data',
            botName: 'Maple',
        })),
    );
    startAssistanceWorker();
    await vi.waitFor(() => expect(state.waiting).toHaveLength(2));
    expect(state.queue).toHaveLength(1);
    stopAssistanceTask('one');
    expect(state.waiting[0]!.signal?.aborted).toBe(true);
    state.waiting[0]!.resolve('Late answer must not appear');
    await vi.waitFor(() => expect(state.waiting).toHaveLength(3));
    expect(completeAssistance).not.toHaveBeenCalled();
    expect(updateRunningAssistance).toHaveBeenCalledWith(
        'one',
        expect.any(String),
        expect.objectContaining({ status: 'failed' }),
    );
    state.waiting[1]!.resolve('Second result');
    state.waiting[2]!.resolve('Third result');
    await vi.waitFor(() => expect(completeAssistance).toHaveBeenCalledTimes(2));
});
