import type { MacDataItem } from '../schemas/mac-data';

/**
 * Whether an email is the user's own, by address: their account email plus the email
 * addresses on their own contact card ("me", `extra.isMe`). Mail items carry no
 * "from me" flag, and mailbox names ("Sent", "Sent Messages", "Gesendet") vary by
 * account and language, so the address decides. Kept small and standalone so other
 * features that need "did the user write this?" can share it.
 */

/** "Jen Park <jen@example.com>", "<jen@example.com>" or "jen@example.com" → "jen@example.com". */
export function emailAddressOf(value: string | undefined | null): string | null {
    if (!value) return null;
    const bracketed = /<([^<>]+)>\s*$/.exec(value);
    const address = (bracketed ? bracketed[1]! : value)
        .trim()
        .replace(/^mailto:/i, '')
        .toLowerCase();
    return /^[^\s@,;?&#/<>"]{1,64}@[^\s@,;?&#/<>"]{1,255}$/.test(address) ? address : null;
}

/** The user's own email addresses, lowercased, from their account and "me" card. */
export function ownEmailAddresses(input: {
    accountEmail?: string | null;
    meCard?: MacDataItem | null;
}): string[] {
    const found = new Set<string>();
    const add = (value: unknown) => {
        const address = typeof value === 'string' ? emailAddressOf(value) : null;
        if (address) found.add(address);
    };
    add(input.accountEmail);
    const emails = input.meCard?.extra?.['emails'];
    if (Array.isArray(emails))
        for (const entry of emails)
            add(typeof entry === 'string' ? entry : (entry as { value?: unknown })?.value);
    return [...found];
}

/**
 * The user sent this email: its sender is one of their addresses. With no known
 * addresses, falls back to the mailbox name, which is only a guess.
 */
export function isMailFromMe(
    item: Pick<MacDataItem, 'sender' | 'mailbox'>,
    own: string[],
): boolean {
    if (own.length) {
        const sender = emailAddressOf(item.sender);
        return !!sender && own.includes(sender);
    }
    return /\bsent\b|^sent/i.test(item.mailbox ?? '');
}
