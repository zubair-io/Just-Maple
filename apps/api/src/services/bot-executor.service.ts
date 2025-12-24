import type {
    BotInvocation,
    BotTemplate,
    UserBot,
    BotConfig,
    Action,
    ResolvedBot,
    NoteContent,
} from '@maple/shared';
import { findBotTemplateById } from '../repositories/bot-template.repo';
import { findUserBotById } from '../repositories/user-bot.repo';
import {
    findInvocationById,
    updateInvocationStatus,
    createInvocation,
} from '../repositories/bot-invocation.repo';
import { getOrCreateThread, incrementThreadMessageCount } from '../repositories/thread.repo';
import { createMessageInThread, markMessageHasThread } from '../repositories/message.repo';
import { broadcastChatEvent } from './realtime.service';

interface ExecutionContext {
    invocation: BotInvocation;
    template: BotTemplate;
    userBot: UserBot;
    config: BotConfig | undefined;
    variables: Record<string, unknown>;
}

/**
 * Bot Executor Service
 * Handles executing bot actions and posting responses in threads
 */
export class BotExecutorService {
    /**
     * Create and execute a bot invocation
     */
    async invoke(params: {
        userBotId: string;
        sourceType: 'message' | 'note';
        sourceId: string;
        tagId: string;
        userId: string;
        context: BotInvocation['context'];
    }): Promise<BotInvocation> {
        // Get the user bot and template
        const userBot = await findUserBotById(params.userBotId);
        if (!userBot) throw new Error('User bot not found');

        const template = await findBotTemplateById(userBot.templateId);
        if (!template) throw new Error('Bot template not found');

        // Create invocation record
        const invocation = await createInvocation({
            userBotId: params.userBotId,
            templateId: template._id,
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            tagId: params.tagId,
            userId: params.userId,
            context: params.context,
        });

        // Execute asynchronously
        this.execute(invocation._id).catch((error) => {
            console.error(`Bot execution failed for invocation ${invocation._id}:`, error);
        });

        return invocation;
    }

    /**
     * Execute a pending invocation
     */
    async execute(invocationId: string): Promise<void> {
        const startTime = Date.now();

        const invocation = await findInvocationById(invocationId);
        if (!invocation) throw new Error('Invocation not found');

        const userBot = await findUserBotById(invocation.userBotId);
        if (!userBot) throw new Error('User bot not found');

        const template = await findBotTemplateById(invocation.templateId);
        if (!template) throw new Error('Bot template not found');

        const ctx: ExecutionContext = {
            invocation,
            template,
            userBot,
            config: userBot.config,
            variables: {
                // Built-in context variables
                $mentionText: invocation.context.mentionText || '',
                $content: invocation.context.fullContent || '',
                $documentTitle: invocation.context.documentTitle || '',
                $selection: invocation.context.selection || '',
                $previousMessages: invocation.context.previousMessages || [],
                $userId: invocation.userId,
                $tagId: invocation.tagId,
                $sourceType: invocation.sourceType,
                $sourceId: invocation.sourceId,
            },
        };

        try {
            // Update status to running
            await updateInvocationStatus(invocationId, 'running');
            this.broadcastStatus(invocation, 'running');

            // Execute actions sequentially
            for (const action of template.definition.actions) {
                await this.executeAction(action, ctx);
            }

            // Get the response content
            const responseContent = this.prepareResponse(ctx);

            // Create thread and post response
            const { threadId, messageId } = await this.postResponse(
                invocation,
                userBot,
                template,
                responseContent,
            );

            // Calculate execution time
            const executionTimeMs = Date.now() - startTime;

            // Update invocation with completed status
            await updateInvocationStatus(invocationId, 'completed', {
                output: ctx.variables.$response,
                threadId,
                responseMessageId: messageId,
                executionTimeMs,
                variables: ctx.variables as Record<string, unknown>,
            });

            this.broadcastStatus(invocation, 'completed', ctx.variables.$response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await updateInvocationStatus(invocationId, 'failed', {
                error: {
                    code: 'EXECUTION_ERROR',
                    message: errorMessage,
                },
                executionTimeMs: Date.now() - startTime,
            });
            this.broadcastStatus(invocation, 'failed', undefined, errorMessage);
            throw error;
        }
    }

    /**
     * Execute a single action
     */
    private async executeAction(action: Action, ctx: ExecutionContext): Promise<void> {
        switch (action.type) {
            case 'reply':
                this.executeReply(action, ctx);
                break;
            case 'set':
                this.executeSet(action, ctx);
                break;
            case 'llm':
                await this.executeLLM(action, ctx);
                break;
            case 'transform':
                this.executeTransform(action, ctx);
                break;
            case 'http':
                await this.executeHTTP(action, ctx);
                break;
            default:
                console.warn(`Unknown action type: ${action.type}`);
        }
    }

    /**
     * Reply action - sets $response with a simple message
     */
    private executeReply(action: Action, ctx: ExecutionContext): void {
        const config = action.config as { message: string };
        const message = this.interpolate(config.message, ctx.variables);
        ctx.variables.$response = message;
    }

    /**
     * Set action - assigns a value to a variable
     */
    private executeSet(action: Action, ctx: ExecutionContext): void {
        const config = action.config as { variable: string; value: unknown };
        const value =
            typeof config.value === 'string'
                ? this.interpolate(config.value, ctx.variables)
                : config.value;
        ctx.variables[config.variable] = value;
    }

    /**
     * LLM action - calls Claude API
     */
    private async executeLLM(action: Action, ctx: ExecutionContext): Promise<void> {
        const config = action.config as {
            systemPrompt?: string;
            userPrompt: string;
            model?: string;
            maxTokens?: number;
        };

        // Get API key from user's bot config
        const apiKey = ctx.config?.apiKey;
        if (!apiKey) {
            throw new Error('Claude API key not configured');
        }

        const systemPrompt = config.systemPrompt
            ? this.interpolate(config.systemPrompt, ctx.variables)
            : undefined;
        const userPrompt = this.interpolate(config.userPrompt, ctx.variables);

        // Call Claude API
        const response = await this.callClaudeAPI({
            apiKey,
            model: config.model || 'claude-sonnet-4-20250514',
            systemPrompt,
            userPrompt,
            maxTokens: config.maxTokens || 1024,
        });

        // Store result in output variable
        if (action.outputVariable) {
            ctx.variables[action.outputVariable] = response;
        }
        // Also set as $response for convenience
        ctx.variables.$response = response;
    }

    /**
     * Transform action - manipulates data
     */
    private executeTransform(action: Action, ctx: ExecutionContext): void {
        const config = action.config as {
            input: string;
            operations: Array<{ op: string; args?: unknown }>;
        };

        let value = this.resolveVariable(config.input, ctx.variables);

        for (const op of config.operations) {
            value = this.applyTransformOperation(value, op);
        }

        if (action.outputVariable) {
            ctx.variables[action.outputVariable] = value;
        }
    }

    /**
     * HTTP action - makes external API calls
     */
    private async executeHTTP(action: Action, ctx: ExecutionContext): Promise<void> {
        const config = action.config as {
            method: string;
            url: string;
            headers?: Record<string, string>;
            body?: unknown;
            timeout?: number;
        };

        const url = this.interpolate(config.url, ctx.variables);
        const headers = config.headers
            ? Object.fromEntries(
                  Object.entries(config.headers).map(([k, v]) => [
                      k,
                      this.interpolate(v, ctx.variables),
                  ]),
              )
            : undefined;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeout || 30000);

        try {
            const response = await fetch(url, {
                method: config.method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: config.body
                    ? JSON.stringify(this.interpolateObject(config.body, ctx.variables))
                    : undefined,
                signal: controller.signal,
            });

            const data = await response.json();

            if (action.outputVariable) {
                ctx.variables[action.outputVariable] = data;
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Call Claude API
     */
    private async callClaudeAPI(params: {
        apiKey: string;
        model: string;
        systemPrompt?: string;
        userPrompt: string;
        maxTokens: number;
    }): Promise<string> {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': params.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: params.model,
                max_tokens: params.maxTokens,
                system: params.systemPrompt,
                messages: [{ role: 'user', content: params.userPrompt }],
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Claude API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as {
            content: Array<{ type: string; text?: string }>;
        };
        const textContent = data.content.find((c) => c.type === 'text');
        return textContent?.text || '';
    }

    /**
     * Prepare response content for posting
     */
    private prepareResponse(ctx: ExecutionContext): NoteContent {
        const response = String(ctx.variables.$response || '');

        // Create a simple paragraph with the response text
        return {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: response ? [{ type: 'text', text: response }] : [],
                },
            ],
        };
    }

    /**
     * Post bot response in a thread
     */
    private async postResponse(
        invocation: BotInvocation,
        userBot: UserBot,
        template: BotTemplate,
        content: NoteContent,
    ): Promise<{ threadId: string; messageId: string }> {
        // Get or create thread for the parent message
        const thread = await getOrCreateThread({
            parentMessageId: invocation.sourceId,
            tagId: invocation.tagId,
            botInvocationId: invocation._id,
        });

        // Mark the parent message as having a thread
        await markMessageHasThread(invocation.sourceId);

        // Create the bot's response message in the thread
        const message = await createMessageInThread({
            tagId: invocation.tagId,
            threadId: thread._id,
            userId: userBot.userId,
            userBotId: userBot._id,
            senderType: 'bot',
            senderDisplayName: userBot.displayName || template.name,
            senderProfilePictureUrl: template.avatar,
            content,
        });

        // Increment thread message count
        await incrementThreadMessageCount(thread._id);

        // Broadcast thread message event
        await broadcastChatEvent(invocation.tagId, {
            action: 'thread_message',
            data: {
                threadId: thread._id,
                parentMessageId: invocation.sourceId,
                message,
            },
            tagId: invocation.tagId,
            userId: userBot.userId,
            timestamp: new Date().toISOString(),
        });

        return { threadId: thread._id, messageId: message._id };
    }

    /**
     * Interpolate variables in a template string
     */
    private interpolate(template: string, variables: Record<string, unknown>): string {
        return template.replace(/\{\{(\$?\w+(?:\.\w+)*)\}\}/g, (_, path: string) => {
            const value = this.getNestedValue(variables, path);
            return value !== undefined ? String(value) : '';
        });
    }

    /**
     * Interpolate variables in an object
     */
    private interpolateObject(obj: unknown, variables: Record<string, unknown>): unknown {
        if (typeof obj === 'string') {
            return this.interpolate(obj, variables);
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => this.interpolateObject(item, variables));
        }
        if (typeof obj === 'object' && obj !== null) {
            return Object.fromEntries(
                Object.entries(obj).map(([k, v]) => [k, this.interpolateObject(v, variables)]),
            );
        }
        return obj;
    }

    /**
     * Resolve a variable reference
     */
    private resolveVariable(ref: string, variables: Record<string, unknown>): unknown {
        const match = ref.match(/\{\{(\$?\w+(?:\.\w+)*)\}\}/);
        if (!match) return ref;
        return this.getNestedValue(variables, match[1]);
    }

    /**
     * Get nested value from an object
     */
    private getNestedValue(obj: unknown, path: string): unknown {
        return path.split('.').reduce((acc: unknown, key: string) => {
            if (acc && typeof acc === 'object' && key in acc) {
                return (acc as Record<string, unknown>)[key];
            }
            return undefined;
        }, obj);
    }

    /**
     * Apply a transform operation
     */
    private applyTransformOperation(value: unknown, op: { op: string; args?: unknown }): unknown {
        switch (op.op) {
            case 'map':
                return Array.isArray(value)
                    ? value.map((item: unknown) =>
                          op.args && typeof item === 'object' && item
                              ? (item as Record<string, unknown>)[op.args as string]
                              : item,
                      )
                    : value;
            case 'filter':
                return Array.isArray(value)
                    ? value.filter((item: unknown) =>
                          typeof item === 'object' && item
                              ? (item as Record<string, unknown>)[op.args as string]
                              : item,
                      )
                    : value;
            case 'slice': {
                const args = op.args as { start?: number; end?: number } | undefined;
                return Array.isArray(value) ? value.slice(args?.start, args?.end) : value;
            }
            case 'join':
                return Array.isArray(value) ? value.join((op.args as string) || ', ') : value;
            case 'split':
                return typeof value === 'string' ? value.split((op.args as string) || ',') : value;
            case 'parse_json':
                return typeof value === 'string' ? JSON.parse(value) : value;
            case 'stringify':
                return JSON.stringify(value);
            case 'uppercase':
                return typeof value === 'string' ? value.toUpperCase() : value;
            case 'lowercase':
                return typeof value === 'string' ? value.toLowerCase() : value;
            case 'trim':
                return typeof value === 'string' ? value.trim() : value;
            default:
                return value;
        }
    }

    /**
     * Broadcast invocation status
     */
    private broadcastStatus(
        invocation: BotInvocation,
        status: string,
        output?: unknown,
        error?: string,
    ): void {
        const action =
            status === 'running'
                ? 'bot_invocation_started'
                : status === 'completed'
                  ? 'bot_invocation_completed'
                  : 'bot_invocation_failed';

        broadcastChatEvent(invocation.tagId, {
            action,
            data: {
                invocationId: invocation._id,
                userBotId: invocation.userBotId,
                sourceId: invocation.sourceId,
                status,
                output,
                error,
            },
            tagId: invocation.tagId,
            userId: invocation.userId,
            timestamp: new Date().toISOString(),
        }).catch(console.error);
    }
}

// Singleton instance
export const botExecutor = new BotExecutorService();
