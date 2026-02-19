import type { PageContent } from '../schemas/page';

/**
 * Node visitor callback for content traversal
 */
export interface ContentNodeVisitor {
    /**
     * Called for each node in the content tree
     * @param node - The current node being visited
     * @param depth - The depth of the node in the tree (0 = root)
     * @returns false to stop traversing this branch, true/void to continue
     */
    (node: ContentNode, depth: number): boolean | void;
}

/**
 * Represents a node in the content tree
 */
export interface ContentNode {
    type: string;
    content?: ContentNode[];
    attrs?: Record<string, unknown>;
    text?: string;
}

/**
 * Traverse content tree with a visitor pattern
 * Provides a reusable way to walk through TipTap/ProseMirror JSON content
 */
export function traverseContent(
    content: PageContent | ContentNode | undefined | null,
    visitor: ContentNodeVisitor,
): void {
    if (!content || typeof content !== 'object') return;

    function traverse(node: unknown, depth: number): void {
        if (!node || typeof node !== 'object') return;

        const n = node as ContentNode;
        const shouldContinue = visitor(n, depth);

        // If visitor explicitly returns false, stop traversing this branch
        if (shouldContinue === false) return;

        if (Array.isArray(n.content)) {
            for (const child of n.content) {
                traverse(child, depth + 1);
            }
        }
    }

    traverse(content, 0);
}

/**
 * Mention attributes interface
 */
export interface MentionAttrs {
    id: string;
    handle: string;
    type: 'bot' | 'user';
}

/**
 * Extract all mentions from content
 */
export function extractMentions(content: PageContent | undefined | null): MentionAttrs[] {
    const mentions: MentionAttrs[] = [];

    traverseContent(content, (node) => {
        if (node.type === 'mention' && node.attrs) {
            const id = node.attrs['id'];
            const handle = node.attrs['handle'];
            const type = node.attrs['type'];

            if (typeof id === 'string' && typeof handle === 'string') {
                mentions.push({
                    id,
                    handle,
                    type: type === 'user' ? 'user' : 'bot',
                });
            }
        }
    });

    return mentions;
}

/**
 * Options for text extraction
 */
export interface ExtractTextOptions {
    /** Include newlines between paragraphs/headings (default: true) */
    includeNewlines?: boolean;
    /** Maximum length of extracted text (default: no limit) */
    maxLength?: number;
    /** Include mention handles as @handle (default: true) */
    includeMentions?: boolean;
}

/**
 * Extract plain text from content
 */
export function extractText(
    content: PageContent | undefined | null,
    options: ExtractTextOptions = {},
): string {
    const { includeNewlines = true, maxLength, includeMentions = true } = options;

    const parts: string[] = [];
    let currentLength = 0;

    traverseContent(content, (node): boolean | void => {
        // Check if we've hit max length
        if (maxLength && currentLength >= maxLength) {
            return false; // Stop traversal
        }

        if (node.type === 'text' && typeof node.text === 'string') {
            const text = maxLength ? node.text.slice(0, maxLength - currentLength) : node.text;
            parts.push(text);
            currentLength += text.length;
        } else if (node.type === 'mention' && includeMentions) {
            const attrs = node.attrs as MentionAttrs | undefined;
            if (attrs?.handle && typeof attrs.handle === 'string') {
                const mention = `@${attrs.handle}`;
                const text = maxLength ? mention.slice(0, maxLength - currentLength) : mention;
                parts.push(text);
                currentLength += text.length;
            }
        } else if (includeNewlines && (node.type === 'paragraph' || node.type === 'heading')) {
            const lastPart = parts[parts.length - 1];
            if (parts.length > 0 && lastPart && !lastPart.endsWith('\n')) {
                parts.push('\n');
                currentLength += 1;
            }
        }
    });

    const result = parts.join('');
    return includeNewlines ? result.trim() : result;
}

/**
 * Get text after a mention in content
 */
export function getTextAfterMention(
    content: PageContent | undefined | null,
    mentionHandle: string,
): string {
    const fullText = extractText(content);
    const mentionPattern = new RegExp(`@${mentionHandle}\\s*`, 'i');
    const match = fullText.match(mentionPattern);

    if (!match) return '';

    const afterMention = fullText.slice((match.index || 0) + match[0].length);
    // Get text until next mention or end
    const nextMention = afterMention.search(/@\w+/);
    return nextMention > -1 ? afterMention.slice(0, nextMention).trim() : afterMention.trim();
}
