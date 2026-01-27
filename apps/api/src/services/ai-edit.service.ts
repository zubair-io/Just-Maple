import { findUserBotByHandleForNotebookInternal } from '../repositories/user-bot.repo';
import { documentEditService, type AIEdit } from './document-edit.service';

// Configuration constants
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'claude-sonnet-4-20250514';

export interface AiEditRequest {
    prompt: string;
    pageId: string; // Page ID for server-side edit application
    context: {
        widgetPosition: number;
    };
}

export interface AiEditResponse {
    success: boolean;
    appliedCount: number;
    responseText?: string;
    errors?: string[];
}

const SYSTEM_PROMPT = `You are an AI document editor. You edit documents using PATH-BASED operations.

## Document Structure
The document is a ProseMirror JSON tree. Each node has:
- type: "paragraph", "heading", "bulletList", "listItem", "text", etc.
- content: array of child nodes
- attrs: node attributes (like heading level)
- text: for text nodes, the actual text content
- marks: formatting like bold, italic

## Path Navigation
Paths are arrays of integers navigating the tree:
- [0] = first child of root (usually first paragraph)
- [1] = second child of root
- [2, 0] = third child's first child
- [2, 0, 0] = third child's first grandchild

Example document:
{
  "type": "doc",
  "content": [
    { "type": "heading", "content": [{ "type": "text", "text": "Title" }] },     // path [0]
    { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] },   // path [1]
    { "type": "bulletList", "content": [                                         // path [2]
      { "type": "listItem", "content": [{ "type": "paragraph", "content": [...] }] }  // path [2, 0]
    ]}
  ]
}

## Response Format
Return JSON with "edits" array. For questions, return "response" instead.

\`\`\`json
{
  "edits": [
    { "path": [1], "op": { "type": "replace-text", "offset": 0, "length": 5, "text": "Hi there" } }
  ]
}
\`\`\`

Or for questions:
\`\`\`json
{ "response": "The answer to your question is..." }
\`\`\`

## Operation Types

### Text Operations (for nodes containing text)
- search-replace: Find and replace text (RECOMMENDED for fixing typos/text changes)
  { "path": [1], "op": { "type": "search-replace", "search": "teh", "replace": "the" } }

- replace-text: Replace text at exact offset with length (use search-replace instead when possible)
  { "path": [1], "op": { "type": "replace-text", "offset": 0, "length": 3, "text": "new" } }

- insert-text: Insert text at offset
  { "path": [1], "op": { "type": "insert-text", "offset": 5, "text": " world" } }

- delete-text: Delete text at offset
  { "path": [1], "op": { "type": "delete-text", "offset": 0, "length": 5 } }

### Node Operations
- replace-node: Replace entire node with new content
  { "path": [1], "op": { "type": "replace-node", "content": { "type": "paragraph", "content": [{ "type": "text", "text": "New paragraph" }] } } }

- insert-node: Insert new node at index (path points to parent, index is insertion position)
  { "path": [0], "op": { "type": "insert-node", "index": 1, "content": { "type": "paragraph", "content": [{ "type": "text", "text": "Inserted" }] } } }

- delete-node: Delete the node at path
  { "path": [2], "op": { "type": "delete-node" } }

### Formatting Operations
- set-attrs: Set attributes on element (like heading level)
  { "path": [0], "op": { "type": "set-attrs", "attrs": { "level": 2 } } }

- format-text: Apply mark to text range
  { "path": [1], "op": { "type": "format-text", "offset": 0, "length": 5, "mark": "bold", "value": true } }

## Rules
1. Make minimal edits - only change what's necessary
2. Preserve existing formatting unless asked to change it
3. For text in paragraphs/headings, the text node is inside content array
4. When fixing typos or replacing text, use search-replace (NOT replace-text with offsets)
5. When adding content, prefer insert-node to add new paragraphs

## Examples
- "fix typo 'teh'" → use search-replace: { "path": [1], "op": { "type": "search-replace", "search": "teh", "replace": "the" } }
- "change 'Hello' to 'Hi'" → use search-replace on the node containing that text
- "make title bold" → use format-text on the heading's text
- "add a paragraph about X" → use insert-node to add new paragraph
- "delete the second bullet" → use delete-node on path to that list item

Start response with \`{"edits":\` for operations or \`{"response":\` for questions.`;

/**
 * AI Document Edit Service
 * Handles AI-powered document editing requests using path-based operations
 */
export class AiEditService {
    /**
     * Process an AI edit request - gets document JSON, calls AI, applies path-based edits
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

        // Get document as JSON (path-based approach)
        const documentJson = await documentEditService.getDocumentAsJSON(request.pageId);

        // Build the user prompt with JSON document
        const userPrompt = `Document (ProseMirror JSON):
\`\`\`json
${JSON.stringify(documentJson, null, 2)}
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

        // Parse the AI response
        const parsed = this.parseAiResponse(response);

        // If text response (question answer), return it
        if (parsed.responseText) {
            return {
                success: true,
                appliedCount: 0,
                responseText: parsed.responseText,
            };
        }

        // If no edits, return success with no changes
        if (parsed.edits.length === 0) {
            return {
                success: true,
                appliedCount: 0,
            };
        }

        // Apply path-based edits
        const result = await documentEditService.applyAIEdits(request.pageId, parsed.edits);

        return {
            success: result.success,
            appliedCount: result.appliedCount,
            errors: result.errors,
        };
    }

    /**
     * Parse Claude's response into path-based edits or text response
     */
    private parseAiResponse(response: string): {
        edits: AIEdit[];
        responseText?: string;
    } {
        const trimmed = response.trim();

        try {
            // Try to extract JSON object from code block
            const codeBlockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                const parsed = JSON.parse(codeBlockMatch[1]) as {
                    edits?: AIEdit[];
                    response?: string;
                };

                if (parsed.response) {
                    return { edits: [], responseText: parsed.response };
                }

                if (parsed.edits && Array.isArray(parsed.edits)) {
                    const validEdits = parsed.edits.filter((e) => this.isValidAIEdit(e));
                    return { edits: validEdits };
                }
            }

            // Check if response starts with { (direct JSON object)
            if (trimmed.startsWith('{')) {
                // Match a complete JSON object
                const jsonMatch = trimmed.match(/^\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]) as {
                        edits?: AIEdit[];
                        response?: string;
                    };

                    if (parsed.response) {
                        return { edits: [], responseText: parsed.response };
                    }

                    if (parsed.edits && Array.isArray(parsed.edits)) {
                        const validEdits = parsed.edits.filter((e) => this.isValidAIEdit(e));
                        return { edits: validEdits };
                    }
                }
            }
        } catch (error) {
            console.log('[AiEdit] JSON parse error:', error);
            // If JSON parsing fails, treat as text response
        }

        // Return as plain text response
        return {
            edits: [],
            responseText: trimmed,
        };
    }

    /**
     * Validate an AIEdit structure
     */
    private isValidAIEdit(edit: unknown): edit is AIEdit {
        if (typeof edit !== 'object' || edit === null) return false;
        const e = edit as Record<string, unknown>;

        // Must have path array and op object
        if (!Array.isArray(e['path'])) return false;
        if (typeof e['op'] !== 'object' || e['op'] === null) return false;

        const op = e['op'] as Record<string, unknown>;
        const validTypes = [
            'replace-text',
            'insert-text',
            'delete-text',
            'search-replace',
            'replace-node',
            'insert-node',
            'delete-node',
            'set-attrs',
            'format-text',
        ];

        if (!validTypes.includes(op['type'] as string)) return false;

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
