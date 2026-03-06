import { findUserBotByHandleForNotebookInternal } from '../repositories/user-bot.repo';
import { findPagesByUserId } from '../repositories/page.repo';
import { findJsonDocument } from '../repositories/json-document.repo';
import { addWidget, addConnector, findCanvasById } from '../repositories/canvas.repo';
import type { CanvasWidget, CanvasConnector } from '@maple/shared';

const DEFAULT_LLM_MODEL = process.env.AI_WRITING_MODEL || 'claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are a UI widget designer. Given a user prompt and optional JSON data context, generate a single CanvasWidget JSON object.

## Widget DSL

A widget template is a recursive tree of nodes. Each node is one of:

### Atom (leaf node) — renders a single UI element
\`\`\`json
{ "atom": "<type>", "value": "static value" }
{ "atom": "<type>", "bind": "$.path.to.data" }
\`\`\`
Atom types: text, stat, icon, badge, image, progress, timestamp, divider, link, list, checkbox
Atom properties (all optional): value, bind, format, size (sm|md|lg|xl), color, weight (normal|medium|semibold|bold), label, src, href, checked, ordered, items, name, alt, fit, rounded, max, variant, external, disabled, spacing

### Layout (container) — arranges children
\`\`\`json
{ "layout": "stack|row|grid|card", "children": [...nodes], "gap": "sm|md|lg", "columns": 3 }
\`\`\`

### Each (loop) — iterate an array
\`\`\`json
{ "each": "$.items", "as": "item", "template": { ...node using "{{item.field}}" } }
\`\`\`

### When (conditional)
\`\`\`json
{ "when": "{{item.active}}", "then": { ...node }, "else": { ...node } }
\`\`\`

## Data binding
- \`"bind": "$.field"\` resolves a path from the widget data context
- \`"value": "{{item.name}}"\` interpolates expressions in strings
- Inside an \`each\` block, use the \`as\` variable name: \`"{{book.title}}"\`

## Output format
Return ONLY a JSON object with this shape (no markdown fences, no explanation):
{
  "title": "Widget Title",
  "template": { ...root node },
  "pageId": "the-page-id-from-context"  // REQUIRED: the page ID of the JSON data source you are using
}`;

/**
 * Build a data context summary from JSON pages in the notebook.
 * Returns a string describing available data shapes.
 */
interface DataContext {
    summary: string;
    /** Map of pageId -> page title for all JSON pages with data */
    jsonPages: Map<string, string>;
}

async function buildDataContext(notebookId: string, userId: string): Promise<DataContext> {
    const pages = await findPagesByUserId(userId, { notebookId });
    const jsonPages = pages.filter((p) => p.type === 'json');
    const jsonPageMap = new Map<string, string>();

    if (jsonPages.length === 0) {
        return {
            summary: 'No JSON data pages found in this notebook.',
            jsonPages: jsonPageMap,
        };
    }

    const descriptions: string[] = [];

    for (const page of jsonPages.slice(0, 3)) {
        const doc = await findJsonDocument(page.id);
        if (!doc) continue;

        const dataPreview = JSON.stringify(doc.data, null, 2);
        const truncated =
            dataPreview.length > 2000
                ? dataPreview.slice(0, 2000) + '\n... (truncated)'
                : dataPreview;

        descriptions.push(
            `### "${page.title || 'Untitled'}" (pageId: "${page.id}")\n${doc.description ? `Description: ${doc.description}\n` : ''}Data:\n\`\`\`json\n${truncated}\n\`\`\``,
        );

        if (doc.data && typeof doc.data === 'object') {
            jsonPageMap.set(page.id, page.title || 'Untitled');
        }
    }

    return {
        summary: `Available JSON data in this notebook:\n\n${descriptions.join('\n\n')}`,
        jsonPages: jsonPageMap,
    };
}

/**
 * Call Claude API (non-streaming) and return the raw text response.
 */
async function callClaude(
    apiKey: string,
    isOAuthToken: boolean,
    userPrompt: string,
): Promise<string> {
    const systemPrompt = isOAuthToken
        ? `You are Claude Code, Anthropic's official CLI for Claude.\n\n${SYSTEM_PROMPT}`
        : SYSTEM_PROMPT;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            model: DEFAULT_LLM_MODEL,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
    };

    const textBlock = result.content.find((c) => c.type === 'text');
    return textBlock?.text || '';
}

/**
 * Parse the AI response into a widget definition.
 * Handles both raw JSON and markdown-fenced JSON.
 */
function parseWidgetResponse(raw: string): {
    title: string;
    template: unknown;
    dataPath?: string;
    pageId?: string;
} {
    let cleaned = raw.trim();

    // Strip markdown code fences if present
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }

    return JSON.parse(cleaned);
}

/**
 * Generate a canvas widget from a natural language prompt.
 */
export async function generateWidget(
    canvasPageId: string,
    notebookId: string,
    userId: string,
    prompt: string,
): Promise<CanvasWidget> {
    // Get API key from user's Claude bot
    const userBot = await findUserBotByHandleForNotebookInternal('claude', notebookId);

    if (!userBot?.config?.apiKey) {
        throw new Error(
            'Claude bot not configured. Please add a Claude bot with your API key to this notebook.',
        );
    }

    const apiKey = userBot.config.apiKey as string;
    const isOAuthToken = (userBot.config?.isOAuthToken as boolean) || false;

    // Build data context from JSON pages
    const { summary: dataContext, jsonPages } = await buildDataContext(notebookId, userId);

    // Build user prompt
    const userPrompt = `${dataContext}\n\n## User request\n${prompt}`;

    // Call Claude
    const rawResponse = await callClaude(apiKey, isOAuthToken, userPrompt);

    // Parse response
    const parsed = parseWidgetResponse(rawResponse);

    // Use the AI-selected pageId, fall back to first available
    const selectedPageId =
        parsed.pageId && jsonPages.has(parsed.pageId)
            ? parsed.pageId
            : (jsonPages.keys().next().value ?? null);
    const selectedPageTitle = selectedPageId ? jsonPages.get(selectedPageId) : null;

    // Create a connector for the JSON page data source (if available)
    let connectorId: string | undefined;
    if (selectedPageId) {
        connectorId = crypto.randomUUID();
        const connector: CanvasConnector = {
            connectorId,
            connectorType: 'json-page',
            enabled: true,
            name: selectedPageTitle || 'JSON Data',
            config: { pageId: selectedPageId },
            fields: {},
        };
        await addConnector(canvasPageId, connector);
    }

    // Build the widget linked to the connector
    const widget: CanvasWidget = {
        id: crypto.randomUUID(),
        title: parsed.title || 'Widget',
        template: parsed.template as CanvasWidget['template'],
        dataPath: parsed.dataPath,
        connectorId,
        prompt,
        createdAt: new Date().toISOString(),
    };

    // Save to canvas
    await addWidget(canvasPageId, widget);

    return widget;
}

/**
 * Regenerate an existing widget with a new prompt.
 */
export async function regenerateWidget(
    canvasPageId: string,
    widgetId: string,
    notebookId: string,
    userId: string,
    prompt: string,
): Promise<CanvasWidget> {
    const canvas = await findCanvasById(canvasPageId);
    if (!canvas) throw new Error('Canvas not found');

    const existingWidget = canvas.widgets.find((w) => w.id === widgetId);
    if (!existingWidget) throw new Error('Widget not found');

    // Get API key
    const userBot = await findUserBotByHandleForNotebookInternal('claude', notebookId);
    if (!userBot?.config?.apiKey) {
        throw new Error(
            'Claude bot not configured. Please add a Claude bot with your API key to this notebook.',
        );
    }

    const apiKey = userBot.config.apiKey as string;
    const isOAuthToken = (userBot.config?.isOAuthToken as boolean) || false;

    // Build data context
    const { summary: dataContext } = await buildDataContext(notebookId, userId);

    // Include existing widget context for better regeneration
    const userPrompt = `${dataContext}\n\n## Current widget\nTitle: ${existingWidget.title}\nOriginal prompt: ${existingWidget.prompt || '(none)'}\n\n## New request\n${prompt}`;

    const rawResponse = await callClaude(apiKey, isOAuthToken, userPrompt);
    const parsed = parseWidgetResponse(rawResponse);

    const updatedWidget: CanvasWidget = {
        id: widgetId,
        title: parsed.title || existingWidget.title || 'Widget',
        template: parsed.template as CanvasWidget['template'],
        dataPath: parsed.dataPath,
        connectorId: existingWidget.connectorId,
        prompt,
        createdAt: existingWidget.createdAt,
        updatedAt: new Date().toISOString(),
    };

    return updatedWidget;
}
