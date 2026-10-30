import type { MacDataItem } from '../schemas/mac-data';

/** Match complete email addresses/phone numbers; never merge people by a suffix or fuzzy name. */
export function normalizePersonHandle(raw: string | undefined): string | null {
    if (!raw) return null;
    const angle = raw.match(/<([^>]+)>/);
    const text = (angle ? angle[1]! : raw)
        .trim()
        .toLowerCase()
        .replace(/^mailto:/, '');
    if (text.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
    // Display names with digits are not phone numbers.
    if (!/^[+\d\s().-]+$/.test(text)) return null;
    const digits = text.replace(/\D/g, '');
    if (digits.length < 7) return null;
    return `+${digits.length === 10 ? `1${digits}` : digits}`;
}

export interface MessageSender {
    name: string;
    handle?: string;
    contactId?: string;
    ambiguous?: boolean;
}
export interface ContactIdentityIndex {
    byHandle: Map<string, MessageSender | null>;
    byName: Map<string, MessageSender | null>;
    me?: MessageSender;
}
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
function unique(map: Map<string, MessageSender | null>, key: string, sender: MessageSender) {
    if (!map.has(key)) map.set(key, sender);
    else if (map.get(key)?.contactId !== sender.contactId) map.set(key, null);
}
export function contactIdentityIndex(contacts: MacDataItem[]): ContactIdentityIndex {
    const index: ContactIdentityIndex = { byHandle: new Map(), byName: new Map() };
    const meCards: MessageSender[] = [];
    for (const card of contacts) {
        if (card.source !== 'contacts' || !card.title?.trim()) continue;
        const sender = { name: card.title.trim(), contactId: card.id };
        unique(index.byName, nameKey(sender.name), sender);
        if (card.extra?.['isMe'] === true) meCards.push(sender);
        for (const field of ['phones', 'emails']) {
            const entries = card.extra?.[field];
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
                const value =
                    typeof entry === 'string'
                        ? entry
                        : typeof entry?.value === 'string'
                          ? entry.value
                          : undefined;
                const handle = normalizePersonHandle(value);
                if (handle) unique(index.byHandle, handle, { ...sender, handle });
            }
        }
    }
    if (meCards.length === 1) index.me = meCards[0];
    return index;
}

/** Only pass contacts this reader may see. Group participants are never treated as the author. */
export function resolveMessageSender(
    item: MacDataItem,
    index: ContactIdentityIndex,
): MessageSender | null {
    if (item.source !== 'imessage' && item.source !== 'mail') return null;
    if (item.isFromMe)
        return { name: 'Me', ...(index.me?.contactId ? { contactId: index.me.contactId } : {}) };
    const raw =
        typeof item.extra?.['senderHandle'] === 'string' ? item.extra['senderHandle'] : undefined;
    let handle = normalizePersonHandle(raw) ?? normalizePersonHandle(item.sender);
    // Older direct messages kept the handle in participants while replacing sender with its name.
    if (!handle && item.source === 'imessage' && item.participants.length === 1)
        handle = normalizePersonHandle(item.participants[0]);
    const match = handle ? index.byHandle.get(handle) : undefined;
    if (match) return { ...match, handle: handle! };
    const original = item.sender?.trim();
    const named =
        original
            ?.match(/^(.*?)\s*<[^>]+>\s*$/)?.[1]
            ?.trim()
            .replace(/^"|"$/g, '') || original;
    // Legacy group messages may have only an exact contact name. Ambiguous names stay unlinked.
    if (!handle && item.source === 'imessage' && named) {
        const byName = index.byName.get(nameKey(named));
        if (byName) return byName;
    }
    return named || handle
        ? {
              name: named || handle!,
              ...(handle ? { handle } : {}),
              ...((handle && index.byHandle.get(handle) === null) ||
              (!handle && named && index.byName.get(nameKey(named)) === null)
                  ? { ambiguous: true }
                  : {}),
          }
        : null;
}

/** A response-only enrichment; it never changes raw sender/participants or stored items. */
export function withMessageSenderNames(
    items: MacDataItem[],
    contacts: MacDataItem[],
): MacDataItem[] {
    const index = contactIdentityIndex(contacts);
    return items.map((item) => {
        const sender = resolveMessageSender(item, index);
        if (!sender) return item;
        const { senderName: _oldName, senderContactId: _oldContact, ...raw } = item;
        return {
            ...raw,
            senderName: sender.name,
            ...(sender.contactId ? { senderContactId: sender.contactId } : {}),
        };
    });
}
