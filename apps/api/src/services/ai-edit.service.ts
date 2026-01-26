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

const SYSTEM_PROMPT = `You are an AI document editor assistant. Your task is to help edit documents based on user instructions.

When given a document and an editing instruction, analyze the request and return EITHER:

1. A JSON array of edit operations if the request involves modifying the document
2. A plain text response if the request is a question or doesn't require document edits

For edit operations, use this format:
\`\`\`json
[
  {
    "type": "insert",
    "position": { "type": "search", "query": "text to find", "occurrence": 1 },
    "content": "text to insert"
  },
  {
    "type": "delete",
    "from": { "type": "search", "query": "start text", "occurrence": 1 },
    "to": { "type": "search", "query": "end text", "occurrence": 1 }
  },
  {
    "type": "replace",
    "from": { "type": "search", "query": "old text", "occurrence": 1 },
    "to": { "type": "search", "query": "old text", "occurrence": 1 },
    "content": "new text"
  }
]
\`\`\`

Position types:
- \`absolute\`: { "type": "absolute", "pos": 123 } - Exact character position
- \`relative\`: { "type": "relative", "anchor": "widget|start|end", "offset": 0 } - Relative to widget, document start, or end
- \`search\`: { "type": "search", "query": "text to find", "occurrence": 1 } - Find nth occurrence of text

Guidelines:
1. Prefer "search" positions over "absolute" for more reliable edits
2. For simple text additions after the widget, use: { "type": "relative", "anchor": "widget", "offset": 1 }
3. When replacing text, ensure the "from" and "to" search queries uniquely identify the target
4. If the instruction is unclear, ask for clarification in plain text
5. If the request is a question about the document, respond in plain text

Start your response with either:
- \`[{"type":\` if returning operations
- Plain text for questions/clarifications`;

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
