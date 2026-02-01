import type {
    BotInvocation,
    BotTemplate,
    UserBot,
    BotConfig,
    Action,
    PageContent,
    Message,
} from '@maple/shared';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';
import { findBotTemplateById } from '../repositories/bot-template.repo';
import { findUserBotByIdInternal } from '../repositories/user-bot.repo';
import {
    findInvocationById,
    updateInvocationStatus,
    createInvocation,
} from '../repositories/bot-invocation.repo';
import { getOrCreateThread, incrementThreadMessageCount } from '../repositories/thread.repo';
import {
    createMessageInThread,
    markMessageHasThread,
    findMessagesByThreadId,
    findMessageById,
} from '../repositories/message.repo';
import { broadcastChatEvent } from './realtime.service';
import { extractTextFromContent } from '../utils/content-utils';
import { markdownToProseMirror } from '../utils/markdown-to-prosemirror';
import { buildWebhookPayload, invokeWebhookWithRetry } from './webhook.service';

// Configuration constants
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'claude-sonnet-4-20250514';
const BOT_EXECUTION_TIMEOUT_MS = parseInt(process.env.BOT_EXECUTION_TIMEOUT_MS || '60000', 10);

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
        notebookId: string;
        userId: string;
        context: BotInvocation['context'];
    }): Promise<BotInvocation> {
        // Get the user bot (use internal to get config for execution)
        const userBot = await findUserBotByIdInternal(params.userBotId);
        if (!userBot) throw new Error('User bot not found');

        // Handle custom bots differently
        if (userBot.botType === 'custom') {
            return this.invokeCustomBot(userBot, params);
        }

        // Template bot: requires a template
        const template = await findBotTemplateById(userBot.templateId!);
        if (!template) throw new Error('Bot template not found');

        // Create invocation record
        const invocation = await createInvocation({
            userBotId: params.userBotId,
            templateId: template._id,
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            notebookId: params.notebookId,
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
     * Invoke a custom bot via webhook
     */
    private async invokeCustomBot(
        userBot: UserBot,
        params: {
            userBotId: string;
            sourceType: 'message' | 'note';
            sourceId: string;
            notebookId: string;
            userId: string;
            context: BotInvocation['context'];
        },
    ): Promise<BotInvocation> {
        // Create invocation record (no templateId for custom bots)
        const invocation = await createInvocation({
            userBotId: params.userBotId,
            templateId: 'custom', // Placeholder for custom bots
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            notebookId: params.notebookId,
            userId: params.userId,
            context: params.context,
        });

        // Execute webhook asynchronously
        this.executeCustomBot(invocation, userBot).catch((error) => {
            console.error(`Custom bot webhook failed for invocation ${invocation._id}:`, error);
        });

        return invocation;
    }

    /**
     * Execute a custom bot webhook
     */
    private async executeCustomBot(invocation: BotInvocation, userBot: UserBot): Promise<void> {
        const startTime = Date.now();

        try {
            // Update status to running
            await updateInvocationStatus(invocation._id, 'running');
            this.broadcastStatus(invocation, 'running');

            // Get thread context - the parent message and any thread messages
            const parentMessage = await findMessageById(invocation.sourceId);
            let messages: Message[] = [];
            let threadId: string | null = null;

            if (parentMessage) {
                // Check if parent has a thread
                if (parentMessage.hasThread) {
                    // Get thread messages
                    const { findThreadByParentMessage } =
                        await import('../repositories/thread.repo');
                    const thread = await findThreadByParentMessage(invocation.sourceId);
                    if (thread) {
                        threadId = thread._id;
                        const threadMessages = await findMessagesByThreadId(thread._id);
                        messages = [parentMessage, ...threadMessages];
                    } else {
                        messages = [parentMessage];
                    }
                } else {
                    messages = [parentMessage];
                }
            }

            // Build webhook payload
            const payload = buildWebhookPayload(invocation, messages, threadId);

            // Invoke webhook with retry
            const result = await invokeWebhookWithRetry(userBot, payload);

            if (!result.success) {
                throw new Error(result.error || 'Webhook invocation failed');
            }

            // Custom bot acknowledged - it will respond via API
            // Keep status as 'running' until bot responds or times out
            const executionTimeMs = Date.now() - startTime;

            await updateInvocationStatus(invocation._id, 'running', {
                executionTimeMs,
            });

            // Broadcast that webhook was sent successfully
            this.broadcastStatus(invocation, 'running');
        } catch (error) {
            const executionTimeMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            await updateInvocationStatus(invocation._id, 'failed', {
                error: {
                    code: 'webhook/failed',
                    message: errorMessage,
                },
                executionTimeMs,
            });

            this.broadcastStatus(invocation, 'failed', errorMessage);
        }
    }

    /**
     * Execute a pending invocation with timeout protection
     */
    async execute(invocationId: string): Promise<void> {
        const startTime = Date.now();

        // Create timeout promise for overall execution
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Bot execution timed out after ${BOT_EXECUTION_TIMEOUT_MS}ms`));
            }, BOT_EXECUTION_TIMEOUT_MS);
        });

        // Race execution against timeout
        await Promise.race([this.executeWithContext(invocationId, startTime), timeoutPromise]);
    }

    /**
     * Internal execution logic
     */
    private async executeWithContext(invocationId: string, startTime: number): Promise<void> {
        const invocation = await findInvocationById(invocationId);
        if (!invocation) throw new Error('Invocation not found');

        const userBot = await findUserBotByIdInternal(invocation.userBotId);
        if (!userBot) throw new Error('User bot not found');

        const template = await findBotTemplateById(invocation.templateId);
        if (!template) throw new Error('Bot template not found');

        const ctx: ExecutionContext = {
            invocation,
            template,
            userBot,
            config: userBot.config,
            variables: {
                // Built-in context variables with size limits to prevent memory issues
                $mentionText: (invocation.context.mentionText || '').slice(0, 1000),
                $content: (invocation.context.fullContent || '').slice(0, 50000), // 50KB limit
                $documentTitle: (invocation.context.documentTitle || '').slice(0, 200),
                $selection: (invocation.context.selection || '').slice(0, 10000),
                $previousMessages: (invocation.context.previousMessages || []).slice(0, 10), // Max 10 messages
                $userId: invocation.userId,
                $notebookId: invocation.notebookId,
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
            // Store PageContent format for consistent rendering with TipTap
            await updateInvocationStatus(invocationId, 'completed', {
                output: responseContent,
                threadId,
                responseMessageId: messageId,
                executionTimeMs,
                variables: ctx.variables as Record<string, unknown>,
            });

            this.broadcastStatus(invocation, 'completed', responseContent);
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

        const isOAuthToken = ctx.config?.isOAuthToken || false;

        // Build system prompt
        let systemPrompt = config.systemPrompt
            ? this.interpolate(config.systemPrompt, ctx.variables)
            : undefined;

        // OAuth tokens require the Claude Code system prompt
        if (isOAuthToken) {
            const claudeCodePrompt = "You are Claude Code, Anthropic's official CLI for Claude.";
            systemPrompt = systemPrompt
                ? `${claudeCodePrompt}\n\n${systemPrompt}`
                : claudeCodePrompt;
        }

        const userPrompt = this.interpolate(config.userPrompt, ctx.variables);

        // Build conversation history from previous messages
        const previousMessages = (ctx.variables.$previousMessages || []) as Array<{
            role?: string;
            content?: string | { type: string; content: unknown[] };
            senderType?: string;
        }>;

        // Call Claude API
        const response = await this.callClaudeAPI({
            apiKey,
            isOAuthToken,
            model: config.model || DEFAULT_LLM_MODEL,
            systemPrompt,
            userPrompt,
            previousMessages,
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
     * Validate URL to prevent SSRF attacks
     */
    private validateUrl(url: string): void {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();

        // Only allow HTTP and HTTPS protocols
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Only HTTP and HTTPS protocols are allowed');
        }

        // Block localhost and loopback addresses
        if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname === '::1' ||
            hostname === '[::1]'
        ) {
            throw new Error('Access to localhost is not allowed');
        }

        // Block private IPv4 ranges
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
        if (
            hostname.match(/^10\./) ||
            hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
            hostname.match(/^192\.168\./) ||
            hostname.match(/^169\.254\./)
        ) {
            throw new Error('Access to private networks is not allowed');
        }

        // Block AWS/cloud metadata endpoints
        if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
            throw new Error('Access to cloud metadata endpoints is not allowed');
        }

        // Block internal domain patterns (common in enterprises)
        if (
            hostname.endsWith('.internal') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.localhost')
        ) {
            throw new Error('Access to internal domains is not allowed');
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

        // SECURITY: Validate URL to prevent SSRF attacks
        this.validateUrl(url);

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
     * Call Claude API with support for both API keys and OAuth tokens
     */
    private async callClaudeAPI(params: {
        apiKey: string;
        isOAuthToken: boolean;
        model: string;
        systemPrompt?: string;
        userPrompt: string;
        previousMessages?: Array<{
            role?: string;
            content?: string | { type: string; content: unknown[] };
            senderType?: string;
        }>;
        maxTokens: number;
    }): Promise<string> {
        // OAuth tokens use Claude Agent SDK
        if (params.isOAuthToken) {
            return this.callClaudeSDK(params);
        }

        // Standard API key uses direct API
        return this.callClaudeDirectAPI(params);
    }

    /**
     * Call Claude API using Claude Agent SDK (for OAuth tokens)
     */
    private async callClaudeSDK(params: {
        apiKey: string;
        model: string;
        systemPrompt?: string;
        userPrompt: string;
        previousMessages?: Array<{
            role?: string;
            content?: string | { type: string; content: unknown[] };
            senderType?: string;
        }>;
        maxTokens: number;
    }): Promise<string> {
        // Build conversation history in the format expected by the SDK
        const conversationParts: string[] = [];

        // Add previous messages for context
        if (params.previousMessages && params.previousMessages.length > 0) {
            for (const msg of params.previousMessages) {
                // Extract text content from ProseMirror JSON structure
                let textContent = '';
                if (typeof msg.content === 'object' && msg.content && 'content' in msg.content) {
                    textContent = extractTextFromContent(msg.content as any);
                } else if (typeof msg.content === 'string') {
                    textContent = msg.content;
                }

                if (textContent) {
                    // Map senderType to role for prompt
                    const role = msg.senderType === 'bot' ? 'Assistant' : 'Human';
                    conversationParts.push(`${role}: ${textContent}`);
                }
            }
        }

        // Add current message
        conversationParts.push(`Human: ${params.userPrompt}`);

        const prompt = conversationParts.join('\n\n');

        let fullContent = '';
        process.env.ANTHROPIC_API_KEY = params.apiKey;
        // Use env option to pass API key without modifying global process.env (prevents race conditions)
        const result = query({
            prompt,
            options: {
                model: params.model === DEFAULT_LLM_MODEL ? 'sonnet' : params.model,
                systemPrompt: params.systemPrompt
                    ? params.systemPrompt
                    : {
                          type: 'preset',
                          preset: 'claude_code',
                      },
                // env: {
                // ...process.env,
                //     ANTHROPIC_API_KEY: params.apiKey,
                // },
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            },
        });

        for await (const message of result) {
            if (message.type === 'assistant') {
                const assistantMsg = message as SDKAssistantMessage;
                // Extract text content from assistant message
                for (const block of assistantMsg.message.content) {
                    if (block.type === 'text') {
                        fullContent += block.text;
                    }
                }
            }
        }

        return fullContent;
    }

    /**
     * Call Claude API directly (for standard API keys)
     */
    private async callClaudeDirectAPI(params: {
        apiKey: string;
        model: string;
        systemPrompt?: string;
        userPrompt: string;
        previousMessages?: Array<{
            role?: string;
            content?: string | { type: string; content: unknown[] };
            senderType?: string;
        }>;
        maxTokens: number;
    }): Promise<string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': params.apiKey,
        };

        // Build conversation history
        const messages: Array<{ role: string; content: string }> = [];

        // Add previous messages for context
        if (params.previousMessages && params.previousMessages.length > 0) {
            for (const msg of params.previousMessages) {
                // Extract text content from ProseMirror JSON structure
                let textContent = '';
                if (typeof msg.content === 'object' && msg.content && 'content' in msg.content) {
                    textContent = extractTextFromContent(msg.content as any);
                } else if (typeof msg.content === 'string') {
                    textContent = msg.content;
                }

                if (textContent) {
                    // Map senderType to Claude API role
                    const role = msg.senderType === 'bot' ? 'assistant' : 'user';
                    messages.push({ role, content: textContent });
                }
            }
        }

        // Add current message
        messages.push({ role: 'user', content: params.userPrompt });

        // Build request body
        const requestBody: {
            model: string;
            max_tokens: number;
            system?: string;
            messages: Array<{ role: string; content: string }>;
        } = {
            model: params.model,
            max_tokens: params.maxTokens,
            messages,
        };

        // Simple string format for system prompt
        if (params.systemPrompt) {
            requestBody.system = params.systemPrompt;
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
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
    private prepareResponse(ctx: ExecutionContext): PageContent {
        const response = String(ctx.variables.$response || '');

        // Convert markdown to ProseMirror JSON
        return markdownToProseMirror(response);
    }

    /**
     * Post bot response in a thread
     */
    private async postResponse(
        invocation: BotInvocation,
        userBot: UserBot,
        template: BotTemplate,
        content: PageContent,
    ): Promise<{ threadId: string; messageId: string }> {
        // Get or create thread for the parent message
        const thread = await getOrCreateThread({
            parentMessageId: invocation.sourceId,
            notebookId: invocation.notebookId,
            botInvocationId: invocation._id,
        });

        // Mark the parent message as having a thread
        await markMessageHasThread(invocation.sourceId);

        // Create the bot's response message in the thread
        const message = await createMessageInThread({
            notebookId: invocation.notebookId,
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
        await broadcastChatEvent(invocation.notebookId, {
            action: 'thread_message',
            data: {
                threadId: thread._id,
                parentMessageId: invocation.sourceId,
                message,
            },
            notebookId: invocation.notebookId,
            userId: userBot.userId,
            timestamp: new Date().toISOString(),
        });

        return { threadId: thread._id, messageId: message._id };
    }

    /**
     * Sanitize a value for safe interpolation
     * Prevents prompt injection and limits size
     */
    private sanitizeValue(value: unknown): string {
        if (value === undefined || value === null) return '';

        const str = typeof value === 'string' ? value : JSON.stringify(value);

        // Escape template markers to prevent injection
        // Also limit length to prevent excessive output
        return str.replace(/\{\{/g, '\\{\\{').replace(/\}\}/g, '\\}\\}').slice(0, 10000); // Max 10KB per value
    }

    /**
     * Interpolate variables in a template string
     */
    private interpolate(template: string, variables: Record<string, unknown>): string {
        return template.replace(/\{\{(\$?\w+(?:\.\w+)*)\}\}/g, (_, path: string) => {
            const value = this.getNestedValue(variables, path);
            return this.sanitizeValue(value);
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
        if (!match || !match[1]) return ref;
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
                if (typeof value !== 'string') return value;
                try {
                    return JSON.parse(value);
                } catch {
                    // Return original value if parsing fails
                    return value;
                }
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

        broadcastChatEvent(invocation.notebookId, {
            action,
            data: {
                invocationId: invocation._id,
                userBotId: invocation.userBotId,
                sourceId: invocation.sourceId,
                status,
                output,
                error,
            },
            notebookId: invocation.notebookId,
            userId: invocation.userId,
            timestamp: new Date().toISOString(),
        }).catch(console.error);
    }
}

// Singleton instance
export const botExecutor = new BotExecutorService();
