import { findUserBotByHandleForNotebookInternal } from '../repositories/user-bot.repo';
import { documentEditService, type DocumentEdit } from './document-edit.service';

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
    pageId: string; // Page ID for server-side edit application
    document: {
        content: string;
        format: 'markdown' | 'plaintext' | 'html';
    };
    context: {
        widgetPosition: number;
    };
}

export interface AiEditResponse {
    success: boolean;
    appliedCount: number;
    responseText?: string;
    errors?: string[];
    debug?: {
        serverDocLength: number;
        serverDocPreview: string;
    };
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
 * Now applies edits server-side via document-edit.service
 */
export class AiEditService {
    /**
     * Process an AI edit request - parses AI response and applies edits server-side
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

        // Parse the AI response to extract operations
        const parsed = this.parseAiResponse(response);

        // If no operations, return text response
        if (parsed.operations.length === 0) {
            return {
                success: true,
                appliedCount: 0,
                responseText: parsed.responseText,
            };
        }

        // Convert AI operations to document edits
        const edits = this.convertToDocumentEdits(
            parsed.operations,
            request.context.widgetPosition,
        );

        // Apply edits server-side
        const result = await documentEditService.applyEdits(request.pageId, edits);

        return {
            success: result.success,
            appliedCount: result.appliedCount,
            responseText: parsed.responseText,
            errors: result.errors,
            debug: result.debug,
        };
    }

    /**
     * Parse Claude's response into operations or text
     */
    private parseAiResponse(response: string): {
        operations: AiEditOperation[];
        responseText?: string;
    } {
        const trimmed = response.trim();

        // Try to extract JSON array from the response
        // It might be at the start, or inside a code block like ```json ... ```
        try {
            // First, try to find JSON in a code block
            const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
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
     * Convert AI edit operations to document edit format
     */
    private convertToDocumentEdits(
        operations: AiEditOperation[],
        widgetPosition: number,
    ): DocumentEdit[] {
        const edits: DocumentEdit[] = [];

        for (const op of operations) {
            if (op.type === 'insert' && op.content) {
                // Convert position anchor to document position
                let position: 'start' | 'end' | number = 'end';

                if (op.position) {
                    if (op.position.type === 'relative') {
                        if (op.position.anchor === 'start') {
                            position = 'start';
                        } else if (op.position.anchor === 'end') {
                            position = 'end';
                        } else if (op.position.anchor === 'widget') {
                            // Widget position + offset
                            position = widgetPosition + (op.position.offset || 0);
                        }
                    } else if (op.position.type === 'absolute') {
                        position = op.position.pos;
                    }
                }

                edits.push({
                    type: 'insert',
                    position,
                    content: op.content,
                });
            } else if (
                op.type === 'replace' &&
                op.from?.type === 'search' &&
                op.content !== undefined
            ) {
                edits.push({
                    type: 'replace',
                    search: op.from.query,
                    content: op.content,
                    occurrence: op.from.occurrence || 1,
                });
            } else if (op.type === 'delete' && op.from?.type === 'search') {
                // Convert delete to replace with empty string
                edits.push({
                    type: 'replace',
                    search: op.from.query,
                    content: '',
                    occurrence: op.from.occurrence || 1,
                });
            }
        }

        return edits;
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
