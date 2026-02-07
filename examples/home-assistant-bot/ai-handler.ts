/**
 * AI Handler - Claude API with Tool Use for Home Assistant
 *
 * Processes natural language requests by giving Claude tools to
 * query entity states, call HA services, and read/write memo documents.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { HAClient, EntityState } from './ha-client';

// ---- Types ----

interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface WebhookMessage {
    id: string;
    author: {
        id: string;
        name: string;
        type: 'user' | 'bot';
    };
    content: string;
    content_json: unknown;
    created_at: string;
}

export interface MemoHelpers {
    readMemo: (pageId: string) => Promise<{ title: string; document: unknown } | null>;
    writeMemo: (pageId: string, markdown: string, title?: string) => Promise<boolean>;
}

// ---- Tool Definitions ----

const haTools: Anthropic.Tool[] = [
    {
        name: 'get_entity_state',
        description:
            'Get the current state and attributes of a Home Assistant entity. Use this to check the status of a device, sensor, or other entity.',
        input_schema: {
            type: 'object' as const,
            properties: {
                entity_id: {
                    type: 'string',
                    description:
                        'The Home Assistant entity ID (e.g., "light.living_room", "sensor.temperature")',
                },
            },
            required: ['entity_id'],
        },
    },
    {
        name: 'call_service',
        description:
            'Call a Home Assistant service to control an entity. Common examples: turn on/off lights, lock/unlock doors, set thermostat temperature, open/close covers.',
        input_schema: {
            type: 'object' as const,
            properties: {
                domain: {
                    type: 'string',
                    description:
                        'The service domain (e.g., "light", "switch", "climate", "lock", "cover")',
                },
                service: {
                    type: 'string',
                    description:
                        'The service to call (e.g., "turn_on", "turn_off", "lock", "unlock", "set_temperature")',
                },
                entity_id: {
                    type: 'string',
                    description: 'The target entity ID',
                },
                data: {
                    type: 'object',
                    description:
                        'Optional service data (e.g., {"brightness": 255} for lights, {"temperature": 22} for climate)',
                },
            },
            required: ['domain', 'service', 'entity_id'],
        },
    },
    {
        name: 'list_entities',
        description:
            'List all available Home Assistant entities with their current states. Use this when the user asks what devices are available or wants an overview.',
        input_schema: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
    },
];

const memoTools: Anthropic.Tool[] = [
    {
        name: 'read_memo',
        description:
            'Read a memo/note document from Just Maple. Returns the document title and content. Use this to check what is currently in a document before editing it.',
        input_schema: {
            type: 'object' as const,
            properties: {
                page_id: {
                    type: 'string',
                    description: 'The page ID (UUID) of the memo to read',
                },
            },
            required: ['page_id'],
        },
    },
    {
        name: 'update_memo',
        description:
            'Replace the content of a memo/note document in Just Maple with new markdown content. The content will be converted to rich text and synced to all connected clients in real time. Use this when the user asks you to write, update, or log information to a document.',
        input_schema: {
            type: 'object' as const,
            properties: {
                page_id: {
                    type: 'string',
                    description: 'The page ID (UUID) of the memo to update',
                },
                markdown: {
                    type: 'string',
                    description:
                        'The new markdown content for the document. This replaces the entire document.',
                },
                title: {
                    type: 'string',
                    description: 'Optional new title for the document',
                },
            },
            required: ['page_id', 'markdown'],
        },
    },
];

// ---- Handler ----

export class AIHandler {
    private client: Anthropic;
    private haClient: HAClient;
    private botId: string;
    private memoHelpers: MemoHelpers | null;

    constructor(apiKey: string, haClient: HAClient, botId: string, memoHelpers?: MemoHelpers) {
        this.client = new Anthropic({ apiKey });
        this.haClient = haClient;
        this.botId = botId;
        this.memoHelpers = memoHelpers || null;
    }

    /**
     * Process a user's message and return the assistant's response.
     */
    async processMessage(webhookMessages: WebhookMessage[]): Promise<string> {
        const systemPrompt = this.buildSystemPrompt();
        const messages = this.buildConversationMessages(webhookMessages);

        // Include memo tools only if memo helpers are available
        const allTools = this.memoHelpers ? [...haTools, ...memoTools] : haTools;

        // Tool-use loop: keep calling Claude until we get a final text response
        let currentMessages: Anthropic.MessageParam[] = messages;

        for (let i = 0; i < 10; i++) {
            const response = await this.client.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 1024,
                system: systemPrompt,
                tools: allTools,
                messages: currentMessages,
            });

            // Check if Claude wants to use tools
            const toolUseBlocks = response.content.filter(
                (block): block is Anthropic.ContentBlockParam & { type: 'tool_use' } =>
                    block.type === 'tool_use',
            );

            // If no tool use, extract text and return
            if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
                const textBlocks = response.content.filter(
                    (block): block is Anthropic.TextBlock => block.type === 'text',
                );
                return textBlocks.map((b) => b.text).join('\n') || 'Done.';
            }

            // Execute tools and build results
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const toolUse of toolUseBlocks) {
                const result = await this.executeTool(
                    toolUse.name,
                    toolUse.input as Record<string, unknown>,
                );
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(result),
                });
            }

            // Continue the conversation with tool results
            currentMessages = [
                ...currentMessages,
                { role: 'assistant', content: response.content },
                { role: 'user', content: toolResults },
            ];
        }

        return 'I was unable to complete the request after multiple attempts.';
    }

    // ---- Private Methods ----

    private buildSystemPrompt(): string {
        const entities = this.haClient.getExposedEntities();
        const entitySummary = entities
            .map((e) => {
                const friendly = (e.attributes.friendly_name as string) || e.entity_id;
                return `- ${e.entity_id}: "${friendly}" — state: ${e.state}`;
            })
            .join('\n');

        const lines = [
            'You are a Home Assistant controller integrated into a chat application called Just Maple.',
            'You can check device states and control smart home entities using the provided tools.',
            'Be concise and helpful. When you perform actions, confirm what you did.',
            'If a user asks about a device that does not exist in the list, let them know.',
        ];

        if (this.memoHelpers) {
            lines.push(
                '',
                'You also have the ability to read and write memo documents in Just Maple.',
                'When asked to log, record, or update a document, use the read_memo and update_memo tools.',
                'The update_memo tool replaces the entire document, so read it first if you need to preserve existing content.',
            );
        }

        lines.push(
            '',
            `Available entities (${entities.length}):`,
            entitySummary || '(No entities available)',
        );

        return lines.join('\n');
    }

    private buildConversationMessages(webhookMessages: WebhookMessage[]): Anthropic.MessageParam[] {
        const messages: ConversationMessage[] = [];

        for (const msg of webhookMessages) {
            // Skip empty messages
            if (!msg.content?.trim()) continue;

            if (msg.author.type === 'bot' && msg.author.id === this.botId) {
                messages.push({ role: 'assistant', content: msg.content });
            } else {
                const prefix = msg.author.type === 'user' ? `${msg.author.name}: ` : '';
                messages.push({
                    role: 'user',
                    content: prefix + msg.content,
                });
            }
        }

        // Ensure messages alternate properly and start with 'user'
        const cleaned: Anthropic.MessageParam[] = [];
        for (const msg of messages) {
            const last = cleaned[cleaned.length - 1];
            if (last && last.role === msg.role) {
                // Merge consecutive same-role messages
                last.content += '\n' + msg.content;
            } else {
                cleaned.push({ role: msg.role, content: msg.content });
            }
        }

        // Claude requires the first message to be from 'user'
        if (cleaned.length > 0 && cleaned[0].role !== 'user') {
            cleaned.shift();
        }

        // Ensure we have at least one message
        if (cleaned.length === 0) {
            cleaned.push({ role: 'user', content: 'Hello' });
        }

        return cleaned;
    }

    private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
        switch (name) {
            case 'get_entity_state': {
                const entityId = input.entity_id as string;
                const state = this.haClient.getEntityState(entityId);
                if (!state) {
                    return { error: `Entity "${entityId}" not found` };
                }
                return {
                    entity_id: state.entity_id,
                    state: state.state,
                    friendly_name: state.attributes.friendly_name,
                    attributes: state.attributes,
                    last_changed: state.last_changed,
                };
            }

            case 'call_service': {
                const domain = input.domain as string;
                const service = input.service as string;
                const entityId = input.entity_id as string;
                const data = (input.data as Record<string, unknown>) || {};

                try {
                    await this.haClient.callService(domain, service, data, {
                        entity_id: entityId,
                    });

                    // Fetch updated state after a brief delay
                    await new Promise((r) => setTimeout(r, 500));
                    const newState = this.haClient.getEntityState(entityId);

                    return {
                        success: true,
                        action: `${domain}.${service}`,
                        entity_id: entityId,
                        new_state: newState?.state ?? 'unknown',
                    };
                } catch (err) {
                    return {
                        success: false,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            }

            case 'list_entities': {
                const entities = this.haClient.getExposedEntities();
                return {
                    count: entities.length,
                    entities: entities.map((e) => ({
                        entity_id: e.entity_id,
                        friendly_name: e.attributes.friendly_name,
                        state: e.state,
                        domain: e.entity_id.split('.')[0],
                    })),
                };
            }

            case 'read_memo': {
                if (!this.memoHelpers) {
                    return { error: 'Memo editing is not configured' };
                }
                const pageId = input.page_id as string;
                const result = await this.memoHelpers.readMemo(pageId);
                if (!result) {
                    return {
                        error: `Failed to read memo "${pageId}". It may not exist or the bot lacks access.`,
                    };
                }
                return {
                    page_id: pageId,
                    title: result.title,
                    document: result.document,
                };
            }

            case 'update_memo': {
                if (!this.memoHelpers) {
                    return { error: 'Memo editing is not configured' };
                }
                const pageId = input.page_id as string;
                const markdown = input.markdown as string;
                const title = input.title as string | undefined;

                const success = await this.memoHelpers.writeMemo(pageId, markdown, title);
                return {
                    success,
                    page_id: pageId,
                    message: success
                        ? 'Document updated successfully. Changes are synced to all connected clients.'
                        : 'Failed to update document. Check the page ID and bot permissions.',
                };
            }

            default:
                return { error: `Unknown tool: ${name}` };
        }
    }
}
