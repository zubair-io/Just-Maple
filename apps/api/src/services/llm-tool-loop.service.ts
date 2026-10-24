import type { ToolDefinition } from './mac-data-tools.service';

/**
 * Minimal tool-calling loops for the bot providers, using each provider's native
 * format. Only the tools passed in can run; there is no shell, file or network access.
 */

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface ToolLoopParams {
    apiKey: string;
    model: string;
    system?: string;
    turns: ChatTurn[];
    maxTokens: number;
    tools: ToolDefinition[];
    execute: (name: string, input: Record<string, unknown>) => Promise<string>;
}

const MAX_ROUNDS = 6;
const REQUEST_TIMEOUT_MS = 55_000;

// MARK: - Anthropic

interface AnthropicBlock {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
}

/** Claude Messages API. Subscription (OAuth) tokens use a bearer header and the OAuth beta. */
export async function runAnthropicWithTools(
    params: ToolLoopParams & { isOAuthToken?: boolean },
): Promise<string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...(params.isOAuthToken
            ? { Authorization: `Bearer ${params.apiKey}`, 'anthropic-beta': 'oauth-2025-04-20' }
            : { 'x-api-key': params.apiKey }),
    };
    const messages: Array<{ role: string; content: string | unknown[] }> = mergeTurns(params.turns);
    const tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));

    for (let round = 0; round <= MAX_ROUNDS; round++) {
        const lastRound = round === MAX_ROUNDS;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
                model: params.model,
                max_tokens: params.maxTokens,
                ...(params.system ? { system: params.system } : {}),
                messages,
                tools,
                // On the last round, force a written answer from what was gathered.
                ...(lastRound ? { tool_choice: { type: 'none' } } : {}),
            }),
        });
        if (!response.ok) {
            throw new Error(`Claude API error: ${response.status} - ${await response.text()}`);
        }
        const data = (await response.json()) as { content: AnthropicBlock[]; stop_reason: string };
        const toolUses = data.content.filter((block) => block.type === 'tool_use');
        if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
            return data.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text || '')
                .join('');
        }
        messages.push({ role: 'assistant', content: data.content });
        const results = await Promise.all(
            toolUses.map(async (block) => ({
                type: 'tool_result',
                tool_use_id: block.id,
                content: await params.execute(block.name || '', block.input || {}),
            })),
        );
        messages.push({ role: 'user', content: results });
    }
    return '';
}

// MARK: - OpenAI

interface OpenAIOutputItem {
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{ type: string; text?: string }>;
}

/** OpenAI Responses API with function tools. */
export async function runOpenAIWithTools(params: ToolLoopParams): Promise<string> {
    const input: unknown[] = params.turns.map((turn) => ({
        role: turn.role,
        content: turn.content,
    }));
    const tools = params.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }));

    for (let round = 0; round <= MAX_ROUNDS; round++) {
        const lastRound = round === MAX_ROUNDS;
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${params.apiKey}`,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
                model: params.model,
                instructions: params.system,
                input,
                tools,
                tool_choice: lastRound ? 'none' : 'auto',
                max_output_tokens: params.maxTokens,
                store: false,
                // Without storage, reasoning models need their reasoning sent back encrypted.
                include: ['reasoning.encrypted_content'],
            }),
        });
        if (!response.ok) {
            throw new Error(
                `OpenAI request failed (${response.status}). Check the model and API key in bot settings.`,
            );
        }
        const data = (await response.json()) as { output?: OpenAIOutputItem[] };
        const output = data.output || [];
        const calls = output.filter((item) => item.type === 'function_call');
        if (calls.length === 0) {
            return output
                .flatMap((item) => item.content || [])
                .filter((block) => block.type === 'output_text')
                .map((block) => block.text || '')
                .join('');
        }
        // With store: false the conversation is replayed, including the model's own items.
        input.push(...output);
        for (const call of calls) {
            let args: Record<string, unknown> = {};
            try {
                args = JSON.parse(call.arguments || '{}');
            } catch {
                // Leave args empty; the tool reports what's missing.
            }
            input.push({
                type: 'function_call_output',
                call_id: call.call_id,
                output: await params.execute(call.name || '', args),
            });
        }
    }
    return '';
}

/** Claude requires alternating roles; merge consecutive turns from the same side. */
function mergeTurns(turns: ChatTurn[]): Array<{ role: string; content: string }> {
    const merged: Array<{ role: string; content: string }> = [];
    for (const turn of turns) {
        const last = merged.at(-1);
        if (last && last.role === turn.role) last.content += `\n\n${turn.content}`;
        else merged.push({ role: turn.role, content: turn.content });
    }
    if (merged[0]?.role === 'assistant')
        merged.unshift({ role: 'user', content: '(conversation start)' });
    return merged;
}
