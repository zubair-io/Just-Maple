import type { ReplyChannel, ReplyDraftParams } from '../schemas/reply-draft';

/**
 * The link that opens a drafted reply as a prefilled compose in Messages or Mail, on
 * whichever Mac or iPhone the owner taps it. Nothing is sent: the person presses send.
 *
 * - Messages: `sms:<address>&body=…` (the form iOS and macOS Messages read a body from);
 *   a group: `sms:/open?addresses=<a>,<b>&body=…`.
 * - Mail: `mailto:<address>?subject=…&body=…`, lines ending in CRLF (RFC 6068).
 *
 * Mail can't thread it with In-Reply-To: the Mac doesn't upload Message-ID headers, and
 * Mail ignores that header in mailto links. The "Re:" subject keeps it together.
 */
export function replyComposeUrl(
    params: Pick<ReplyDraftParams, 'channel' | 'recipients' | 'subject'>,
    body: string,
): string {
    const addresses = params.recipients.map((r) => r.address.trim()).filter(Boolean);
    if (params.channel === 'mail') {
        const query = [
            ...(params.subject ? [`subject=${encodeURIComponent(params.subject)}`] : []),
            `body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`,
        ].join('&');
        return `mailto:${addresses.map(encodeAddress).join(',')}?${query}`;
    }
    const text = `body=${encodeURIComponent(body)}`;
    if (addresses.length === 1) return `sms:${encodeAddress(addresses[0]!)}&${text}`;
    return `sms:/open?addresses=${addresses.map(encodeAddress).join(',')}&${text}`;
}

/** Keeps "+", "@" and "." readable; escapes anything that could start a new parameter. */
function encodeAddress(address: string): string {
    return encodeURIComponent(address).replace(/%2B/g, '+').replace(/%40/g, '@');
}

/** "Messages" or "Mail", for buttons ("Open in Messages"). */
export function replyChannelName(channel: ReplyChannel): string {
    return channel === 'mail' ? 'Mail' : 'Messages';
}
