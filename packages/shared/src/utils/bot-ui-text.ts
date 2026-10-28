import type { BotUIResponse } from '../schemas/bot-ui';
import type { CalendarEventDraft } from '../schemas/calendar-proposal';
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
                case 'event_proposal':
                    return eventProposalText(block.event);
                case 'action_receipt':
                    return `Done: ${block.summary}`;
                case 'reply_draft':
                    // Never the draft itself: this text reaches everyone in the chat.
                    return 'Drafted a reply (only the person it is for can see it).';
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
    // Compare letters and digits only: the stored copy went through Markdown, which
    // drops markers like ** and _ that the block text still contains.
    const squash = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, '');
    const text = squash(extractText(content));
    return !text || text === squash(botUIToText(ui));
}

/** "Proposed event: Pizza party, Wed, Oct 28, 3:00 – 4:00 PM, the Commons" for text clients and later turns. */
export function eventProposalText(event: CalendarEventDraft): string {
    return [
        `Proposed calendar event: ${event.title}`,
        formatEventTime(event),
        event.location,
        event.notes,
    ]
        .filter(Boolean)
        .join('\n');
}

/** The event's day and times in its time zone, e.g. "Wed, Oct 28, 3:00 – 4:00 PM". */
export function formatEventTime(event: CalendarEventDraft): string {
    const timeZone = event.timeZone || undefined;
    const day = (seconds: number) =>
        new Date(seconds * 1000).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone,
        });
    const time = (seconds: number) =>
        new Date(seconds * 1000).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone,
        });
    if (event.allDay) {
        const last = Math.max(event.start, event.end - 1);
        return day(last) === day(event.start)
            ? `${day(event.start)}, all day`
            : `${day(event.start)} – ${day(last)}, all day`;
    }
    if (day(event.end) !== day(event.start))
        return `${day(event.start)}, ${time(event.start)} – ${day(event.end)}, ${time(event.end)}`;
    return `${day(event.start)}, ${time(event.start)} – ${time(event.end)}`;
}
