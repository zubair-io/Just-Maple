/** Isolated, read-only reader for message-archive/messages.db. No API credentials. */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
    MESSAGE_PLATFORM_NAMES,
    archiveTimestamp,
    normalizePersonHandle,
    type MacDataItem,
} from '@maple/shared';

interface Person {
    id: number;
    name: string;
    kind: string;
}
interface Identity {
    person_id: number;
    platform: string;
    handle: string;
}
interface Row {
    id: number;
    thread_id: number;
    source: string;
    platform: string;
    ts_raw: string;
    ts_iso: string;
    sender_handle: string;
    person_id: number | null;
    is_me: number;
    text: string;
    has_attachment: number;
    dedup: string;
    ext_key: string;
    title: string;
    is_group: number;
    is_junk: number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const [path, input] = process.argv.slice(2);
const options = JSON.parse(input!) as {
    op: 'preview' | 'batch';
    dataset?: string;
    timeZone?: string;
    cursor?: number;
};
const db = new Database(path!, { readonly: true });
db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
const required: Record<string, string[]> = {
    messages: [
        'id',
        'thread_id',
        'platform',
        'source',
        'ts_raw',
        'ts_iso',
        'sender_handle',
        'person_id',
        'is_me',
        'text',
        'has_attachment',
        'dedup',
    ],
    threads: ['id', 'ext_key', 'title', 'is_group', 'is_junk'],
    people: ['id', 'name', 'kind'],
    identities: ['person_id', 'platform', 'handle'],
    thread_members: ['thread_id', 'person_id'],
};
for (const [table, columns] of Object.entries(required)) {
    const definition = db
        .query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { sql: string } | null;
    if (!definition || !/^CREATE\s+TABLE\b/i.test(definition.sql))
        throw new Error('Unsupported archive schema');
    const present = new Set(
        (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
            (row) => row.name,
        ),
    );
    if (columns.some((column) => !present.has(column)))
        throw new Error('Unsupported archive schema');
}
if (options.op === 'preview') {
    const integrity = db.query('PRAGMA quick_check').get() as { quick_check: string };
    if (integrity.quick_check !== 'ok') throw new Error('Archive integrity check failed');
    const invalid = db
        .query(
            `SELECT count(*) AS n FROM messages m LEFT JOIN threads t ON t.id=m.thread_id
        WHERE t.id IS NULL OR m.id<1 OR m.dedup IS NULL OR m.dedup=''`,
        )
        .get() as { n: number };
    if (invalid.n) throw new Error('Archive has invalid message references');
    const totals = db
        .query("SELECT count(*) AS total,sum(ts_iso IS NULL OR ts_iso='') AS undated FROM messages")
        .get() as { total: number; undated: number };
    if (totals.total > 2_000_000) throw new Error('Archive exceeds two million records');
    console.log(
        JSON.stringify({
            ...totals,
            people: (db.query('SELECT count(*) AS n FROM people').get() as { n: number }).n,
            groups: (
                db.query('SELECT count(*) AS n FROM threads WHERE is_group=1').get() as {
                    n: number;
                }
            ).n,
            platforms: db
                .query(
                    'SELECT platform,count(*) AS count FROM messages GROUP BY platform ORDER BY count DESC',
                )
                .all(),
        }),
    );
} else {
    const dataset = options.dataset!;
    if (!/^[a-z0-9-]{1,64}$/.test(dataset)) throw new Error('Invalid dataset name');
    const people = new Map(
        (db.query('SELECT id,name,kind FROM people').all() as Person[]).map((person) => [
            person.id,
            person,
        ]),
    );
    const aliases = new Map<number, string[]>();
    for (const identity of db
        .query('SELECT person_id,platform,handle FROM identities')
        .all() as Identity[]) {
        // Numeric Facebook/AIM usernames are not phone numbers.
        if (
            !['imessage', 'sms', 'voice'].includes(identity.platform) &&
            !identity.handle?.includes('@')
        )
            continue;
        const value = normalizePersonHandle(identity.handle);
        if (value)
            aliases.set(identity.person_id, [...(aliases.get(identity.person_id) ?? []), value]);
    }
    const member = (id: number) => {
        const person = people.get(id);
        return person
            ? {
                  key: `archive:${dataset}:person:${id}`,
                  name: person.name,
                  handles: [...new Set(aliases.get(id) ?? [])],
                  self: person.kind === 'self',
              }
            : null;
    };
    const membership = new Map<number, NonNullable<ReturnType<typeof member>>[]>();
    for (const row of db.query('SELECT thread_id,person_id FROM thread_members').all() as {
        thread_id: number;
        person_id: number;
    }[]) {
        const person = member(row.person_id);
        if (person && !person.self)
            membership.set(row.thread_id, [...(membership.get(row.thread_id) ?? []), person]);
    }
    const rows = db
        .query(
            `SELECT m.*,t.ext_key,t.title,t.is_group,t.is_junk FROM messages m
        JOIN threads t ON t.id=m.thread_id WHERE m.id>? ORDER BY m.id LIMIT 500`,
        )
        .all(options.cursor ?? 0) as Row[];
    const items: MacDataItem[] = rows.map((row) => {
        const members = membership.get(row.thread_id) ?? [];
        const author = row.person_id ? people.get(row.person_id) : undefined;
        const chatId = `archive:${dataset}:${hash(JSON.stringify([row.source, row.platform, row.ext_key]))}`;
        const body = String(row.text ?? '').slice(0, 20_000);
        const occurredAt = archiveTimestamp(row.ts_iso ?? '', options.timeZone!);
        const participants = members.flatMap((person) =>
            person.handles.length ? person.handles : [person.name],
        );
        const peerTokens =
            row.platform === 'imessage'
                ? row.ext_key
                      .replace(/^imsg:/, '')
                      .replace(/\(sms[a-z]+\)/gi, '')
                      .split(',')
                : [];
        const normalizedPeers = peerTokens.map(normalizePersonHandle);
        const rawPeers = normalizedPeers.every((value) => !!value)
            ? (normalizedPeers as string[])
            : [];
        const item: MacDataItem = {
            id: `archive:${dataset}:${hash(JSON.stringify([row.source, row.platform, row.ext_key, row.dedup]))}`,
            source: 'imessage',
            mailbox: MESSAGE_PLATFORM_NAMES[row.platform] || row.platform,
            revision: '',
            occurredAt,
            title: row.title || 'Conversation',
            thread: row.title || 'Conversation',
            sender: row.is_me ? 'Me' : author?.name || row.sender_handle || 'Unknown sender',
            isFromMe: !!row.is_me,
            participants,
            body,
            extra: {
                chatId,
                historyBackfill: true,
                archivePlatform: row.platform,
                archiveDataset: dataset,
                archiveMessageId: row.id,
                archiveTimestamp: row.ts_raw || row.ts_iso || '',
                archiveTimeZone: options.timeZone!,
                timestampUnknown: occurredAt === 0,
                archiveIsGroup: !!row.is_group,
                archiveAutomated: !!row.is_junk,
                archiveMembers: members,
                archiveSenderHandle: row.sender_handle ?? '',
                archivePeerHandles: rawPeers,
                archiveAttachment: !!row.has_attachment,
                archiveTruncated: String(row.text ?? '').length > 20_000,
                ...((['imessage', 'sms', 'voice'].includes(row.platform) ||
                    row.sender_handle?.includes('@')) &&
                normalizePersonHandle(row.sender_handle)
                    ? { senderHandle: row.sender_handle }
                    : {}),
            },
        };
        item.revision = `archive-v1:${hash(JSON.stringify(item))}`;
        return item;
    });
    console.log(
        JSON.stringify({
            items,
            cursor: rows.at(-1)?.id ?? options.cursor ?? 0,
            rows: rows.length,
            done: rows.length < 500,
        }),
    );
}
db.close();
