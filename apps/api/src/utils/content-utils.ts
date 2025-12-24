import type { NoteContent } from '@maple/shared';

/**
 * Extract plain text from TipTap JSON content
 */
export function extractTextFromContent(content: NoteContent | undefined | null): string {
    if (!content) return '';

    let text = '';

    function traverse(node: unknown): void {
        if (!node || typeof node !== 'object') return;

        const n = node as Record<string, unknown>;

        if (n.type === 'text' && typeof n.text === 'string') {
            text += n.text;
        } else if (n.type === 'mention') {
            const attrs = n.attrs as Record<string, unknown> | undefined;
            // Only add mention if handle exists and is non-empty
            if (attrs?.handle && typeof attrs.handle === 'string') {
                text += `@${attrs.handle}`;
            }
        } else if (n.type === 'paragraph' || n.type === 'heading') {
            if (text.length > 0 && !text.endsWith('\n')) {
                text += '\n';
            }
        }

        const children = n.content as unknown[] | undefined;
        if (Array.isArray(children)) {
            for (const child of children) {
                traverse(child);
            }
        }
    }

    traverse(content);
    return text.trim();
}

/**
 * Get text after a mention in content
 */
export function getTextAfterMention(
    content: NoteContent | undefined | null,
    mentionHandle: string,
): string {
    const fullText = extractTextFromContent(content);
    const mentionPattern = new RegExp(`@${mentionHandle}\\s*`, 'i');
    const match = fullText.match(mentionPattern);

    if (!match) return '';

    const afterMention = fullText.slice((match.index || 0) + match[0].length);
    // Get text until next mention or end
    const nextMention = afterMention.search(/@\w+/);
    return nextMention > -1 ? afterMention.slice(0, nextMention).trim() : afterMention.trim();
}
