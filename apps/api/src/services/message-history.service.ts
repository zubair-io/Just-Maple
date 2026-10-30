import {
    contactIdentityIndex,
    deviceItemThreadKey,
    messagePlatform,
    normalizePersonHandle,
    withMessageSenderNames,
    type MacDataItem,
    type MessageConversation,
    type MessageDirectory,
    type MessageHistoryQuery,
    type MessageHistoryPage,
    type DeviceDataAccess,
} from '@maple/shared';
import { findPageById } from '../repositories/page.repo';
import { findDeviceItemsByIds } from '../repositories/device-item.repo';
import {
    messageMetadata,
    matchingMessageIds,
    messagePreviews,
} from '../repositories/message-history.repo';
import {
    describeAccess,
    itemMatcherFor,
    loadDataPageView,
    visibleMessageContacts,
} from './device-data-access.service';

export class MessageHistoryAccessError extends Error {
    constructor(
        readonly status: number,
        readonly access?: DeviceDataAccess,
    ) {
        super(
            status === 403 ? 'Only the owner can see these messages.' : 'Message page not found.',
        );
    }
}
interface Person {
    key: string;
    name: string;
    handles: string[];
}
const parsedMemberships = new WeakMap<object, Person[]>();
function archiveMembers(item: MacDataItem): Person[] {
    const raw = item.extra?.['archiveMembers'];
    if (!Array.isArray(raw)) return [];
    const cached = parsedMemberships.get(raw);
    if (cached) return cached;
    const members: Person[] = raw.flatMap((value) =>
        value &&
        typeof value === 'object' &&
        typeof value.key === 'string' &&
        typeof value.name === 'string'
            ? [
                  {
                      key: value.key,
                      name: value.name,
                      handles: Array.isArray(value.handles)
                          ? value.handles.filter((h: unknown): h is string => typeof h === 'string')
                          : [],
                  },
              ]
            : [],
    );
    parsedMemberships.set(raw, members);
    return members;
}

async function scope(viewer: string, pageId?: string) {
    if (!pageId)
        return {
            ownerId: viewer,
            access: undefined,
            match: (item: MacDataItem) => item.source === 'imessage',
            contacts: await visibleMessageContacts(viewer, viewer),
        };
    const page = await findPageById(pageId, viewer);
    const view = page ? await loadDataPageView(page, viewer) : null;
    if (!view || view.source !== 'imessage') throw new MessageHistoryAccessError(404);
    const access = await describeAccess(view);
    if (!view.visible) throw new MessageHistoryAccessError(403, access);
    return {
        ownerId: view.ownerId,
        access,
        match: (await itemMatcherFor(view)) ?? (() => false),
        contacts: await visibleMessageContacts(view.ownerId, viewer, page?.notebookId),
    };
}

/** Only archive memberships carried by currently visible messages enter this index. */
export function groupMessageMetadata(items: MacDataItem[], contacts: MacDataItem[]) {
    const names = contactIdentityIndex(contacts);
    const people = new Map<string, Person>();
    const aliases = new Map<string, string | null>();
    const seenMemberships = new Set<object>();
    for (const item of items) {
        const raw = item.extra?.['archiveMembers'];
        if (!Array.isArray(raw) || seenMemberships.has(raw)) continue;
        seenMemberships.add(raw);
        for (const member of archiveMembers(item)) {
            people.set(member.key, member);
            for (const handle of member.handles) {
                const key = normalizePersonHandle(handle);
                if (!key) continue;
                if (!aliases.has(key)) aliases.set(key, member.key);
                else if (aliases.get(key) !== member.key) aliases.set(key, null);
            }
        }
    }
    const personNames = new Map<string, string>();
    const personName = (person: Person) => {
        const cached = personNames.get(person.key);
        if (cached) return cached;
        const matches = person.handles
            .filter((handle) => aliases.get(handle) === person.key)
            .map((handle) => names.byHandle.get(handle))
            .filter((value) => !!value);
        const name =
            matches.length && new Set(matches.map((value) => value!.contactId)).size === 1
                ? matches[0]!.name
                : person.name;
        personNames.set(person.key, name);
        return name;
    };
    type Summary = { key: string; name: string; kind: MessageConversation['kind'] };
    const patterns = new WeakMap<object, Summary>();
    const classify = (item: MacDataItem): Summary => {
        const cached = item.extra && patterns.get(item.extra);
        if (cached) return cached;
        const members = archiveMembers(item);
        const handles = [
            ...new Set(
                item.participants
                    .map(normalizePersonHandle)
                    .filter((value): value is string => !!value),
            ),
        ];
        const imported = typeof item.extra?.['archiveDataset'] === 'string';
        const group = imported
            ? item.extra?.['archiveIsGroup'] === true
            : item.participants.length > 1;
        let key = `${group ? 'group' : 'conversation'}:${deviceItemThreadKey(item) ?? item.id}`;
        let name = item.thread || item.title || 'Conversation';
        let kind: MessageConversation['kind'] = group ? 'group' : 'conversation';
        if (!group) {
            const peer =
                imported && members.length === 1
                    ? members[0]
                    : handles.length === 1
                      ? people.get(aliases.get(handles[0]!) ?? '')
                      : undefined;
            const handle = handles.length === 1 ? handles[0]! : undefined;
            const contact = handle ? names.byHandle.get(handle) : undefined;
            if (peer) {
                key = `person:${peer.key}`;
                name = personName(peer);
                kind = 'person';
            } else if (handle) {
                key = `person:${contact?.contactId ?? handle}`;
                name = contact?.name || name || handle;
                kind = 'person';
            }
        }
        const summary = { key, name, kind };
        if (item.extra) patterns.set(item.extra, summary);
        return summary;
    };
    const groups = new Map<
        string,
        { name: string; kind: MessageConversation['kind']; items: MacDataItem[] }
    >();
    for (const item of items) {
        const summary = classify(item);
        const previous = groups.get(summary.key);
        if (previous) previous.items.push(item);
        else groups.set(summary.key, { name: summary.name, kind: summary.kind, items: [item] });
    }
    return groups;
}

async function history(viewer: string, query: MessageHistoryQuery) {
    const access = await scope(viewer, query.pageId);
    const base = (await messageMetadata(access.ownerId)).filter(access.match);
    const grouped = groupMessageMetadata(base, access.contacts);
    const matches = await matchingMessageIds(access.ownerId, query.search ?? '');
    const filter = (item: MacDataItem) =>
        (!query.platform || messagePlatform(item) === query.platform) &&
        (query.includeAutomated || item.extra?.['archiveAutomated'] !== true) &&
        (query.from === undefined || (item.occurredAt > 0 && item.occurredAt >= query.from)) &&
        (query.to === undefined || (item.occurredAt > 0 && item.occurredAt <= query.to));
    const filtered = new Map(
        [...grouped].map(([key, group]) => [key, { ...group, items: group.items.filter(filter) }]),
    );
    return { ...access, base, grouped: filtered, matches };
}

export async function messageDirectory(
    viewer: string,
    query: MessageHistoryQuery,
): Promise<MessageDirectory> {
    const data = await history(viewer, query);
    const summaries: MessageConversation[] = [];
    const latestIds: string[] = [];
    for (const [key, group] of data.grouped) {
        const matching = data.matches
            ? group.items.filter((item) => data.matches!.has(item.id))
            : group.items;
        if (!matching.length) continue;
        const latest = matching.reduce((a, b) =>
            b.occurredAt > a.occurredAt || (b.occurredAt === a.occurredAt && b.id > a.id) ? b : a,
        );
        latestIds.push(latest.id);
        summaries.push({
            key,
            name: group.name,
            kind: group.kind,
            count: group.items.length,
            matches: matching.length,
            platforms: [...new Set(group.items.map(messagePlatform))].sort(),
            latestAt: latest.occurredAt,
            preview: latest.id,
        });
    }
    const previews = await messagePreviews(data.ownerId, latestIds);
    for (const summary of summaries) {
        const current = previews.get(summary.preview);
        summary.preview = current && data.match(current) ? current.body : '';
    }
    summaries.sort((a, b) => b.latestAt - a.latestAt || a.name.localeCompare(b.name));
    return {
        conversations: summaries,
        platforms: [...new Set(data.base.map(messagePlatform))].sort(),
        total: summaries.reduce((n, row) => n + row.matches, 0),
        ...(data.access ? { access: data.access } : {}),
    };
}

export async function messageHistoryPage(
    viewer: string,
    query: MessageHistoryQuery,
): Promise<MessageHistoryPage> {
    const data = await history(viewer, query);
    const group = data.grouped.get(query.conversation ?? '');
    const rows = (group?.items ?? [])
        .filter((item) => !data.matches || data.matches.has(item.id))
        .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
    let offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(200, Math.max(1, query.limit ?? 100));
    if (query.before) {
        const at = rows.findIndex((item) => item.id === query.before);
        if (at < 0) return { items: [], total: rows.length, offset: rows.length };
        offset = at + 1;
    }
    if (query.around) {
        const at = rows.findIndex((item) => item.id === query.around);
        if (at >= 0) offset = Math.max(0, at - Math.floor(limit / 2));
    }
    const ids = rows.slice(offset, offset + limit).map((item) => item.id);
    const byId = new Map(
        (await findDeviceItemsByIds(data.ownerId, ids)).map((item) => [item.id, item]),
    );
    const items = ids
        .map((id) => byId.get(id))
        .filter((item): item is MacDataItem => !!item && data.match(item))
        .reverse();
    return { items: withMessageSenderNames(items, data.contacts), total: rows.length, offset };
}
