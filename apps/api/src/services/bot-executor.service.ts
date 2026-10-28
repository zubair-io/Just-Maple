import type {
    BotInvocation,
    BotTemplate,
    UserBot,
    BotConfig,
    Action,
    PageContent,
    Message,
    Page,
    ProactiveMessageMeta,
} from '@maple/shared';
import { isBotModel } from '@maple/shared';
import { botUIPrompt, parseBotResponse, botUIToText } from './bot-ui.service';
import { attachProposals, withProposalCards } from './calendar-proposal.service';
import { attachActions, withActionReceipts } from './bot-action.service';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';
import { findBotTemplateById } from '../repositories/bot-template.repo';
import { findUserBotByIdInternal } from '../repositories/user-bot.repo';
import {
    findInvocationById,
    updateInvocationStatus,
    createInvocation,
} from '../repositories/bot-invocation.repo';
import {
    getOrCreateThread,
    incrementThreadMessageCount,
    findThreadByParentMessage,
} from '../repositories/thread.repo';
import {
    createMessageInThread,
    createTopLevelBotMessage,
    markMessageHasThread,
    findMessagesByThreadId,
    findMessageById,
    reviseBotMessage,
} from '../repositories/message.repo';
import { sendMessageReceivedNotification } from './notification.service';
import { getLastReadAtByPageId } from '../repositories/unread.repo';
import { broadcastChatEvent } from './realtime.service';
import { extractTextFromContent } from '../utils/content-utils';
import { markdownToProseMirror } from '../utils/markdown-to-prosemirror';
import { buildWebhookPayload, invokeWebhookWithRetry } from './webhook.service';
import {
    executeMacDataTool,
    getMacDataToolContext,
    macDataSystemPrompt,
    macDataToolDefinitions,
    type MacDataToolContext,
} from './mac-data-tools.service';
import {
    ChatCompletionsError,
    runAnthropicWithTools,
    runChatCompletions,
    runChatCompletionsWithTools,
    runOpenAIWithTools,
    type ChatCompletionsTarget,
    type ChatTurn,
} from './llm-tool-loop.service';
import { resolveEndpoint, validateUrl } from '../utils/url-safety';
import { findPageByIdForBot } from '../repositories/page.repo';
import { appendProactiveInstruction } from './proactive-settings.service';
import {
    executeWebTool,
    isWebTool,
    webSearchSystemPrompt,
    webSearchToolDefinitions,
    webToolContextFor,
    withSourcesList,
    type WebToolContext,
} from './web-search.service';

// Configuration constants
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'claude-sonnet-4-20250514';
// Generous enough for local-data tool runs: several model rounds plus Mac round trips.
const BOT_EXECUTION_TIMEOUT_MS = parseInt(process.env.BOT_EXECUTION_TIMEOUT_MS || '180000', 10);

interface ExecutionContext {
    invocation: BotInvocation;
    template: BotTemplate;
    userBot: UserBot;
    config: BotConfig | undefined;
    variables: Record<string, unknown>;
    /** Local Mac data for this run; undefined until looked up, null when there is none. */
    macData?: MacDataToolContext | null;
    /** Set for proactive runs, which may search the web only with their own switch. */
    proactive?: boolean;
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

        console.log(`[CustomBot] Executing webhook for bot ${userBot.handle} (${userBot._id})`);
        console.log(`[CustomBot] Invoke URL: ${userBot.invokeUrl}`);
        console.log(`[CustomBot] Has webhook secret: ${!!userBot.webhookSecret}`);

        try {
            // Update status to running
            await updateInvocationStatus(invocation._id, 'running');
            this.broadcastStatus(invocation, userBot, 'running');

            // Get thread context - the parent message and any thread messages
            const parentMessage = await findMessageById(invocation.sourceId);
            let messages: Message[] = [];
            let threadId: string | null = null;

            if (parentMessage) {
                // Check if parent has a thread
                if (parentMessage.hasThread) {
                    // Get thread messages
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
            const payload = await buildWebhookPayload(invocation, messages, threadId);

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
            this.broadcastStatus(invocation, userBot, 'running');
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

            this.broadcastStatus(invocation, userBot, 'failed', undefined, errorMessage);
        }
    }

    /**
     * Execute a pending invocation with timeout protection
     */
    async execute(invocationId: string): Promise<void> {
        const startTime = Date.now();

        let timer: ReturnType<typeof setTimeout> | undefined;
        // Create timeout promise for overall execution
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`Bot execution timed out after ${BOT_EXECUTION_TIMEOUT_MS}ms`));
            }, BOT_EXECUTION_TIMEOUT_MS);
        });

        // Race execution against timeout
        try {
            await Promise.race([this.executeWithContext(invocationId, startTime), timeoutPromise]);
        } finally {
            clearTimeout(timer);
        }
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
        // Status events name the bot the way its messages do.
        const namedBot = { ...userBot, displayName: userBot.displayName || template.name };

        const ctx: ExecutionContext = {
            invocation,
            template,
            userBot,
            config: userBot.config,
            variables: {
                // Built-in context variables with size limits to prevent memory issues
                $mentionText: (invocation.context.mentionText || '').slice(0, 10000),
                $content: (invocation.context.fullContent || '').slice(0, 50000), // 50KB limit
                $documentTitle: (invocation.context.documentTitle || '').slice(0, 200),
                $selection: (invocation.context.selection || '').slice(0, 10000),
                $previousMessages: (invocation.context.previousMessages || []).slice(-10), // Max 10 messages
                $userId: invocation.userId,
                $notebookId: invocation.notebookId,
                $sourceType: invocation.sourceType,
                $sourceId: invocation.sourceId,
            },
        };

        try {
            // Update status to running
            await updateInvocationStatus(invocationId, 'running');
            this.broadcastStatus(invocation, namedBot, 'running');

            // Execute actions sequentially
            for (const action of template.definition.actions) {
                await this.executeAction(action, ctx);
            }

            // Get the response content
            const responseContent = await this.prepareResponse(ctx);

            // Create thread and post response
            const { threadId, messageId } = await this.postResponse(
                invocation,
                userBot,
                template,
                responseContent,
                ctx,
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

            this.broadcastStatus(invocation, namedBot, 'completed', responseContent);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await updateInvocationStatus(invocationId, 'failed', {
                error: {
                    code: 'EXECUTION_ERROR',
                    message: errorMessage,
                },
                executionTimeMs: Date.now() - startTime,
            });
            this.broadcastStatus(invocation, namedBot, 'failed', undefined, errorMessage);
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
     * LLM action - calls Claude, OpenAI, or an OpenAI-compatible server based on provider
     */
    private async executeLLM(
        action: Action,
        ctx: ExecutionContext,
        // Proactive runs pass prompts directly: their data must not be interpolated or truncated.
        prompts?: { system?: string; user: string },
    ): Promise<void> {
        const config = action.config as {
            provider?: string;
            systemPrompt?: string;
            userPrompt: string;
            model?: string;
            maxTokens?: number;
        };

        // Get API key from user's bot config. Custom servers may be open and need none.
        const apiKey = ctx.config?.apiKey ?? '';
        if (!apiKey && config.provider !== 'openai-compatible') {
            throw new Error('API key not configured');
        }

        const userPrompt = prompts
            ? prompts.user
            : this.interpolate(config.userPrompt, ctx.variables);
        let systemPrompt = prompts
            ? prompts.system
            : config.systemPrompt
              ? this.interpolate(config.systemPrompt, ctx.variables)
              : undefined;

        // Build conversation history from previous messages
        const previousMessages = (
            (ctx.variables.$previousMessages || []) as Array<{
                role?: string;
                content?: string | { type: string; content: unknown[] };
                senderType?: string;
                botUI?: Message['botUI'];
            }>
        ).map((message) => {
            if (!message.botUI) return message;
            const content =
                typeof message.content === 'string'
                    ? message.content
                    : message.content
                      ? extractTextFromContent(message.content as PageContent)
                      : '';
            return {
                ...message,
                content: `${content}\n\n${botUIToText(message.botUI)}`.slice(0, 50000),
            };
        });

        const provider = config.provider || 'anthropic';
        const model =
            ctx.invocation.context.model ||
            ctx.config?.model ||
            config.model ||
            (provider === 'openai-compatible' ? '' : DEFAULT_LLM_MODEL);
        if (!model) throw new Error('Choose a model for this bot in bot settings');
        if (!isBotModel(model, provider))
            throw new Error('The selected model does not match this bot provider');
        ctx.variables.$model = model;
        if (ctx.config?.responseMode !== 'text' && provider !== 'inception') {
            systemPrompt = `${systemPrompt || ''}\n\n${botUIPrompt}`;
        }
        let response: string;
        const endpoint = await this.chatCompletionsTarget(provider, ctx);

        // iMessage, Mail and Calendar on the user's Mac, when this notebook has Mac pages.
        const macData = await this.macDataContextFor(ctx);
        if (macData) systemPrompt = `${systemPrompt || ''}\n\n${macDataSystemPrompt(macData)}`;
        // Web search, for bots that have it turned on (and a server search key).
        const web = this.webToolsFor(ctx, provider);
        // Without tool calling there is no web access, so that prompt never mentions it.
        const systemWithoutWeb = systemPrompt;
        if (web) systemPrompt = `${systemPrompt || ''}\n\n${webSearchSystemPrompt(web)}`;
        // One tool set for every provider: local data and web tools side by side.
        const tools = [
            ...(macData ? macDataToolDefinitions(macData) : []),
            ...(web ? webSearchToolDefinitions(web) : []),
        ];
        const execute = (name: string, input: Record<string, unknown>) =>
            web && isWebTool(name)
                ? executeWebTool(web, name, input)
                : macData
                  ? executeMacDataTool(macData, name, input)
                  : Promise.resolve(JSON.stringify({ error: `Unknown tool ${name}` }));
        // Without tool calling, search once with the request and include the results.
        const withSearchResults = async () =>
            macData?.sources.length
                ? `${systemWithoutWeb}\n\nSearch results for the user's request:\n${await executeMacDataTool(
                      macData,
                      'search_local_data',
                      { query: userPrompt.slice(0, 500) },
                  )}`
                : systemWithoutWeb;

        if (endpoint) {
            const call = {
                ...endpoint,
                apiKey,
                model,
                turns: [
                    ...this.toTurns(previousMessages),
                    { role: 'user' as const, content: userPrompt },
                ],
                maxTokens: Math.max(
                    config.maxTokens || 1024,
                    ctx.config?.responseMode === 'text' ? 1024 : 4096,
                ),
            };
            if (tools.length && provider === 'openai-compatible') {
                try {
                    response = await runChatCompletionsWithTools({
                        ...call,
                        system: systemPrompt,
                        tools,
                        execute,
                    });
                } catch (error) {
                    // Many servers or models reject tools; answer from one search instead.
                    if (!(error instanceof ChatCompletionsError) || error.status >= 500)
                        throw error;
                    response = await runChatCompletions({
                        ...call,
                        system: await withSearchResults(),
                    });
                }
            } else {
                response = await runChatCompletions({ ...call, system: await withSearchResults() });
            }
        } else if (tools.length) {
            const isOAuthToken = provider === 'anthropic' && (ctx.config?.isOAuthToken || false);
            const loop = {
                apiKey,
                model,
                system: isOAuthToken
                    ? `You are Claude Code, Anthropic's official CLI for Claude.\n\n${systemPrompt}`
                    : systemPrompt,
                turns: [
                    ...this.toTurns(previousMessages),
                    { role: 'user' as const, content: userPrompt },
                ],
                maxTokens: Math.max(config.maxTokens || 1024, 4096),
                tools,
                execute,
            };
            response =
                provider === 'openai'
                    ? await runOpenAIWithTools(loop)
                    : await runAnthropicWithTools({ ...loop, isOAuthToken });
        } else if (provider === 'openai') {
            response = await this.callOpenAI({
                apiKey,
                model,
                systemPrompt,
                userPrompt,
                previousMessages,
                maxTokens: config.maxTokens || 4096,
            });
        } else {
            const isOAuthToken = ctx.config?.isOAuthToken || false;

            // OAuth tokens require the Claude Code system prompt
            let finalSystemPrompt = systemPrompt;
            if (isOAuthToken) {
                const claudeCodePrompt =
                    "You are Claude Code, Anthropic's official CLI for Claude.";
                finalSystemPrompt = finalSystemPrompt
                    ? `${claudeCodePrompt}\n\n${finalSystemPrompt}`
                    : claudeCodePrompt;
            }

            response = await this.callClaudeAPI({
                apiKey,
                isOAuthToken,
                model,
                systemPrompt: finalSystemPrompt,
                userPrompt,
                previousMessages,
                maxTokens: Math.max(
                    config.maxTokens || 1024,
                    ctx.config?.responseMode === 'text' ? 1024 : 4096,
                ),
            });
        }

        // Answers built on web results always link their sources.
        response = withSourcesList(response, web);

        // Store result in output variable
        if (action.outputVariable) {
            ctx.variables[action.outputVariable] = response;
        }
        // Also set as $response for convenience
        ctx.variables.$response = response;
    }

    /**
     * Where OpenAI-compatible providers send chat completions: Inception's fixed server, or
     * the URL saved on a custom bot (checked again on every call). Null for other providers.
     */
    private async chatCompletionsTarget(
        provider: string,
        ctx: ExecutionContext,
    ): Promise<ChatCompletionsTarget | null> {
        if (provider === 'inception')
            return { baseUrl: 'https://api.inceptionlabs.ai/v1', label: 'Inception API' };
        if (provider !== 'openai-compatible') return null;
        if (!ctx.config?.baseUrl) throw new Error('Add the server URL in bot settings');
        const baseUrl = await resolveEndpoint(ctx.config.baseUrl);
        return { baseUrl, label: ctx.userBot?.displayName || new URL(baseUrl).hostname };
    }

    /**
     * Mac data for this run: preset by proactive runs, otherwise looked up for the user who
     * invoked the bot. Only that user's own Mac is ever asked.
     */
    private async macDataContextFor(ctx: ExecutionContext): Promise<MacDataToolContext | null> {
        if (ctx.macData !== undefined) return ctx.macData;
        const { userId, notebookId, sourceType, sourceId } = ctx.invocation;
        const macData = await getMacDataToolContext(userId, notebookId, {
            id: ctx.userBot._id,
            name: ctx.userBot.displayName || ctx.template.name,
            ownerId: ctx.userBot.userId,
        }).catch(() => null);
        if (macData && sourceType === 'message') {
            const message = await findMessageById(sourceId).catch(() => null);
            const page = message ? await findPageByIdForBot(message.pageId) : null;
            const proactive = page?.proactive;
            // The proactive bot may save corrections from the person whose Mac it reads.
            if (
                page &&
                proactive?.enabled &&
                proactive.userBotId === ctx.userBot._id &&
                proactive.ownerUserId === userId
            ) {
                macData.rememberInstruction = (instruction) =>
                    appendProactiveInstruction(page.id, instruction);
            }
        }
        ctx.macData = macData;
        return macData;
    }

    /**
     * Web tools for one LLM action, new each time so limits and sources don't carry over.
     * Proactive runs need their own switch and never open pages. Inception's server gets
     * no tools at all, so it gets no web tools either.
     */
    private webToolsFor(ctx: ExecutionContext, provider: string): WebToolContext | null {
        if (provider === 'inception') return null;
        const proactive = ctx.proactive === true;
        return webToolContextFor({
            config: ctx.config,
            ownerId: ctx.userBot.userId,
            proactive,
            // Only the user's own message: links in notes or fetched text don't count.
            userMessage: proactive ? undefined : ctx.invocation.context.mentionText,
        });
    }

    private toTurns(
        previousMessages: Array<{
            content?: string | { type: string; content: unknown[] };
            senderType?: string;
        }>,
    ): ChatTurn[] {
        return previousMessages
            .map((msg) => ({
                role: (msg.senderType === 'bot' ? 'assistant' : 'user') as ChatTurn['role'],
                content:
                    typeof msg.content === 'string'
                        ? msg.content
                        : msg.content
                          ? extractTextFromContent(msg.content as PageContent)
                          : '',
            }))
            .filter((turn) => turn.content);
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

        // SECURITY: Validate URL to prevent SSRF attacks
        validateUrl(url);

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
                env: { ...process.env, ANTHROPIC_API_KEY: params.apiKey },
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

    private async callOpenAI(params: {
        apiKey: string;
        model: string;
        systemPrompt?: string;
        userPrompt: string;
        previousMessages?: Array<{
            content?: string | { type: string; content: unknown[] };
            senderType?: string;
        }>;
        maxTokens: number;
    }): Promise<string> {
        const input = (params.previousMessages || [])
            .map((msg) => ({
                role: msg.senderType === 'bot' ? 'assistant' : 'user',
                content:
                    typeof msg.content === 'string'
                        ? msg.content
                        : msg.content
                          ? extractTextFromContent(msg.content as PageContent)
                          : '',
            }))
            .filter((msg) => msg.content);
        input.push({ role: 'user', content: params.userPrompt });
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${params.apiKey}`,
            },
            signal: AbortSignal.timeout(55000),
            body: JSON.stringify({
                model: params.model,
                instructions: params.systemPrompt,
                input,
                max_output_tokens: params.maxTokens,
                store: false,
            }),
        });
        if (!response.ok)
            throw new Error(
                `OpenAI request failed (${response.status}). Check the model and API key in bot settings.`,
            );
        const data = (await response.json()) as {
            output?: Array<{ content?: Array<{ type: string; text?: string }> }>;
        };
        const text = (data.output || [])
            .flatMap((item) => item.content || [])
            .filter((block) => block.type === 'output_text')
            .map((block) => block.text || '')
            .join('');
        if (!text)
            throw new Error(
                'OpenAI returned no text. Try a larger output budget or a different model.',
            );
        return text;
    }

    /**
     * Prepare response content for posting
     */
    private async prepareResponse(ctx: ExecutionContext): Promise<PageContent> {
        const response = String(ctx.variables.$response || '');
        const parsed = parseBotResponse(response);
        // "Add to calendar" cards come from the proposals saved in this run, never from
        // what the model wrote.
        const proposals = ctx.macData?.proposedEvents ?? [];
        let ui = proposals.length ? await withProposalCards(parsed.ui, proposals) : parsed.ui;
        // So do "Done · Undo" cards, from actions done without a tap (bot-action.service).
        const receipts = ctx.macData?.actionReceipts ?? [];
        if (receipts.length) ui = await withActionReceipts(ui, receipts);
        ctx.variables.$botUI = ui;
        return markdownToProseMirror(parsed.markdown || (ui ? botUIToText(ui) : ''));
    }

    /** Points the run's proposals and logged actions at the message that shows their cards. */
    private async attachProposalCards(
        ctx: ExecutionContext,
        pageId: string,
        messageId: string,
    ): Promise<void> {
        const proposals = ctx.macData?.proposedEvents ?? [];
        if (proposals.length)
            await attachProposals(proposals, pageId, messageId).catch((error) =>
                console.error('[BotExecutor] Could not attach proposals:', error),
            );
        // Calendar proposals share their id with their action log row.
        const actions = [...proposals, ...(ctx.macData?.actionReceipts ?? [])];
        if (actions.length)
            await attachActions(actions, pageId, messageId).catch((error) =>
                console.error('[BotExecutor] Could not attach actions:', error),
            );
    }

    /**
     * Post bot response in a thread
     */
    private async postResponse(
        invocation: BotInvocation,
        userBot: UserBot,
        template: BotTemplate,
        content: PageContent,
        ctx: ExecutionContext,
    ): Promise<{ threadId?: string; messageId: string }> {
        const source = await findMessageById(invocation.sourceId);
        if (!source) throw new Error('Source message not found');
        if (invocation.context.replyTopLevel) {
            const page = await findPageByIdForBot(source.pageId);
            if (page) {
                const message = await this.postTopLevel(page, userBot, template, content, ctx);
                return { messageId: message.id };
            }
        }
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
            pageId: source.pageId,
            botUI: ctx.variables.$botUI as Message['botUI'],
            botModel: ctx.variables.$model as string | undefined,
            notebookId: invocation.notebookId,
            threadId: thread._id,
            userId: userBot.userId,
            userBotId: userBot._id,
            senderType: 'bot',
            senderDisplayName: userBot.displayName || template.name,
            senderProfilePictureUrl: template.avatar,
            content,
        });
        await this.attachProposalCards(ctx, source.pageId, message.id);

        // Increment thread message count
        await incrementThreadMessageCount(thread._id);

        // Broadcast thread message event
        await broadcastChatEvent(invocation.notebookId, {
            pageId: source.pageId,
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

        return { threadId: thread._id, messageId: message.id };
    }

    /**
     * Post a bot message directly in a page's conversation (proactive pages).
     * With `notify`, the data owner also gets a push notification.
     */
    private async postTopLevel(
        page: Page,
        userBot: UserBot,
        template: BotTemplate,
        content: PageContent,
        ctx: ExecutionContext,
        notify?: { ownerUserId: string },
        proactiveMeta?: ProactiveMessageMeta,
    ): Promise<Message> {
        const message = await createTopLevelBotMessage({
            pageId: page.id,
            notebookId: page.notebookId,
            userId: userBot.userId,
            userBotId: userBot._id,
            senderDisplayName: userBot.displayName || template.name,
            senderProfilePictureUrl: template.avatar,
            content,
            botUI: ctx.variables.$botUI as Message['botUI'],
            botModel: ctx.variables.$model as string | undefined,
            ...(proactiveMeta ? { proactiveMeta } : {}),
        });
        await this.attachProposalCards(ctx, page.id, message.id);
        if (page.notebookId) {
            await broadcastChatEvent(page.notebookId, {
                pageId: page.id,
                action: 'message',
                data: message,
                notebookId: page.notebookId,
                userId: userBot.userId,
                timestamp: new Date().toISOString(),
            });
            if (notify) {
                await sendMessageReceivedNotification(
                    notify.ownerUserId,
                    page.notebookId,
                    page.id,
                    message._id,
                    undefined,
                    userBot.displayName || template.name,
                    template.avatar,
                    content,
                ).catch(() => {});
            }
        }
        return message;
    }

    /**
     * One proactive pass for a page: the bot reads new Mac data with its standing
     * instructions and either posts a message or stays quiet (replies NO_UPDATE).
     * Returns the posted message, or null when there was nothing worth saying.
     *
     * With `revise`, the reply replaces that earlier post in place (it was still unread):
     * open clients get the normal edit event and nobody gets a new notification, unless
     * `revise.push` says what changed (urgency rose), which goes to the owner as one push.
     * If the post can no longer be revised (someone replied meanwhile), a new one goes out.
     */
    async runProactive(params: {
        page: Page;
        userBot: UserBot;
        template: BotTemplate;
        macData: MacDataToolContext;
        system: string;
        prompt: string;
        previousMessages: Message[];
        proactiveMeta?: ProactiveMessageMeta;
        revise?: { messageId: string; push?: string };
    }): Promise<Message | null> {
        const llm = params.template.definition.actions.find((action) => action.type === 'llm');
        if (!llm || !params.page.notebookId) return null;
        const now = new Date().toISOString();
        const ctx: ExecutionContext = {
            // Not persisted: proactive runs have no source message to answer.
            invocation: {
                _id: `proactive:${params.page.id}`,
                userBotId: params.userBot._id,
                templateId: params.template._id,
                sourceType: 'message',
                sourceId: '',
                notebookId: params.page.notebookId,
                userId: params.macData.userId,
                context: {},
                variables: {},
                status: 'running',
                createdAt: now,
                updatedAt: now,
            },
            template: params.template,
            userBot: params.userBot,
            config: params.userBot.config,
            variables: { $previousMessages: params.previousMessages },
            macData: params.macData,
            proactive: true,
        };
        await this.executeLLM(llm, ctx, { system: params.system, user: params.prompt });
        const raw = String(ctx.variables.$response || '').trim();
        if (!raw || /^NO_UPDATE\b/i.test(raw)) return null;
        const content = await this.prepareResponse(ctx);
        if (params.revise) {
            const revised = await this.reviseTopLevel(params, content, ctx);
            if (revised) return revised;
        }
        return this.postTopLevel(
            params.page,
            params.userBot,
            params.template,
            content,
            ctx,
            { ownerUserId: params.macData.userId },
            params.proactiveMeta,
        );
    }

    /** Rewrites an unread proactive post; null when it can't be (it then posts anew). */
    private async reviseTopLevel(
        params: {
            page: Page;
            userBot: UserBot;
            template: BotTemplate;
            macData: MacDataToolContext;
            proactiveMeta?: ProactiveMessageMeta;
            revise?: { messageId: string; push?: string };
        },
        content: PageContent,
        ctx: ExecutionContext,
    ): Promise<Message | null> {
        const { page, userBot, template, revise } = params;
        if (!revise || !page.notebookId) return null;
        const message = await reviseBotMessage(
            revise.messageId,
            userBot._id,
            {
                content,
                botUI: ctx.variables.$botUI as Message['botUI'],
                botModel: ctx.variables.$model as string | undefined,
                ...(params.proactiveMeta ? { proactiveMeta: params.proactiveMeta } : {}),
            },
            {
                // Read by the owner while this was written: a new message instead.
                stillUnread: async (postedAt) => {
                    const readAt = await getLastReadAtByPageId(params.macData.userId, page.id);
                    return !readAt || readAt < postedAt;
                },
            },
        );
        if (!message) return null;
        await this.attachProposalCards(ctx, page.id, message.id);
        // The normal edit path: open clients replace the message, card included.
        await broadcastChatEvent(page.notebookId, {
            pageId: page.id,
            action: 'edited',
            data: message,
            notebookId: page.notebookId,
            userId: userBot.userId,
            timestamp: new Date().toISOString(),
        });
        if (revise.push) {
            await sendMessageReceivedNotification(
                params.macData.userId,
                page.notebookId,
                page.id,
                message._id,
                undefined,
                userBot.displayName || template.name,
                template.avatar,
                markdownToProseMirror(`Updated: ${revise.push}`),
            ).catch(() => {});
        }
        return message;
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
        userBot: UserBot,
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
            pageId: invocation.context.pageId || invocation.notebookId,
            action,
            data: {
                invocationId: invocation._id,
                userBotId: invocation.userBotId,
                // Lets clients show "<name> is typing…" where the reply will appear
                botName: userBot.displayName || userBot.handle,
                replyTopLevel: invocation.context.replyTopLevel === true,
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
