/**
 * AI Handler - Claude API with Tool Use for Home Assistant
 *
 * Processes natural language requests by giving Claude tools to
 * query entity states and call HA services.
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

// ---- Tool Definitions ----

const tools: Anthropic.Tool[] = [
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

// ---- Handler ----

export class AIHandler {
    private client: Anthropic;
    private haClient: HAClient;
    private botId: string;

    constructor(apiKey: string, haClient: HAClient, botId: string) {
        this.client = new Anthropic({ apiKey });
        this.haClient = haClient;
        this.botId = botId;
    }

    /**
     * Process a user's message and return the assistant's response.
     */
    async processMessage(webhookMessages: WebhookMessage[]): Promise<string> {
        const systemPrompt = this.buildSystemPrompt();
        const messages = this.buildConversationMessages(webhookMessages);

        // Tool-use loop: keep calling Claude until we get a final text response
        let currentMessages: Anthropic.MessageParam[] = messages;

        for (let i = 0; i < 10; i++) {
            const response = await this.client.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 1024,
                system: systemPrompt,
                tools,
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

        return [
            'You are a Home Assistant controller integrated into a chat application.',
            'You can check device states and control smart home entities using the provided tools.',
            'Be concise and helpful. When you perform actions, confirm what you did.',
            'If a user asks about a device that does not exist in the list, let them know.',
            '',
            `Available entities (${entities.length}):`,
            entitySummary || '(No entities available)',
        ].join('\n');
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

            default:
                return { error: `Unknown tool: ${name}` };
        }
    }
}
