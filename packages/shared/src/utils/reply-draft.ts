import type { ReplyChannel, ReplyDraftParams } from '../schemas/reply-draft';

/**
 * The link that opens a drafted reply as a prefilled compose in Messages or Mail, on
 * whichever Mac or iPhone the owner taps it. Nothing is sent: the person presses send.
 *
 * - Messages, one person: `sms:<address>&body=…`. iOS reads the body from this form;
 *   macOS Messages may open the conversation without the text (not verified on a
 *   device), which is why the card also has Copy.
 * - Messages, a group: `sms:/open?addresses=<a>,<b>&body=…`, an iOS form. Addresses are
 *   fully encoded there ("+" would read as a space in a query).
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
        return `mailto:${addresses.map(encodePathAddress).join(',')}?${query}`;
    }
    const text = `body=${encodeURIComponent(body)}`;
    if (addresses.length === 1) return `sms:${encodePathAddress(addresses[0]!)}&${text}`;
    return `sms:/open?addresses=${addresses.map(encodeURIComponent).join(',')}&${text}`;
}

/**
 * An address before the "?" or "&": keeps "+" and "@" readable (they mean themselves
 * there) and escapes anything that could start a new parameter.
 */
function encodePathAddress(address: string): string {
    return encodeURIComponent(address).replace(/%2B/g, '+').replace(/%40/g, '@');
}

/** "Messages" or "Mail", for buttons ("Open in Messages"). */
export function replyChannelName(channel: ReplyChannel): string {
    return channel === 'mail' ? 'Mail' : 'Messages';
}
