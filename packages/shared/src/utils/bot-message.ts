import { Value } from '@sinclair/typebox/value';
import { BotUIResponseSchema, type BotUIResponse } from '../schemas/bot-ui';
import type { Message } from '../schemas/message';
import type { PageContent } from '../schemas/page';
import { parseBotResponse } from './bot-ui-parser';
import { botUIToText } from './bot-ui-text';
import { markdownToProseMirror } from './markdown-to-prosemirror';

/** Preserve block boundaries when recovering source from legacy rich-text replies. */
export function botResponseText(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const { type, text, content } = node as { type?: string; text?: string; content?: unknown[] };
    if (type === 'text') return text ?? '';
    if (type === 'hardBreak') return '\n';
    const children = (content ?? []).map(botResponseText);
    return ['doc', 'bulletList', 'orderedList'].includes(type ?? '')
        ? children.join('\n')
        : children.join('');
}

/** Pure render-time projection. Never modifies the saved message or executes source. */
export function botMessagePresentation(
    message: Pick<Message, 'senderType' | 'content' | 'botUI' | 'botResponseSource'>,
): { content: PageContent; botUI?: BotUIResponse } {
    const original = { content: message.content, botUI: message.botUI };
    if (message.senderType !== 'bot') return { content: message.content };
    const source = message.botResponseSource ?? botResponseText(message.content);
    const parsed = parseBotResponse(source);
    if (!parsed.ui && message.botResponseSource === undefined) return original;
    const cached = Value.Check(BotUIResponseSchema, message.botUI) ? message.botUI : undefined;
    // Only persisted server-created cards can carry action/proposal IDs. They are
    // never parsed from model source and still load current permissions/state on tap.
    const trusted =
        cached?.blocks.filter((block) =>
            ['event_proposal', 'home_proposal', 'action_receipt', 'reply_draft'].includes(
                block.type,
            ),
        ) ?? [];
    const botUI: BotUIResponse | undefined = parsed.ui
        ? { ...parsed.ui, blocks: [...parsed.ui.blocks.slice(0, 30 - trusted.length), ...trusted] }
        : cached;
    return {
        content: markdownToProseMirror(parsed.markdown || (botUI ? botUIToText(botUI) : '')),
        botUI,
    };
}
