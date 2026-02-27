/**
 * Parser/serializer for typed fenced code blocks (maple:embed, maple:page-link, maple:image).
 *
 * Format:
 * ```maple:embed
 * { "url": "...", "title": "..." }
 * ```
 */

export type TypedBlockType = 'embed' | 'page-link' | 'image';

export interface TypedBlock {
    type: TypedBlockType;
    data: Record<string, unknown>;
    startLine: number;
    endLine: number;
}

export interface TypedBlockError {
    error: string;
    line: number;
}

export type TypedBlockResult = TypedBlock | TypedBlockError;

// Match ```maple:(type)\n...\n```
const FENCE_OPEN_REGEX = /^```maple:(embed|page-link|image)\s*$/;
const FENCE_CLOSE = '```';

/**
 * Parse all typed maple blocks from a markdown string.
 * Non-maple code fences are ignored. Returns errors with line numbers for invalid JSON.
 */
export function parseTypedBlocks(markdown: string): TypedBlockResult[] {
    const lines = markdown.split('\n');
    const results: TypedBlockResult[] = [];

    let i = 0;
    while (i < lines.length) {
        const openMatch = lines[i]!.match(FENCE_OPEN_REGEX);
        if (!openMatch) {
            i++;
            continue;
        }

        const type = openMatch[1] as TypedBlockType;
        const startLine = i;
        const jsonLines: string[] = [];

        i++;
        while (i < lines.length && lines[i] !== FENCE_CLOSE) {
            jsonLines.push(lines[i]!);
            i++;
        }

        const endLine = i;
        i++; // skip closing ```

        const jsonStr = jsonLines.join('\n').trim();
        if (!jsonStr) {
            results.push({ error: 'Empty block body', line: startLine + 1 });
            continue;
        }

        try {
            const data = JSON.parse(jsonStr) as Record<string, unknown>;
            results.push({ type, data, startLine, endLine });
        } catch {
            results.push({
                error: `Invalid JSON in maple:${type} block`,
                line: startLine + 1,
            });
        }
    }

    return results;
}

/**
 * Serialize a typed block back into a fenced code block string.
 */
export function serializeTypedBlock(type: TypedBlockType, data: Record<string, unknown>): string {
    const json = JSON.stringify(data, null, 2);
    return `\`\`\`maple:${type}\n${json}\n\`\`\``;
}
