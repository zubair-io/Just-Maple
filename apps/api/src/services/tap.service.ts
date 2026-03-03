import Anthropic from '@anthropic-ai/sdk';
import { findCanvasByPageId } from '../repositories/canvas.repo';
import { getExecutor } from '../connectors/registry';
import { findUserBotsForNotebook, findUserBotByIdInternal } from '../repositories/user-bot.repo';
import { findJsonDocument } from '../repositories/json-document.repo';
import type { CanvasResponse } from '../repositories/canvas.repo';

interface TapBotConfig {
    apiKey: string;
    provider: 'anthropic' | 'inception';
    model: string;
}

/**
 * Get the best available bot config for tap execution.
 * Prefers Mercury (faster for UI composition) over Claude.
 */
export async function getTapBotConfig(notebookId: string): Promise<TapBotConfig | null> {
    const sharedBots = await findUserBotsForNotebook(notebookId);

    // 1. Look for Mercury bot first (preferred — faster for UI composition)
    const mercuryBot = sharedBots.find(
        (bot: any) =>
            bot.handle?.toLowerCase() === 'mercury' ||
            bot.templateName?.toLowerCase().includes('mercury'),
    );
    if (mercuryBot) {
        const fullBot = await findUserBotByIdInternal(mercuryBot._id);
        if (fullBot?.config?.apiKey) {
            return {
                apiKey: fullBot.config.apiKey,
                provider: 'inception',
                model: 'mercury-2',
            };
        }
    }

    // 2. Fall back to Claude bot
    const claudeBot = sharedBots.find(
        (bot: any) =>
            bot.handle?.toLowerCase() === 'claude' ||
            bot.handle?.toLowerCase() === 'ai' ||
            bot.templateName?.toLowerCase().includes('claude'),
    );
    if (!claudeBot) return null;

    const fullBot = await findUserBotByIdInternal(claudeBot._id);
    if (!fullBot?.config?.apiKey) return null;

    return {
        apiKey: fullBot.config.apiKey,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
    };
}

const SYSTEM_PROMPT = `You are a UI composer for Maple Canvas. You build widget templates using atom components and layout primitives.

ATOMS: text, stat, icon, badge, image, progress, timestamp, divider, link, list, checkbox
LAYOUTS: card, stack, row, grid

When a user query can be answered by an enabled connector:
1. If you can determine the layout without seeing the data, call render_ui directly with "bind" references to connector fields.
2. If you need to see the data first (to decide layout, filter results, or compose multiple sources), call the connector tool(s) first, then call render_ui with the data inlined.

When no connector matches, respond conversationally as a helpful assistant.

BINDING RULES:
- Use "bind": "fieldName" to reference connector data fields
- Use "format": "{value}°" for string interpolation
- Use "map": { "sunny": "wb_sunny", ... } to transform values (e.g., for icons)
- Use "value": "static text" for hardcoded content
- "_default" key in map is the fallback
- For nested objects: "bind": "weather.temp"
- For arrays: "bind": "data.0.title" accesses the first element's title field. Use "data.1.title", "data.2.title" etc. for subsequent items.
- The "list" atom only supports flat string arrays (e.g. ["item1", "item2"]). For arrays of objects (e.g. artworks, products), create individual atoms per item using index-based bind paths.

VALUE RESOLUTION ORDER: get raw value → apply map → apply format

IMAGE GUIDELINES:
- For the "image" atom, prefer full-resolution image URLs. Avoid "lqip" (Low Quality Image Placeholder) fields — they are tiny base64 placeholders that render as black squares.
- Look for fields like "image_url", "url", "src", "image", or construct URLs from ID fields when the API provides an image URL pattern (e.g. IIIF servers).
- If no suitable image URL exists, use a text description or icon instead.

LAYOUT PROPERTIES:
- card: rounded container with border. Props: header, padding (sm/md/lg)
- stack: vertical flex. Props: gap (xs/sm/md/lg), align
- row: horizontal flex. Props: gap (xs/sm/md/lg), align (start/center/end/stretch), wrap
- grid: CSS grid. Props: columns (number), gap (xs/sm/md/lg)

ATOM PROPERTIES:
- text: value, size (xs/sm/md/lg/xl), color (main/muted/primary/error/success), weight (normal/medium/bold)
- stat: value, label, size (sm/md/lg), format
- icon: name (Material Symbol name), size (xs/sm/md/lg/xl), color, map
- badge: value, color (red/amber/blue/green/gray), map
- image: src (must be a full URL, never use lqip/placeholder fields), alt, fit (cover/contain), rounded
- progress: value, max, variant (bar/ring), color
- timestamp: value, format (relative/date/time/datetime)
- divider: spacing (sm/md/lg)
- link: href, label, external
- list: items, ordered, size
- checkbox: checked, label, disabled

TEMPLATE FORMAT:
- Layout nodes MUST use "layout" key: { "layout": "card", "padding": "lg", "children": [...] }
- Atom nodes MUST use "atom" key: { "atom": "text", "value": "Hello", "size": "lg" }
- Properties go directly on the node, NOT inside a "props" wrapper.
- Do NOT use "type" key for layouts or atoms. Use "layout" or "atom" only.

Always call render_ui when you have data to display. Use bind for live data, value for static content.`;

const LAYOUT_TYPES = new Set(['card', 'stack', 'row', 'grid']);
const ATOM_TYPES = new Set([
    'text',
    'stat',
    'icon',
    'badge',
    'image',
    'progress',
    'timestamp',
    'divider',
    'link',
    'list',
    'checkbox',
]);

const BINDING_KEYS = new Set(['bind', 'format', 'map']);

/**
 * If a property value is an object containing binding directives (bind/format/map),
 * hoist those directives to the atom level. This handles LLMs (e.g. Mercury) that
 * nest bindings inside "value" or "name" instead of placing them as sibling keys.
 *
 * Example:  { "atom": "text", "value": { "bind": "temp", "format": "{value}°F" } }
 * Becomes:  { "atom": "text", "bind": "temp", "format": "{value}°F" }
 */
function hoistBindings(node: Record<string, unknown>): Record<string, unknown> {
    if (!('atom' in node)) return node;

    const result = { ...node };

    for (const key of ['value', 'name', 'label', 'href', 'checked', 'items']) {
        const val = result[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>;
            const hasBinding = Object.keys(obj).some((k) => BINDING_KEYS.has(k));
            if (hasBinding) {
                // Hoist binding keys to atom level, remove the wrapper
                delete result[key];
                for (const [bk, bv] of Object.entries(obj)) {
                    result[bk] = bv;
                }
            }
        }
    }

    return result;
}

/**
 * Map atom-specific property names (src, name, href, checked) to the
 * universal "value" key so the widget renderer's resolve() pipeline picks them up.
 * Only applied when neither "value" nor "bind" is already present.
 */
const ATOM_VALUE_ALIASES: Record<string, string> = {
    image: 'src',
    icon: 'name',
    link: 'href',
    checkbox: 'checked',
};

function normalizeAtomValue(node: Record<string, unknown>): Record<string, unknown> {
    const atomType = node['atom'] as string | undefined;
    if (!atomType || 'value' in node || 'bind' in node) return node;

    const alias = ATOM_VALUE_ALIASES[atomType];
    if (alias && alias in node) {
        const result = { ...node };
        result['value'] = result[alias];
        delete result[alias];
        return result;
    }
    return node;
}

function normalizeTemplate(node: Record<string, unknown>): Record<string, unknown> {
    // Already in correct format
    if ('layout' in node || 'atom' in node) {
        const result = { ...node };
        if (Array.isArray(result['children'])) {
            result['children'] = (result['children'] as Record<string, unknown>[]).map(
                normalizeTemplate,
            );
        }
        return normalizeAtomValue(hoistBindings(result));
    }

    const nodeType = node['type'] as string | undefined;
    if (!nodeType) return node;

    const props = (node['props'] as Record<string, unknown>) || {};
    const result: Record<string, unknown> = { ...props };

    if (LAYOUT_TYPES.has(nodeType)) {
        result['layout'] = nodeType;
    } else if (ATOM_TYPES.has(nodeType)) {
        result['atom'] = nodeType;
    } else {
        return node;
    }

    // Copy over keys that aren't 'type' or 'props'
    for (const [key, value] of Object.entries(node)) {
        if (key === 'type' || key === 'props') continue;
        if (key === 'children' && Array.isArray(value)) {
            result['children'] = (value as Record<string, unknown>[]).map(normalizeTemplate);
        } else if (!(key in result)) {
            result[key] = value;
        }
    }

    return normalizeAtomValue(hoistBindings(result));
}

/**
 * Unwrap connector response for widget rendering.
 * maple-json connector returns { data: {...}, version, updatedAt } —
 * the version/updatedAt metadata is not useful for rendering, and causes
 * a double-nesting issue where bind paths need "data.data.0.field" instead
 * of the cleaner "data.0.field". This function strips the wrapper.
 */
function unwrapConnectorData(raw: Record<string, unknown>): Record<string, unknown> {
    if ('data' in raw && ('version' in raw || 'updatedAt' in raw)) {
        const inner = raw['data'];
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            return inner as Record<string, unknown>;
        }
    }
    return raw;
}

interface TapResponse {
    type: 'render' | 'chat';
    template?: Record<string, unknown>;
    connectorId?: string;
    mode?: string;
    pollInterval?: number;
    text?: string;
    data?: Record<string, unknown>;
}

/**
 * For maple-json connectors, fetch the JSON documents to get their schemas
 * and descriptions so Claude knows the exact data structure.
 */
async function getJsonSchemaDescription(config: Record<string, unknown>): Promise<string> {
    const pageIdsRaw = config['pageIds'] as string | undefined;
    const singlePageId = config['pageId'] as string | undefined;
    const pageIds: string[] = pageIdsRaw
        ? pageIdsRaw
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
        : singlePageId
          ? [singlePageId]
          : [];

    if (pageIds.length === 0) return '';

    const docs = await Promise.all(pageIds.map((id) => findJsonDocument(id)));
    const parts: string[] = [];

    for (const doc of docs) {
        if (!doc) continue;
        const label = doc.description || doc.id;
        if (doc.schema) {
            parts.push(`${label}: schema=${JSON.stringify(doc.schema)}`);
        } else if (doc.data && typeof doc.data === 'object') {
            // Infer structure from data keys when no explicit schema
            const keys = Object.keys(doc.data as Record<string, unknown>);
            if (keys.length > 0) {
                parts.push(`${label}: fields=[${keys.join(', ')}]`);
            }
        }

        // Include a truncated data sample so the LLM knows the actual content
        if (doc.data != null) {
            let sample = JSON.stringify(doc.data);
            const MAX_SAMPLE = 2000;
            if (sample.length > MAX_SAMPLE) {
                sample = sample.slice(0, MAX_SAMPLE) + '…(truncated)';
            }
            parts.push(`${label} sample: ${sample}`);
        }
    }

    return parts.length > 0 ? ` Data structure: ${parts.join('; ')}.` : '';
}

async function buildConnectorTools(canvas: CanvasResponse): Promise<Anthropic.Messages.Tool[]> {
    const tools: Anthropic.Messages.Tool[] = [];

    for (const connector of canvas.connectors) {
        if (!connector.enabled) continue;

        const fieldDescriptions = Object.entries(connector.fields)
            .map(([name, def]) => {
                let desc = `${name} (${def.type}`;
                if (def.description) desc += `, ${def.description}`;
                if (def.enum) desc += `, enum: ${def.enum.join('/')}`;
                desc += ')';
                return desc;
            })
            .join(', ');

        let description = `${connector.name}: ${connector.description || ''}. Returns: ${fieldDescriptions}`;

        // Enrich maple-json connectors with actual schema/description from JSON documents
        if (connector.connectorType === 'maple-json' && connector.config) {
            const schemaDesc = await getJsonSchemaDescription(connector.config);
            if (schemaDesc) {
                description += schemaDesc;
            }
        }

        console.log(`[tap] Tool: connector_${connector.connectorId} →`, description.slice(0, 300));

        tools.push({
            name: `connector_${connector.connectorId}`,
            description,
            input_schema: {
                type: 'object' as const,
                properties: {},
            },
        });
    }

    // Add render_ui tool
    tools.push({
        name: 'render_ui',
        description:
            'Render a widget using atoms and layouts. Use "bind" for live data references, "value" for static content, "map" for value transformations, "format" for string interpolation.',
        input_schema: {
            type: 'object' as const,
            properties: {
                connectorId: {
                    type: 'string',
                    description: 'The connector ID to bind data from. Omit if data is inlined.',
                },
                mode: {
                    type: 'string',
                    enum: ['pull', 'widget'],
                    description: 'pull = ephemeral, widget = persistent',
                },
                pollInterval: {
                    type: 'number',
                    description: 'Seconds between refreshes. Only for widget mode.',
                },
                template: {
                    type: 'object',
                    description: 'Layout tree with atom nodes.',
                },
            },
            required: ['mode', 'template'],
        },
    });

    return tools;
}

/**
 * Convert Anthropic tool format to OpenAI function-calling format
 */
function toOpenAITools(anthropicTools: Anthropic.Messages.Tool[]): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: object };
}> {
    return anthropicTools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: (t.description as string) || '',
            parameters: t.input_schema,
        },
    }));
}

/**
 * Execute tap using OpenAI-compatible API (Inception / Mercury)
 */
async function executeTapOpenAI(
    canvas: CanvasResponse,
    query: string,
    userId: string,
    botConfig: TapBotConfig,
    tokens?: Record<string, string>,
): Promise<TapResponse> {
    const anthropicTools = await buildConnectorTools(canvas);
    const openAITools = toOpenAITools(anthropicTools);

    const messages: Array<{
        role: string;
        content: string;
        tool_calls?: any[];
        tool_call_id?: string;
        name?: string;
    }> = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
    ];

    // Track the last connector called so we can auto-attach it to render_ui
    let lastUsedConnectorId: string | undefined;

    const MAX_TURNS = 3;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        let data: any;
        try {
            const response = await fetch('https://api.inceptionlabs.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${botConfig.apiKey}`,
                },
                body: JSON.stringify({
                    model: botConfig.model,
                    max_tokens: 4096,
                    messages,
                    tools: openAITools,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`${response.status} - ${errText}`);
            }
            data = await response.json();
        } catch (err) {
            return {
                type: 'chat',
                text: `Sorry, I encountered an error processing your request. ${err instanceof Error ? err.message : ''}`,
            };
        }

        const choice = data.choices?.[0];
        if (!choice) {
            return { type: 'chat', text: 'I could not generate a response.' };
        }

        const finishReason = choice.finish_reason;

        // Text-only response
        if (finishReason === 'stop' || !choice.message.tool_calls?.length) {
            return {
                type: 'chat',
                text: choice.message.content || 'I could not generate a response.',
            };
        }

        // Process tool calls
        const toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> =
            choice.message.tool_calls || [];

        // Check for render_ui call
        const renderCall = toolCalls.find((tc) => tc.function.name === 'render_ui');
        if (renderCall) {
            const input = JSON.parse(renderCall.function.arguments) as Record<string, unknown>;
            const rawConnectorId = input.connectorId as string | undefined;
            // Use explicit connectorId, or fall back to last connector called
            const connectorId = rawConnectorId?.replace('connector_', '') || lastUsedConnectorId;

            let responseData: Record<string, unknown> = {};
            if (connectorId) {
                const connector = canvas.connectors.find((c) => c.connectorId === connectorId);
                if (connector) {
                    const executor = getExecutor(connector.connectorType);
                    if (executor) {
                        try {
                            const raw = await executor.execute(
                                connector.config || {},
                                connector.scope,
                                { userId, tokens, notebookId: canvas.notebookId },
                            );
                            responseData = unwrapConnectorData(raw);
                        } catch (err) {
                            console.error(`[tap] Connector ${connectorId} execution failed:`, err);
                        }
                    }
                }
            }

            return {
                type: 'render',
                template: normalizeTemplate(input.template as Record<string, unknown>),
                connectorId: connectorId || undefined,
                mode: (input.mode as string) || 'pull',
                pollInterval: input.pollInterval as number | undefined,
                data: responseData,
            };
        }

        // Handle connector tool calls — execute and continue the loop
        // Add assistant message with tool_calls
        messages.push({
            role: 'assistant',
            content: choice.message.content || '',
            tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: tc.function,
            })),
        });

        for (const toolCall of toolCalls) {
            if (toolCall.function.name === 'render_ui') continue;

            const connectorIdMatch = toolCall.function.name.replace('connector_', '');
            const connector = canvas.connectors.find((c) => c.connectorId === connectorIdMatch);

            // Track which connector was used
            if (connector) lastUsedConnectorId = connectorIdMatch;

            let resultContent: string;
            if (connector) {
                const executor = getExecutor(connector.connectorType);
                if (executor) {
                    try {
                        const execData = await executor.execute(
                            connector.config || {},
                            connector.scope,
                            { userId, tokens, notebookId: canvas.notebookId },
                        );
                        resultContent = JSON.stringify(execData);
                        const MAX_RESULT_CHARS = 50_000;
                        if (resultContent.length > MAX_RESULT_CHARS) {
                            resultContent =
                                resultContent.slice(0, MAX_RESULT_CHARS) +
                                '\n...[truncated — too many results]';
                        }
                    } catch (err) {
                        resultContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
                    }
                } else {
                    resultContent = `No executor found for connector type: ${connector.connectorType}`;
                }
            } else {
                resultContent = 'Connector not found';
            }

            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: resultContent,
            });
        }
    }

    return {
        type: 'chat',
        text: 'I was unable to complete your request. Please try a simpler query.',
    };
}

export async function executeTap(
    pageId: string,
    query: string,
    userId: string,
    tokens?: Record<string, string>,
): Promise<TapResponse> {
    const canvas = await findCanvasByPageId(pageId);
    if (!canvas) {
        return { type: 'chat', text: 'Canvas not found. Please create a canvas page first.' };
    }

    const enabledConnectors = canvas.connectors.filter((c) => c.enabled);
    if (enabledConnectors.length === 0) {
        return {
            type: 'chat',
            text: 'No connectors are enabled. Add and enable a connector in the connector panel to get started.',
        };
    }

    const botConfig = await getTapBotConfig(canvas.notebookId);
    if (!botConfig) {
        return {
            type: 'chat' as const,
            text: 'No AI bot configured for this notebook. Install a Claude or Mercury bot and add your API key to use Tap.',
        };
    }

    // Use OpenAI-compatible path for Inception (Mercury)
    if (botConfig.provider === 'inception') {
        return executeTapOpenAI(canvas, query, userId, botConfig, tokens);
    }

    const anthropic = new Anthropic({ apiKey: botConfig.apiKey });

    const tools = await buildConnectorTools(canvas);
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: query }];

    // Track the last connector called so we can auto-attach it to render_ui
    let lastUsedConnectorId: string | undefined;

    const MAX_TURNS = 3;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        let response: Anthropic.Messages.Message;
        try {
            response = await anthropic.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                system: SYSTEM_PROMPT,
                tools,
                messages,
            });
        } catch (err) {
            return {
                type: 'chat',
                text: `Sorry, I encountered an error processing your request. ${err instanceof Error ? err.message : ''}`,
            };
        }

        // Check for text-only response (chat fallback)
        if (response.stop_reason === 'end_turn') {
            const textBlock = response.content.find((b) => b.type === 'text');
            if (textBlock && textBlock.type === 'text') {
                return { type: 'chat', text: textBlock.text };
            }
            return { type: 'chat', text: 'I could not generate a response.' };
        }

        // Process tool use
        if (response.stop_reason === 'tool_use') {
            const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

            // Check for render_ui call
            const renderCall = toolUseBlocks.find(
                (b) => b.type === 'tool_use' && b.name === 'render_ui',
            );
            if (renderCall && renderCall.type === 'tool_use') {
                const input = renderCall.input as Record<string, unknown>;
                const rawConnectorId = input.connectorId as string | undefined;
                // Use explicit connectorId, or fall back to last connector called
                const connectorId =
                    rawConnectorId?.replace('connector_', '') || lastUsedConnectorId;

                // If there's a connector bound, fetch data
                let data: Record<string, unknown> = {};
                if (connectorId) {
                    const connector = canvas.connectors.find((c) => c.connectorId === connectorId);
                    if (connector) {
                        const executor = getExecutor(connector.connectorType);
                        if (executor) {
                            try {
                                const raw = await executor.execute(
                                    connector.config || {},
                                    connector.scope,
                                    { userId, tokens, notebookId: canvas.notebookId },
                                );
                                data = unwrapConnectorData(raw);
                            } catch (err) {
                                console.error(
                                    `[tap] Connector ${connectorId} execution failed:`,
                                    err,
                                );
                            }
                        }
                    }
                }

                return {
                    type: 'render',
                    template: normalizeTemplate(input.template as Record<string, unknown>),
                    connectorId: connectorId || undefined,
                    mode: (input.mode as string) || 'pull',
                    pollInterval: input.pollInterval as number | undefined,
                    data,
                };
            }

            // Handle connector tool calls - execute them and continue
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

            for (const toolBlock of toolUseBlocks) {
                if (toolBlock.type !== 'tool_use') continue;
                if (toolBlock.name === 'render_ui') continue;

                const connectorIdMatch = toolBlock.name.replace('connector_', '');
                const connector = canvas.connectors.find((c) => c.connectorId === connectorIdMatch);

                // Track which connector was used
                if (connector) lastUsedConnectorId = connectorIdMatch;

                if (connector) {
                    const executor = getExecutor(connector.connectorType);
                    if (executor) {
                        try {
                            const data = await executor.execute(
                                connector.config || {},
                                connector.scope,
                                { userId, tokens, notebookId: canvas.notebookId },
                            );
                            let content = JSON.stringify(data);
                            // Truncate oversized results to avoid exceeding token limits
                            const MAX_RESULT_CHARS = 50_000;
                            if (content.length > MAX_RESULT_CHARS) {
                                content =
                                    content.slice(0, MAX_RESULT_CHARS) +
                                    '\n...[truncated — too many results]';
                            }
                            toolResults.push({
                                type: 'tool_result',
                                tool_use_id: toolBlock.id,
                                content,
                            });
                        } catch (err) {
                            toolResults.push({
                                type: 'tool_result',
                                tool_use_id: toolBlock.id,
                                content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
                                is_error: true,
                            });
                        }
                    } else {
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolBlock.id,
                            content: `No executor found for connector type: ${connector.connectorType}`,
                            is_error: true,
                        });
                    }
                } else {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolBlock.id,
                        content: 'Connector not found',
                        is_error: true,
                    });
                }
            }

            // Add assistant response and tool results to messages
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: toolResults });
        }
    }

    // Max turns reached
    return {
        type: 'chat',
        text: 'I was unable to complete your request. Please try a simpler query.',
    };
}
