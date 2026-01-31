import type { AIWritingType, AIWritingRequest } from '@maple/shared';
import { findUserBotByHandleForNotebookInternal } from '../repositories/user-bot.repo';

// Configuration
const DEFAULT_LLM_MODEL = process.env.AI_WRITING_MODEL || 'claude-sonnet-4-20250514';
const MAX_CONTEXT_CHARS = 8000; // ~2000 tokens

/**
 * Prompt templates for each AI writing action
 */
const PROMPTS: Record<AIWritingType, string> = {
    continue: `Continue writing naturally from where this text ends.
Match the tone and style. Output only the continuation, no explanations.

Context:
{context}

Continue from here:
{selection}`,

    improve: `Improve the clarity and readability of the following text.
Fix awkward phrasing, improve word choice, and enhance flow.
Keep the same meaning and approximate length. Output only the improved text.

Text to improve:
{selection}`,

    simplify: `Simplify this text to make it easier to understand.
Use simpler words and shorter sentences. Keep the core meaning.
Output only the simplified text.

Text to simplify:
{selection}`,

    expand: `Expand on this text with more detail, examples, or explanation.
Maintain the same tone and style. Output only the expanded text.

Text to expand:
{selection}`,

    shorten: `Make this text more concise while keeping the key information.
Remove redundancy and unnecessary words. Output only the shortened text.

Text to shorten:
{selection}`,

    summarize: `Write a brief summary of this text in 2-3 sentences.
Summarize WHAT the text says, not what "the author" or "the narrator" does.
Write as if you are the author condensing your own notes.
Do not use phrases like "The text discusses...", "The author explains...", or "The narrator describes...".
Just state the key points directly.

Text:
{selection}`,

    grammar: `Fix all grammar, spelling, and punctuation errors in this text.
Do not change the meaning or style. Output only the corrected text.

Text to fix:
{selection}`,

    translate: `Translate this text to {targetLanguage}.
Maintain the tone and meaning. Output only the translation.

Text to translate:
{selection}`,

    custom: `{instruction}

Context:
{context}

Selected text (if any):
{selection}`,
};

/**
 * Build a prompt from template and request parameters
 */
function buildPrompt(request: AIWritingRequest): string {
    let template = PROMPTS[request.type];

    // Replace placeholders
    template = template.replace('{context}', truncateContext(request.context));
    template = template.replace('{selection}', request.selection || '');
    template = template.replace('{instruction}', request.instruction || '');
    template = template.replace('{targetLanguage}', request.targetLanguage || 'English');

    return template.trim();
}

/**
 * Truncate context to fit within token limits
 */
function truncateContext(context: string): string {
    if (context.length <= MAX_CONTEXT_CHARS) {
        return context;
    }

    // Truncate from the beginning, keeping the most recent context
    const truncated = context.slice(-MAX_CONTEXT_CHARS);
    return `[...truncated...]\n${truncated}`;
}

/**
 * AI Writing Service
 * Handles AI-powered writing assistance with streaming responses
 */
export class AIWritingService {
    /**
     * Generate AI content with streaming response
     * Returns an async generator that yields text chunks
     */
    async *generateStream(
        notebookId: string,
        request: AIWritingRequest,
    ): AsyncGenerator<{ type: 'token' | 'done' | 'error'; data: unknown }> {
        // Find Claude bot for this notebook to get API key
        const userBot = await findUserBotByHandleForNotebookInternal('claude', notebookId);

        if (!userBot) {
            yield {
                type: 'error',
                data: {
                    error: 'Claude bot not found. Please ensure you have registered a Claude bot and shared it with this notebook.',
                },
            };
            return;
        }

        const apiKey = userBot.config?.apiKey;
        if (!apiKey) {
            yield {
                type: 'error',
                data: { error: 'Claude API key not configured for the bot.' },
            };
            return;
        }

        const isOAuthToken = userBot.config?.isOAuthToken || false;

        // Build the prompt
        const userPrompt = buildPrompt(request);

        // System prompt for writing assistance
        const systemPrompt = `You are a helpful writing assistant. Your task is to help users with their writing.
Follow the instructions carefully and output only the requested text, without any explanations or preambles.
Maintain the original language unless asked to translate.
Be concise and direct in your responses.`;

        // Prepend Claude Code prefix for OAuth tokens
        const finalSystemPrompt = isOAuthToken
            ? `You are Claude Code, Anthropic's official CLI for Claude.\n\n${systemPrompt}`
            : systemPrompt;

        try {
            // Call Claude API with streaming
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01',
                    'x-api-key': apiKey,
                },
                body: JSON.stringify({
                    model: DEFAULT_LLM_MODEL,
                    max_tokens: 2048,
                    system: finalSystemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                    stream: true,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                yield {
                    type: 'error',
                    data: { error: `Claude API error: ${response.status} - ${errorText}` },
                };
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
                yield { type: 'error', data: { error: 'Failed to get response stream' } };
                return;
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let totalTokens = 0;
            let finishReason = 'stop';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const event = JSON.parse(data);

                            if (event.type === 'content_block_delta') {
                                const text = event.delta?.text;
                                if (text) {
                                    yield { type: 'token', data: { text } };
                                }
                            } else if (event.type === 'message_delta') {
                                if (event.usage?.output_tokens) {
                                    totalTokens = event.usage.output_tokens;
                                }
                                if (event.delta?.stop_reason) {
                                    finishReason = event.delta.stop_reason;
                                }
                            } else if (event.type === 'message_stop') {
                                // Stream complete
                            } else if (event.type === 'error') {
                                yield {
                                    type: 'error',
                                    data: { error: event.error?.message || 'Unknown error' },
                                };
                                return;
                            }
                        } catch {
                            // Skip invalid JSON
                        }
                    }
                }
            }

            // Emit done event
            yield {
                type: 'done',
                data: { tokensUsed: totalTokens, finishReason },
            };
        } catch (error) {
            yield {
                type: 'error',
                data: { error: error instanceof Error ? error.message : 'Unknown error' },
            };
        }
    }

    /**
     * Generate AI content without streaming (for simpler use cases)
     */
    async generate(notebookId: string, request: AIWritingRequest): Promise<string> {
        let result = '';

        for await (const event of this.generateStream(notebookId, request)) {
            if (event.type === 'token') {
                result += (event.data as { text: string }).text;
            } else if (event.type === 'error') {
                throw new Error((event.data as { error: string }).error);
            }
        }

        return result;
    }
}

// Singleton instance
export const aiWritingService = new AIWritingService();
