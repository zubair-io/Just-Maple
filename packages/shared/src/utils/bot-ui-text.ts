import type { BotUIResponse } from '../schemas/bot-ui';
import type { PageContent } from '../schemas/page';
import { extractText } from './content-traversal';

/** Plain-text version of bot UI blocks, for notifications, text clients and later turns. */
export function botUIToText(ui: BotUIResponse): string {
    return ui.blocks
        .map((block) => {
            switch (block.type) {
                case 'text':
                    return block.content;
                case 'card':
                    return `${block.title}\n${block.content}`;
                case 'table':
                    return [
                        block.headers.join(' | '),
                        ...block.rows.map((row) => row.join(' | ')),
                    ].join('\n');
                case 'button':
                    return `${block.label}: ${block.message}`;
                case 'form':
                    return `${block.title}\n${block.fields.map((field) => field.label).join(', ')}`;
                case 'source':
                    return `Source: ${block.label} (${block.itemId})`;
            }
        })
        .join('\n\n');
}

/**
 * True when a bot message's text is only the flattened copy of its UI blocks (the reply
 * had no Markdown of its own). Clients that render the blocks should hide that text.
 */
export function isBotUIFallbackContent(
    content: PageContent | undefined | null,
    ui: BotUIResponse | undefined | null,
): boolean {
    if (!ui) return false;
    const squash = (text: string) => text.replace(/\s+/g, '');
    const text = squash(extractText(content));
    return !text || text === squash(botUIToText(ui));
}
