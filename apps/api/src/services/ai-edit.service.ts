import { findUserBotByHandleForNotebookInternal } from '../repositories/user-bot.repo';

// Configuration constants
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'claude-sonnet-4-20250514';

export interface AiEditOperation {
    type: 'insert' | 'delete' | 'replace';
    position?: AnchorPosition;
    from?: AnchorPosition;
    to?: AnchorPosition;
    content?: string;
}

export type AnchorPosition =
    | { type: 'absolute'; pos: number }
    | { type: 'relative'; anchor: 'widget' | 'start' | 'end'; offset: number }
    | { type: 'search'; query: string; occurrence: number };

export interface AiEditRequest {
    prompt: string;
    document: {
        content: string;
        format: 'markdown' | 'plaintext' | 'html';
    };
    context: {
        widgetPosition: number;
    };
}

export interface AiEditResponse {
    operations: AiEditOperation[];
    responseText?: string;
}

const SYSTEM_PROMPT = `You are an AI document editor assistant. Return JSON operations to edit documents.

IMPORTANT RULES:
1. Almost all requests should return edit operations, not plain text
2. Only respond with plain text for explicit questions ("what does X mean?", "is this correct?")

Return a JSON array of operations:
\`\`\`json
[
  {
    "type": "insert",
    "position": { "type": "relative", "anchor": "widget", "offset": 1 },
    "content": "## New Heading\\n\\nNew paragraph with **bold** text."
  },
  {
    "type": "replace",
    "from": { "type": "search", "query": "exact text to find", "occurrence": 1 },
    "content": "replacement text with **formatting**"
  }
]
\`\`\`

CRITICAL - Search query rules:
- Search queries must be PLAIN TEXT ONLY - no markdown formatting
- DO NOT include: # for headings, ** for bold, * for italic, > for quotes, - for lists
- DO NOT include newlines (\\n) in search queries - text is stored without line breaks
- Search for the actual visible text content only
- Example: To find "# My Heading", search for "My Heading" (without the #)
- Example: To find "**bold text**", search for "bold text" (without the **)
- Minimum 10 characters for search queries to ensure unique matches

Operation types:
1. INSERT - Add new content at widget position:
   { "type": "insert", "position": { "type": "relative", "anchor": "widget", "offset": 1 }, "content": "markdown content" }

2. REPLACE - Change existing text (search query is plain text, content can have markdown):
   { "type": "replace", "from": { "type": "search", "query": "plain text to find", "occurrence": 1 }, "content": "new **formatted** content" }

3. DELETE - Avoid using delete operations. Use replace with empty content instead.

Examples:
- "write a summary" → insert operation
- "fix spelling of 'teh'" → replace "teh" with "the"
- "make this bold" → replace the text with **text**
- "add bullet points" → insert formatted list

Start response with \`[{"type":\` for operations.`;

/**
 * AI Document Edit Service
 * Handles AI-powered document editing requests
 */
export class AiEditService {
    /**
     * Process an AI edit request and return operations or response text
     */
    async processEditRequest(notebookId: string, request: AiEditRequest): Promise<AiEditResponse> {
        // Find Claude bot for this notebook (use Internal version to get full config with API key)
        const userBot = await findUserBotByHandleForNotebookInternal('claude', notebookId);

        if (!userBot) {
            throw new Error(
                'Claude bot not found. Please ensure you have registered a Claude bot and shared it with this notebook.',
            );
        }

        const apiKey = userBot.config?.apiKey;
        if (!apiKey) {
            throw new Error('Claude API key not configured for the bot.');
        }

        const isOAuthToken = userBot.config?.isOAuthToken || false;

        // Build the user prompt
        const userPrompt = `Document:
\`\`\`
${request.document.content}
\`\`\`

Instruction: ${request.prompt}`;

        // Call Claude API
        const response = await this.callClaudeAPI({
            apiKey,
            isOAuthToken,
            model: DEFAULT_LLM_MODEL,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            maxTokens: 4096,
        });

        // Parse response
        return this.parseResponse(response);
    }

    /**
     * Parse Claude's response into operations or text
     */
    private parseResponse(response: string): AiEditResponse {
        const trimmed = response.trim();

        // Try to extract JSON array from the response
        // It might be at the start, or inside a code block like ```json ... ```
        try {
            // First, try to find JSON in a code block
            const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            if (codeBlockMatch) {
                const operations = JSON.parse(codeBlockMatch[1]) as AiEditOperation[];
                if (Array.isArray(operations) && operations.every(this.isValidOperation)) {
                    return { operations };
                }
            }

            // If no code block, check if response starts with [
            if (trimmed.startsWith('[')) {
                const jsonMatch = trimmed.match(/^\[[\s\S]*?\]/);
                if (jsonMatch) {
                    const operations = JSON.parse(jsonMatch[0]) as AiEditOperation[];
                    if (Array.isArray(operations) && operations.every(this.isValidOperation)) {
                        return { operations };
                    }
                }
            }
        } catch {
            // If JSON parsing fails, treat as text response
        }

        // Return as plain text response
        return {
            operations: [],
            responseText: trimmed,
        };
    }

    /**
     * Validate an operation structure
     */
    private isValidOperation(op: unknown): op is AiEditOperation {
        if (typeof op !== 'object' || op === null) return false;
        const operation = op as Record<string, unknown>;

        if (!['insert', 'delete', 'replace'].includes(operation['type'] as string)) {
            return false;
        }

        return true;
    }

    /**
     * Call Claude API directly
     */
    private async callClaudeAPI(params: {
        apiKey: string;
        isOAuthToken: boolean;
        model: string;
        systemPrompt: string;
        userPrompt: string;
        maxTokens: number;
    }): Promise<string> {
        // For OAuth tokens, prepend Claude Code prefix
        let systemPrompt = params.systemPrompt;
        if (params.isOAuthToken) {
            const claudeCodePrompt = "You are Claude Code, Anthropic's official CLI for Claude.";
            systemPrompt = `${claudeCodePrompt}\n\n${params.systemPrompt}`;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': params.apiKey,
        };

        const requestBody = {
            model: params.model,
            max_tokens: params.maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: params.userPrompt }],
        };

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
}

// Singleton instance
export const aiEditService = new AiEditService();
