import { botUIToText, type PageContent, type BotUIResponse } from '@maple/shared';
import { parseBotResponse } from '@maple/shared/bot-response';
import { markdownToProseMirror } from '../utils/markdown-to-prosemirror';
export { parseBotResponse, botUIPrompt } from '@maple/shared/bot-response';

/** Keep generated UI details available to text clients and subsequent conversation turns. */
export { botUIToText } from '@maple/shared';

/**
 * A bot message saved before the card parser could read it shows its card statements
 * (`root = Response(...)`) as text. Reads it again so it shows as a card, without
 * changing what's stored. Null when the message isn't one of those.
 */
export function repairRawBotUI(
    content: PageContent,
): { content: PageContent; ui: BotUIResponse; source: string } | null {
    const raw = plainText(content);
    if (!/(?:\broot\s*=\s*)?Response\s*\(/.test(raw)) return null;
    const parsed = parseBotResponse(raw);
    if (!parsed.ui) return null;
    return {
        content: markdownToProseMirror(parsed.markdown || botUIToText(parsed.ui)),
        ui: parsed.ui,
        source: raw,
    };
}

/** The text of a ProseMirror doc, one line per block. */
function plainText(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const { type, text, content } = node as { type?: string; text?: string; content?: unknown[] };
    if (type === 'text') return text ?? '';
    if (type === 'hardBreak') return '\n';
    const inner = (content ?? []).map(plainText);
    return type === 'doc' || type === 'bulletList' || type === 'orderedList'
        ? inner.join('\n')
        : inner.join('');
}
