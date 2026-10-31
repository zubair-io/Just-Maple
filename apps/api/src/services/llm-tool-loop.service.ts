import type { ToolDefinition } from './mac-data-tools.service';
import { assertBotRequestUrl } from '../utils/url-safety';

/**
 * Minimal tool-calling loops for the bot providers, using each provider's native
 * format. Only the tools passed in can run; there is no shell, file or network access.
 */

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface ToolLoopParams {
    signal?: AbortSignal;
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
        params.signal?.throwIfAborted();
        const lastRound = round === MAX_ROUNDS;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            signal: params.signal
                ? AbortSignal.any([params.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
                : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
        params.signal?.throwIfAborted();
        const lastRound = round === MAX_ROUNDS;
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${params.apiKey}`,
            },
            signal: params.signal
                ? AbortSignal.any([params.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
                : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

// MARK: - OpenAI-compatible chat completions

/** Any server that speaks OpenAI's chat completions API: Inception, OpenRouter, Groq, vLLM… */
/** One HTTP request and its raw reply, so a call can go out from the API or from a Mac. */
export interface HttpRequest {
    signal?: AbortSignal;
    method: 'GET' | 'POST';
    url: string;
    headers: Record<string, string>;
    body?: string;
}
export interface HttpResponse {
    status: number;
    body: string;
}
export type HttpSend = (request: HttpRequest) => Promise<HttpResponse>;

/** The API's own fetch. The URL was checked first, so redirects are refused. */
export const fetchSend: HttpSend = async (request) => {
    // Check the name again right before connecting, so a DNS answer that changed since
    // the bot's URL was saved can't point the request into a private network.
    await assertBotRequestUrl(request.url);
    const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal: request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: response.status, body: await response.text() };
};

export interface ChatCompletionsTarget {
    /** API root, e.g. https://openrouter.ai/api/v1. "/chat/completions" is appended. */
    baseUrl: string;
    /** Shown in errors, e.g. the bot's name. */
    label: string;
    /** How requests go out; the owner's Mac for local servers. Defaults to the API's fetch. */
    send?: HttpSend;
}

export class ChatCompletionsError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

interface ChatCompletionsMessage {
    role: string;
    content?: string | Array<{ type: string; text?: string }> | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
    tool_call_id?: string;
}

async function postChatCompletions(
    params: ChatCompletionsTarget & { apiKey: string; signal?: AbortSignal },
    body: Record<string, unknown>,
): Promise<ChatCompletionsMessage> {
    const response = await (params.send ?? fetchSend)({
        method: 'POST',
        signal: params.signal,
        url: `${params.baseUrl}/chat/completions`,
        headers: {
            'Content-Type': 'application/json',
            ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
    });
    if (response.status < 200 || response.status >= 300) {
        const detail = response.body.slice(0, 300);
        throw new ChatCompletionsError(
            `${params.label} request failed (${response.status})${detail ? `: ${detail}` : ''}`,
            response.status,
        );
    }
    let data: { choices?: Array<{ message?: ChatCompletionsMessage }> };
    try {
        data = JSON.parse(response.body);
    } catch {
        throw new ChatCompletionsError(`${params.label} returned something that isn't JSON`, 502);
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new ChatCompletionsError(`${params.label} returned no reply`, 502);
    return message;
}

function chatCompletionsText(message: ChatCompletionsMessage): string {
    if (typeof message.content === 'string') return message.content;
    return (message.content || []).map((part) => part.text || '').join('');
}

function chatCompletionsMessages(system: string | undefined, turns: ChatTurn[]) {
    return [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...turns.map((turn) => ({ role: turn.role, content: turn.content })),
    ] as ChatCompletionsMessage[];
}

/** One reply, no tools. */
export async function runChatCompletions(
    params: Omit<ToolLoopParams, 'tools' | 'execute'> & ChatCompletionsTarget,
): Promise<string> {
    const message = await postChatCompletions(params, {
        model: params.model,
        messages: chatCompletionsMessages(params.system, params.turns),
        max_tokens: params.maxTokens,
    });
    return chatCompletionsText(message);
}

/** Chat completions with function tools. */
export async function runChatCompletionsWithTools(
    params: ToolLoopParams & ChatCompletionsTarget,
): Promise<string> {
    const messages = chatCompletionsMessages(params.system, params.turns);
    const tools = params.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    for (let round = 0; round <= MAX_ROUNDS; round++) {
        params.signal?.throwIfAborted();
        const lastRound = round === MAX_ROUNDS;
        const message = await postChatCompletions(params, {
            model: params.model,
            messages,
            tools,
            tool_choice: lastRound ? 'none' : 'auto',
            max_tokens: params.maxTokens,
        });
        const calls = message.tool_calls || [];
        if (calls.length === 0) return chatCompletionsText(message);
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
        for (const call of calls) {
            let args: Record<string, unknown> = {};
            try {
                args = JSON.parse(call.function.arguments || '{}');
            } catch {
                // Leave args empty; the tool reports what's missing.
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: await params.execute(call.function.name, args),
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
