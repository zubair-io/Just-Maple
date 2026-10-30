import type { MacDataItem } from '@maple/shared';
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { Binary, BSONRegExp, ObjectId } from 'bson';
import { Query, aggregate, find, update as applyUpdate } from 'mingo';
import type { AnyObject, Criteria, Options } from 'mingo/types';
import { clone, decode, encode, indexValue, joinBlobs, scalar, splitBlobs } from './codec';
import { createSearchStore } from './search-store';

const path = process.argv[2];
if (!path) throw new Error('SQLite database path is required');
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new Database(path, { create: true, strict: true });
if (path !== ':memory:') chmodSync(path, 0o600);
db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
);
db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_collections(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS document_indexes(collection_name TEXT NOT NULL REFERENCES document_collections(name) ON DELETE CASCADE,
    name TEXT NOT NULL, definition TEXT NOT NULL, sql_name TEXT NOT NULL UNIQUE, PRIMARY KEY(collection_name,name));
CREATE TABLE IF NOT EXISTS document_blobs(collection_name TEXT NOT NULL REFERENCES document_collections(name) ON DELETE CASCADE,
    document_id TEXT NOT NULL, path TEXT NOT NULL, bytes BLOB NOT NULL, subtype INTEGER NOT NULL,
    PRIMARY KEY(collection_name,document_id,path));
INSERT OR IGNORE INTO schema_migrations VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS search_documents(
    row_id INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, item_id TEXT NOT NULL,
    source TEXT NOT NULL, revision TEXT NOT NULL, occurred_at REAL NOT NULL,
    title TEXT NOT NULL, metadata TEXT NOT NULL, body TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS search_documents_scope ON search_documents(user_id,source,occurred_at);
CREATE VIRTUAL TABLE IF NOT EXISTS device_search_fts USING fts5(title,metadata,body,
    content='search_documents',content_rowid='row_id',tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN
    INSERT INTO device_search_fts(rowid,title,metadata,body) VALUES(new.row_id,new.title,new.metadata,new.body); END;
CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN
    INSERT INTO device_search_fts(device_search_fts,rowid,title,metadata,body) VALUES('delete',old.row_id,old.title,old.metadata,old.body); END;
CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON search_documents BEGIN
    INSERT INTO device_search_fts(device_search_fts,rowid,title,metadata,body) VALUES('delete',old.row_id,old.title,old.metadata,old.body);
    INSERT INTO device_search_fts(rowid,title,metadata,body) VALUES(new.row_id,new.title,new.metadata,new.body); END;
CREATE TABLE IF NOT EXISTS embedding_jobs(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, revision TEXT NOT NULL, content_hash TEXT NOT NULL,
    generation TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
-- A reverse scan gives retry_at ASC,rowid DESC without sorting the backfill queue.
CREATE INDEX IF NOT EXISTS embedding_jobs_ready ON embedding_jobs(retry_at DESC);
CREATE TABLE IF NOT EXISTS search_embeddings(
    id TEXT NOT NULL REFERENCES search_documents(id) ON DELETE CASCADE, chunk INTEGER NOT NULL,
    user_id TEXT NOT NULL, revision TEXT NOT NULL, content_hash TEXT NOT NULL,
    generation TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL,
    PRIMARY KEY(id,chunk,generation)
);
CREATE INDEX IF NOT EXISTS search_embeddings_owner ON search_embeddings(user_id,generation);
CREATE INDEX IF NOT EXISTS search_embeddings_scan ON search_embeddings(user_id,generation,id,chunk);
INSERT OR IGNORE INTO schema_migrations VALUES(2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`);

const GENERATION = 'bge-m3-5617a9f-cls-l2-512-v1';
const searchStore = createSearchStore(db);
db.transaction(() => {
    if (db.query('SELECT 1 FROM schema_migrations WHERE version=4').get()) return;
    db.exec("ALTER TABLE search_documents ADD COLUMN item_metadata TEXT NOT NULL DEFAULT '{}'");
    if (
        db
            .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='docs_device_items'")
            .get()
    ) {
        db.exec(`UPDATE search_documents SET item_metadata=COALESCE((SELECT json_remove(json_extract(index_data,'$.item'),'$.body')
            FROM docs_device_items WHERE _id='s:'||search_documents.id),'{}')`);
    }
    db.query("INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
}).immediate();
const queryOptions: Partial<Options> = { scriptEnabled: false, useStrictMode: true };
const scalarFields = new Set([
    '_id',
    'id',
    'userId',
    'createdBy',
    'notebookId',
    'pageId',
    'noteId',
    'threadId',
    'deviceId',
    'source',
    'revision',
    'occurredAt',
    'createdAt',
    'updatedAt',
    'expiresAt',
    'kind',
    'credentialId',
    'parentMessageId',
    'userBotId',
    'templateId',
    'handle',
    'domain',
    'date',
    'isTrashed',
    'isArchived',
    'isPublic',
    'isPublished',
    'slug',
    'publishedSlug',
    'status',
    'sentAt',
    'savedAt',
    'version',
    'state',
    'tokenHash',
    'jwtId',
]);
type Doc = Record<string, unknown>;
type Request = { id: number; operation: string; collection?: string; args: unknown[] };
type Stored = { _id: string; body: string };
type IndexDefinition = {
    key: Record<string, number>;
    name: string;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
};

function table(name: string): string {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Invalid collection name: ${name}`);
    return `"docs_${name}"`;
}
function literal(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}
function field(path: string): string {
    const jsonPath =
        '$.' +
        path
            .split('.')
            .map((part) => JSON.stringify(part))
            .join('.');
    return `json_extract(index_data,${literal(jsonPath)})`;
}
function ensureCollection(name: string): void {
    db.exec(
        `CREATE TABLE IF NOT EXISTS ${table(name)}(_id TEXT PRIMARY KEY NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),index_data TEXT NOT NULL CHECK(json_valid(index_data)))`,
    );
    db.query('INSERT OR IGNORE INTO document_collections(name) VALUES(?)').run(name);
}
function idKey(id: unknown): string {
    return typeof id === 'string'
        ? `s:${id}`
        : id instanceof ObjectId
          ? `o:${id.toHexString()}`
          : `v:${encode(id)}`;
}
function hydrate(name: string, row: Stored): Doc {
    const blobs = db
        .query(
            'SELECT path,bytes,subtype FROM document_blobs WHERE collection_name=? AND document_id=?',
        )
        .all(name, row._id) as Array<{ path: string; bytes: Uint8Array; subtype: number }>;
    return joinBlobs(
        row.body,
        blobs.map((blob) => ({ ...blob, path: JSON.parse(blob.path) as string[] })),
    );
}
function mongoRegex(value: unknown): unknown {
    if (value instanceof BSONRegExp) return new RegExp(value.pattern, value.options);
    if (Array.isArray(value)) return value.map(mongoRegex);
    if (value && Object.getPrototypeOf(value) === Object.prototype)
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, mongoRegex(item)]),
        );
    return value;
}
function query(filter: unknown): Query {
    return new Query(mongoRegex(filter) as Criteria<AnyObject>, queryOptions);
}

/** SQL candidate pruning is always a superset; Mingo applies the full typed predicate. */
function candidateWhere(filter: unknown): { sql: string; values: SQLQueryBindings[] } {
    if (!filter || typeof filter !== 'object') return { sql: '1', values: [] };
    const parts: string[] = [],
        values: SQLQueryBindings[] = [];
    for (const [key, value] of Object.entries(filter)) {
        if ((key === '$and' || key === '$or') && Array.isArray(value)) {
            const nested = value.map(candidateWhere);
            parts.push(
                '(' +
                    (nested
                        .map((part) => `(${part.sql})`)
                        .join(key === '$and' ? ' AND ' : ' OR ') || (key === '$and' ? '1' : '0')) +
                    ')',
            );
            values.push(...nested.flatMap((part) => part.values));
            continue;
        }
        if (!scalarFields.has(key)) continue;
        if (value instanceof Binary && key !== 'tokenHash') continue;
        // `state` is binary on collaborative documents; its null scalar is not indexed.
        const expression = key === '_id' ? '_id' : field(key);
        const simple =
            key === '_id' &&
            value !== null &&
            (typeof value === 'string' || value instanceof ObjectId)
                ? idKey(value)
                : scalar(value);
        if (value !== null && simple !== null) {
            parts.push(`${expression} = ?`);
            values.push(simple);
            continue;
        }
        if (value && Object.getPrototypeOf(value) === Object.prototype) {
            for (const [op, operand] of Object.entries(value)) {
                const bound =
                    key === '_id' && (typeof operand === 'string' || operand instanceof ObjectId)
                        ? idKey(operand)
                        : scalar(operand);
                if (['$gt', '$gte', '$lt', '$lte'].includes(op) && bound !== null) {
                    parts.push(
                        `${expression} ${{ $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op]} ?`,
                    );
                    values.push(bound);
                } else if (
                    op === '$in' &&
                    Array.isArray(operand) &&
                    operand.length &&
                    operand.every((v) => scalar(v) !== null)
                ) {
                    parts.push(`${expression} IN (${operand.map(() => '?').join(',')})`);
                    values.push(
                        ...operand.map((item) => (key === '_id' ? idKey(item) : scalar(item))),
                    );
                }
            }
        }
    }
    return { sql: parts.join(' AND ') || '1', values };
}
function documents(name: string, filter: unknown = {}): Doc[] {
    ensureCollection(name);
    const candidate = candidateWhere(filter);
    const rows = db
        .query(`SELECT _id,body FROM ${table(name)} WHERE ${candidate.sql}`)
        .all(...candidate.values) as Stored[];
    const predicate = query(filter);
    return rows.map((row) => hydrate(name, row)).filter((doc) => predicate.test(doc));
}
function syncSearch(doc: Doc): void {
    const item = doc.item as Doc | undefined;
    if (!item || typeof doc.userId !== 'string') return;
    const title = String(item.title ?? '');
    const metadata = [
        item.sender,
        item.location,
        item.calendar,
        ...(Array.isArray(item.participants) ? item.participants : []),
    ]
        .filter(Boolean)
        .join('\n');
    const body = String(item.body ?? '');
    const itemMetadata = JSON.stringify(indexValue({ ...item, body: undefined }));
    const hash = createHash('sha256').update([title, metadata, body].join('\n')).digest('hex');
    const id = String(doc._id),
        revision = String(doc.revision);
    const previous = db
        .query('SELECT revision,content_hash FROM search_documents WHERE id=?')
        .get(id) as { revision: string; content_hash: string } | null;
    if (previous?.revision === revision && previous.content_hash === hash) {
        db.query(
            'UPDATE search_documents SET item_metadata=?,occurred_at=?,source=? WHERE id=?',
        ).run(itemMetadata, Number(item.occurredAt), String(item.source), id);
        return;
    }
    searchStore.bump();
    db.query(
        `INSERT INTO search_documents(id,user_id,item_id,source,revision,occurred_at,title,metadata,body,content_hash,item_metadata)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,item_id=excluded.item_id,
        source=excluded.source,revision=excluded.revision,occurred_at=excluded.occurred_at,title=excluded.title,
        metadata=excluded.metadata,body=excluded.body,content_hash=excluded.content_hash,item_metadata=excluded.item_metadata`,
    ).run(
        id,
        doc.userId,
        String(item.id),
        String(item.source),
        revision,
        Number(item.occurredAt),
        title,
        metadata,
        body,
        hash,
        itemMetadata,
    );
    db.query('DELETE FROM search_embeddings WHERE id=?').run(id);
    db.query(
        `INSERT INTO embedding_jobs(id,user_id,revision,content_hash,generation) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,revision=excluded.revision,content_hash=excluded.content_hash,
        generation=excluded.generation,attempts=0,retry_at=0,lease_until=0,last_error=NULL`,
    ).run(id, doc.userId, revision, hash, GENERATION);
}
function persist(name: string, doc: Doc, insert = false): void {
    if (doc._id === undefined) doc._id = new ObjectId();
    const key = idKey(doc._id),
        packed = splitBlobs(doc);
    try {
        db.query(
            insert
                ? `INSERT INTO ${table(name)}(_id,body,index_data) VALUES(?,?,?)`
                : `INSERT INTO ${table(name)}(_id,body,index_data) VALUES(?,?,?) ON CONFLICT(_id) DO UPDATE SET body=excluded.body,index_data=excluded.index_data`,
        ).run(key, packed.body, packed.indexData);
    } catch (error) {
        if ((error as Error).message.includes('UNIQUE constraint failed'))
            throw Object.assign(new Error(`Duplicate key in ${name}`), { code: 11000 });
        throw error;
    }
    db.query('DELETE FROM document_blobs WHERE collection_name=? AND document_id=?').run(name, key);
    const writeBlob = db.query('INSERT INTO document_blobs VALUES(?,?,?,?,?)');
    for (const blob of packed.blobs)
        writeBlob.run(name, key, JSON.stringify(blob.path), blob.bytes, blob.subtype);
    if (name === 'device_items') syncSearch(doc);
}
function remove(name: string, doc: Doc): void {
    const key = idKey(doc._id);
    db.query(`DELETE FROM ${table(name)} WHERE _id=?`).run(key);
    db.query('DELETE FROM document_blobs WHERE collection_name=? AND document_id=?').run(name, key);
    if (name === 'device_items') {
        searchStore.bump();
        db.query('DELETE FROM embedding_jobs WHERE id=?').run(String(doc._id));
        db.query('DELETE FROM search_documents WHERE id=?').run(String(doc._id));
    }
}
function getPath(doc: unknown, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (value, key) => (value && typeof value === 'object' ? (value as Doc)[key] : undefined),
            doc,
        );
}
function setPath(doc: Doc, path: string, value: unknown): void {
    const keys = path.split('.');
    let parent = doc;
    for (const key of keys.slice(0, -1)) {
        if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
        parent = parent[key] as Doc;
    }
    parent[keys.at(-1)!] = value;
}
/** Resolve Mongo's plain positional $ from its matched array predicate. */
function resolvePositional(doc: Doc, filter: Doc, modifier: Doc): Doc {
    const result: Doc = {};
    for (const [operator, fields] of Object.entries(modifier)) {
        if (!fields || typeof fields !== 'object') throw new Error('Invalid update modifier');
        const rewritten: Doc = {};
        for (const [path, value] of Object.entries(fields)) {
            let resolved = path;
            if (path.includes('.$.')) {
                const [prefix, suffix] = path.split('.$.');
                const items = getPath(doc, prefix!) as unknown[];
                if (!Array.isArray(items)) throw new Error('Positional update requires an array');
                const criteria = Object.fromEntries(
                    Object.entries(filter)
                        .filter(([key]) => key.startsWith(prefix + '.'))
                        .map(([key, val]) => [key.slice(prefix!.length + 1), val]),
                );
                if (!Object.keys(criteria).length)
                    throw new Error('Positional update requires a matched array predicate');
                const index = items.findIndex((item) => query(criteria).test(item as AnyObject));
                if (index < 0) throw new Error('Positional update matched no array element');
                resolved = `${prefix}.${index}.${suffix}`;
            }
            rewritten[resolved] = value;
        }
        result[operator] = rewritten;
    }
    return result;
}
function updateRows(
    name: string,
    operation: string,
    filter: Doc,
    modifier: Doc,
    options: Doc = {},
): unknown {
    let matched = documents(name, filter);
    if (options.sort)
        matched = find(matched, {}, {}, queryOptions)
            .sort(options.sort as Record<string, 1 | -1>)
            .all();
    if (operation !== 'updateMany') matched = matched.slice(0, 1);
    let upserted: Doc | undefined,
        modifiedCount = 0;
    const before = matched[0] ? clone(matched[0]) : null;
    if (!matched.length && options.upsert) {
        upserted = {};
        for (const [key, val] of Object.entries(filter)) {
            if (
                !key.startsWith('$') &&
                (val === null ||
                    typeof val !== 'object' ||
                    val instanceof ObjectId ||
                    val instanceof Date)
            )
                setPath(upserted, key, val);
        }
        if (upserted._id === undefined)
            upserted._id = (modifier.$setOnInsert as Doc | undefined)?._id ?? new ObjectId();
        matched = [upserted];
    }
    for (const doc of matched) {
        const original = encode(doc);
        if (operation === 'replaceOne') {
            if (modifier._id !== undefined && idKey(modifier._id) !== idKey(doc._id))
                throw new Error('Cannot change immutable _id');
            const replacement = { ...modifier, _id: doc._id };
            persist(name, replacement, !!upserted);
            modifiedCount += Number(encode(replacement) !== original);
            continue;
        }
        const { $setOnInsert, ...updates } = modifier;
        if (upserted && $setOnInsert) {
            const { _id: insertId, ...insertFields } = $setOnInsert as Doc;
            if (insertId !== undefined && idKey(insertId) !== idKey(doc._id))
                throw new Error('Cannot change immutable _id');
            applyUpdate(doc, { $set: insertFields }, [], {}, { cloneMode: 'none', queryOptions });
        }
        if (updates.$set && Object.hasOwn(updates.$set as Doc, '_id')) {
            const { _id: setId, ...fields } = updates.$set as Doc;
            if (idKey(setId) !== idKey(doc._id)) throw new Error('Cannot change immutable _id');
            updates.$set = fields;
        }
        const resolved = resolvePositional(doc, filter, updates);
        applyUpdate(
            doc,
            resolved,
            options.arrayFilters as AnyObject[] | undefined,
            {},
            { cloneMode: 'none', queryOptions },
        );
        persist(name, doc, !!upserted);
        if (!upserted && original !== encode(doc)) modifiedCount++;
    }
    if (operation === 'findOneAndUpdate') {
        const selected = options.returnDocument === 'after' ? (matched[0] ?? null) : before;
        return selected && options.projection
            ? find([selected], {}, options.projection as Doc, queryOptions).next()
            : selected;
    }
    return {
        acknowledged: true,
        matchedCount: upserted ? 0 : matched.length,
        modifiedCount,
        upsertedCount: upserted ? 1 : 0,
        upsertedId: upserted?._id ?? null,
    };
}
function dropCollection(name: string): boolean {
    const exists = db.query('SELECT 1 FROM document_collections WHERE name=?').get(name);
    if (!exists) return false;
    for (const doc of documents(name)) remove(name, doc);
    db.exec(`DROP TABLE ${table(name)}`);
    db.query('DELETE FROM document_collections WHERE name=?').run(name);
    return true;
}
/** Keep the complete inputs to deviceItemMatchesFilter/homeItemVisibleToBots. */
function searchFilterItem(item: MacDataItem): MacDataItem {
    const extra = item.extra ?? {};
    return {
        id: item.id,
        source: item.source,
        revision: item.revision,
        occurredAt: item.occurredAt,
        body: '',
        participants: [],
        calendar: item.calendar,
        mailbox: item.mailbox,
        thread: item.thread,
        extra: Object.fromEntries(
            [
                'calendarId',
                'chatId',
                'entityId',
                'state',
                'deviceClass',
                'area',
                'placeId',
                'place',
                'lat',
                'lon',
            ]
                .filter((key) => extra[key] !== undefined)
                .map((key) => [key, extra[key]]),
        ),
    };
}

function operation(op: string, name: string | undefined, args: unknown[]): unknown {
    if (op === 'graph.relations') {
        ensureCollection('graph_relations');
        const [notebookId, statuses, limit, range] = args as [
            string,
            string[],
            number,
            { from?: number; to?: number } | undefined,
        ];
        if (!statuses.length) return [];
        const values: SQLQueryBindings[] = [notebookId, ...statuses];
        let dates = '';
        if (typeof range?.from === 'number') {
            dates += ` AND (${field('a')} LIKE 'item:%' OR ${field('b')} LIKE 'item:%' OR ${field('lastAt')} IS NULL OR ${field('lastAt')}>=?)`;
            values.push(range.from);
        }
        if (typeof range?.to === 'number') {
            dates += ` AND (${field('a')} LIKE 'item:%' OR ${field('b')} LIKE 'item:%' OR ${field('firstAt')} IS NULL OR ${field('firstAt')}<=?)`;
            values.push(range.to);
        }
        // Bound the read before decoding documents. The notebook/status index scopes it.
        const rows = db
            .query(
                `SELECT body FROM docs_graph_relations WHERE ${field('notebookId')}=?
            AND ${field('status')} IN (${statuses.map(() => '?').join(',')})${dates}
            ORDER BY ${field('updatedAt')} DESC LIMIT ?`,
            )
            .all(...values, Math.max(1, limit)) as { body: string }[];
        return rows.map((row) => decode(row.body));
    }
    if (op === 'device.graph' || op === 'device.graphItems') {
        ensureCollection('device_items');
        const owner = String(args[0]);
        const bodyChars = Math.max(
            0,
            Number(op === 'device.graph' ? (args[2] as { bodyChars: number }).bodyChars : args[2]),
        );
        let where: string;
        let suffix = '';
        let values: SQLQueryBindings[];
        if (op === 'device.graphItems') {
            const ids = (args[1] as string[]).slice(0, 500);
            if (!ids.length) return [];
            where = `_id IN (${ids.map(() => '?').join(',')}) AND ${field('userId')}=?`;
            values = [...ids.map((id) => idKey(`${owner}:${id}`)), owner];
        } else {
            const source = String(args[1]);
            const range = args[2] as {
                from?: number;
                to?: number;
                updatedSince?: Date;
                limit: number;
            };
            where = `${field('userId')}=? AND ${field('source')}=?`;
            values = [owner, source];
            for (const [key, comparison, bound] of [
                ['occurredAt', '>=', range.from],
                ['occurredAt', '<=', range.to],
                ['updatedAt', '>', range.updatedSince?.getTime()],
            ] as const) {
                if (typeof bound === 'number') {
                    where += ` AND ${field(key)}${comparison}?`;
                    values.push(bound);
                }
            }
            suffix = ` ORDER BY ${field('occurredAt')} DESC LIMIT ?`;
            values.push(Math.max(1, range.limit));
        }
        // Project and truncate in SQL: never decode vectors or full bodies just to discard them.
        const rows = db
            .query(
                `SELECT json_set(json_extract(index_data,'$.item'),'$.body',
            substr(COALESCE(json_extract(index_data,'$.item.body'),''),1,?)) AS item
            FROM docs_device_items ${op === 'device.graphItems' ? 'INDEXED BY sqlite_autoindex_docs_device_items_1' : ''} WHERE ${where}${suffix}`,
            )
            .all(bodyChars, ...values) as { item: string }[];
        return rows.map((row) => JSON.parse(row.item));
    }
    if (op === 'search.candidates') {
        const [owner, sources, from, to, after = 0] = args as [
            string,
            string[],
            number | undefined,
            number | undefined,
            number?,
        ];
        if (!sources.length) return [];
        const values: SQLQueryBindings[] = [after, owner, ...sources];
        let dates = '';
        if (typeof from === 'number' && Number.isFinite(from)) {
            dates += ' AND occurred_at>=?';
            values.push(from);
        }
        if (typeof to === 'number' && Number.isFinite(to)) {
            dates += ' AND occurred_at<=?';
            values.push(to);
        }
        const rows = db
            .query(
                `SELECT row_id AS cursor,id AS _id,user_id AS userId,source,revision,content_hash AS contentHash,item_metadata
            FROM search_documents NOT INDEXED WHERE row_id>? AND user_id=? AND source IN (${sources.map(() => '?').join(',')})${dates}
            ORDER BY row_id LIMIT 500`,
            )
            .all(...values) as Array<{
            _id: string;
            cursor: number;
            userId: string;
            source: string;
            revision: string;
            contentHash: string;
            item_metadata: string;
        }>;
        return rows.map(({ item_metadata, ...doc }) => ({
            ...doc,
            // Candidates need sharing-filter facts, not repeated archive contact
            // memberships or provenance. Hydrate full content only after ranking.
            item: searchFilterItem(JSON.parse(item_metadata) as MacDataItem),
        }));
    }
    if (op === 'device.deleteBatch') {
        ensureCollection('device_items');
        const filter = {
            userId: String(args[0]),
            ...(typeof args[1] === 'string' && args[1] ? { deviceId: args[1] } : {}),
            ...(typeof args[2] === 'string' && args[2] ? { source: args[2] } : {}),
        };
        const candidate = candidateWhere(filter);
        return db
            .transaction(() => {
                const rows = db
                    .query(`SELECT _id FROM docs_device_items WHERE ${candidate.sql} LIMIT 1000`)
                    .all(...candidate.values) as { _id: string }[];
                for (const row of rows) {
                    if (!row._id.startsWith('s:')) throw new Error('Invalid device item key');
                    remove('device_items', { _id: row._id.slice(2) });
                }
                return rows.length;
            })
            .immediate();
    }
    if (op === 'device.mailRetentionBatch') {
        ensureCollection('device_items');
        return (
            db
                .query(
                    `SELECT s.id AS _id,s.item_metadata FROM search_documents s JOIN docs_device_items d ON d._id='s:'||s.id
            WHERE s.user_id=? AND s.source='mail' AND s.id>? AND COALESCE(json_extract(d.index_data,'$.retainedContactMail'),0)!=1
            ORDER BY s.id LIMIT 500`,
                )
                .all(String(args[0]), String(args[1])) as { _id: string; item_metadata: string }[]
        ).map((row) => ({ _id: row._id, item: JSON.parse(row.item_metadata) }));
    }
    if (op === 'device.expired') {
        ensureCollection('device_items');
        return db
            .query(
                `SELECT s.id AS _id,s.item_id AS id,s.user_id AS userId,s.source,json_extract(d.index_data,'$.endAt') AS endAt
            FROM search_documents s JOIN docs_device_items d ON d._id='s:'||s.id
            WHERE s.source NOT IN ('contacts','imessage') AND s.occurred_at<?
                AND COALESCE(json_extract(d.index_data,'$.retainedContactMail'),0)!=1`,
            )
            .all(Number(args[0]));
    }
    if (op === 'device.counts') {
        ensureCollection('device_items');
        const device = typeof args[1] === 'string' && args[1] ? args[1] : undefined;
        const rows = db
            .query(
                `SELECT ${field('source')} AS source,count(*) AS n
            FROM docs_device_items WHERE ${field('userId')}=?
            ${device ? `AND ${field('deviceId')}=?` : ''} GROUP BY ${field('source')}`,
            )
            .all(...(device ? [String(args[0]), device] : [String(args[0])])) as {
            source: string;
            n: number;
        }[];
        return Object.fromEntries(rows.map((row) => [row.source, row.n]));
    }
    if (op === 'device.facets') {
        const rows = db
            .query(
                `SELECT source,max(occurred_at) AS occurredAt,calendar,mailbox,thread,calendarId,chatId FROM (
            SELECT source,occurred_at,json_extract(item_metadata,'$.calendar') AS calendar,
                json_extract(item_metadata,'$.mailbox') AS mailbox,json_extract(item_metadata,'$.thread') AS thread,
                json_extract(item_metadata,'$.extra.calendarId') AS calendarId,json_extract(item_metadata,'$.extra.chatId') AS chatId
            FROM search_documents WHERE user_id=? AND source IN ('calendar','mail','imessage'))
            GROUP BY source,calendar,mailbox,thread,calendarId,chatId`,
            )
            .all(String(args[0])) as {
            source: string;
            occurredAt: number;
            calendar: string | null;
            mailbox: string | null;
            thread: string | null;
            calendarId: string | null;
            chatId: string | null;
        }[];
        return rows.map(
            ({ source, occurredAt, calendar, mailbox, thread, calendarId, chatId }) => ({
                source,
                occurredAt,
                item: { calendar, mailbox, thread, extra: { calendarId, chatId } },
            }),
        );
    }
    if (op === 'messages.metadata' || op === 'messages.native') {
        const native = op === 'messages.native';
        const items: MacDataItem[] = [];
        const people = new Map<string, unknown>();
        const shapes: Omit<MacDataItem, 'id' | 'occurredAt'>[] = [];
        const shapeIndex = new Map<string, number>();
        const compact: [string, number, number][] = [];
        const rows = db
            .query(
                `SELECT item_metadata,${native ? 'body' : "'' AS body"} FROM search_documents WHERE user_id=? AND source='imessage' ${native ? "AND item_id LIKE 'imessage:%'" : ''}`,
            )
            .iterate(String(args[0]));
        for (const row of rows as Iterable<{ item_metadata: string; body: string }>) {
            const item = JSON.parse(row.item_metadata) as MacDataItem;
            if (native) {
                items.push({ ...item, body: row.body });
                continue;
            }
            const extra = item.extra ?? {};
            const memberKeys: string[] = [];
            if (Array.isArray(extra['archiveMembers']))
                for (const person of extra['archiveMembers']) {
                    if (person && typeof person === 'object' && typeof person.key === 'string') {
                        people.set(person.key, person);
                        memberKeys.push(person.key);
                    }
                }
            const shape = {
                source: 'imessage',
                revision: '',
                title: item.title,
                thread: item.thread,
                participants: item.participants,
                body: '',
                extra: {
                    chatId: extra['chatId'],
                    archiveDataset: extra['archiveDataset'],
                    archivePlatform: extra['archivePlatform'],
                    archiveIsGroup: extra['archiveIsGroup'],
                    archiveAutomated: extra['archiveAutomated'],
                    archiveMemberKeys: memberKeys,
                },
            } satisfies Omit<MacDataItem, 'id' | 'occurredAt'>;
            const key = JSON.stringify(shape);
            let index = shapeIndex.get(key);
            if (index === undefined) {
                index = shapes.length;
                shapes.push(shape);
                shapeIndex.set(key, index);
            }
            compact.push([item.id, item.occurredAt, index]);
        }
        // Intern repeated archive memberships to bound the cross-process payload and API memory.
        return native ? items : { rows: compact, shapes, people: [...people.values()] };
    }
    if (op === 'messages.previews') {
        const ids = (args[1] as string[]).slice(0, 500).map((id) => `${String(args[0])}:${id}`);
        if (!ids.length) return [];
        // The scope index otherwise scans the entire library for every preview batch.
        return db
            .query(
                `SELECT item_id AS id,substr(body,1,160) AS body,item_metadata AS metadata
            FROM search_documents INDEXED BY sqlite_autoindex_search_documents_1 WHERE user_id=? AND source='imessage' AND id IN (${ids.map(() => '?').join(',')})`,
            )
            .all(String(args[0]), ...ids);
    }
    if (op === 'messages.matching') {
        return (
            db
                .query(
                    `SELECT d.item_id FROM device_search_fts JOIN search_documents d ON d.row_id=device_search_fts.rowid
            WHERE d.user_id=? AND d.source='imessage' AND device_search_fts MATCH ?`,
                )
                .all(String(args[0]), String(args[1])) as { item_id: string }[]
        ).map((row) => row.item_id);
    }
    if (op.startsWith('search.')) return searchStore.run(op, args);
    if (op === 'ping') {
        db.query('SELECT 1').get();
        return { ok: 1, engine: 'sqlite' };
    }
    if (op === 'close') {
        db.close();
        return { ok: 1 };
    }
    if (op === 'sql') {
        const [sql, params = []] = args as [string, SQLQueryBindings[]];
        return db.query(sql).all(...params);
    }
    if (op === 'listCollections') {
        const filter = args[0] as { name?: string };
        return db
            .query('SELECT name FROM document_collections')
            .all()
            .filter((row) => !filter.name || (row as { name: string }).name === filter.name);
    }
    if (op === 'dropDatabase') {
        for (const { name: collection } of db
            .query('SELECT name FROM document_collections')
            .all() as Array<{ name: string }>)
            dropCollection(collection);
        return true;
    }
    if (!name) throw new Error('Collection is required');
    if (op === 'dropCollection') return dropCollection(name);
    ensureCollection(name);
    if (op === 'migration.scan') {
        const [offset, limit] = args as [number, number];
        return (
            db
                .query(`SELECT _id,body FROM ${table(name)} ORDER BY _id LIMIT ? OFFSET ?`)
                .all(limit, offset) as Stored[]
        ).map((row) => hydrate(name, row));
    }
    const filter = (args[0] ?? {}) as Doc;
    const modifier = (args[1] ?? {}) as Doc;
    const options = (args[2] ?? {}) as Doc;
    if (op === 'createCollection') return { name };
    if (op === 'find' || op === 'findOne') {
        const opts = modifier;
        let cursor = find(
            documents(name, filter),
            {},
            opts.projection as Doc | undefined,
            queryOptions,
        );
        if (opts.sort) cursor = cursor.sort(opts.sort as Record<string, 1 | -1>);
        if (opts.skip) cursor = cursor.skip(Number(opts.skip));
        if (opts.limit) cursor = cursor.limit(Math.abs(Number(opts.limit)));
        return op === 'findOne' ? (cursor.next() ?? null) : cursor.all();
    }
    if (op === 'aggregate') {
        const pipeline = args[0] as Doc[];
        return aggregate(documents(name, pipeline[0]?.$match ?? {}), pipeline, queryOptions);
    }
    if (op === 'countDocuments') return documents(name, filter).length;
    if (op === 'distinct') {
        const values = documents(name, modifier).flatMap((doc) => {
            const val = getPath(doc, args[0] as string);
            return Array.isArray(val) ? val : [val];
        });
        return [
            ...new Map(
                values
                    .filter((value) => value !== undefined)
                    .map((value) => [encode(value), value]),
            ).values(),
        ];
    }
    if (op === 'insertOne') {
        persist(name, filter, true);
        return { acknowledged: true, insertedId: filter._id };
    }
    if (op === 'insertMany') {
        const docs = args[0] as Doc[];
        const insertedIds: Doc = {};
        docs.forEach((doc, i) => {
            persist(name, doc, true);
            insertedIds[String(i)] = doc._id;
        });
        return { acknowledged: true, insertedCount: docs.length, insertedIds };
    }
    if (['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'].includes(op))
        return updateRows(name, op, filter, modifier, options);
    if (['deleteOne', 'deleteMany', 'findOneAndDelete'].includes(op)) {
        const matches = documents(name, filter),
            selected = op === 'deleteMany' ? matches : matches.slice(0, 1);
        selected.forEach((doc) => remove(name, doc));
        return op === 'findOneAndDelete'
            ? (selected[0] ?? null)
            : { acknowledged: true, deletedCount: selected.length };
    }
    if (op === 'indexes')
        return [
            { name: '_id_', key: { _id: 1 }, unique: true },
            ...(
                db
                    .query('SELECT definition FROM document_indexes WHERE collection_name=?')
                    .all(name) as Array<{ definition: string }>
            ).map((row) => decode(row.definition)),
        ];
    if (op === 'dropIndex') {
        const existing = db
            .query('SELECT sql_name FROM document_indexes WHERE collection_name=? AND name=?')
            .get(name, args[0] as string) as { sql_name: string } | null;
        if (!existing) throw Object.assign(new Error('Index not found'), { code: 27 });
        db.exec(`DROP INDEX "${existing.sql_name}"`);
        db.query('DELETE FROM document_indexes WHERE collection_name=? AND name=?').run(
            name,
            args[0] as string,
        );
        return { ok: 1 };
    }
    if (op === 'createIndex') {
        const key = args[0] as Record<string, number>,
            settings = (args[1] ?? {}) as Doc;
        const indexName = String(
            settings.name ||
                Object.entries(key)
                    .map(([key, direction]) => `${key}_${direction}`)
                    .join('_'),
        );
        const definition: IndexDefinition = { ...settings, key, name: indexName };
        const existing = db
            .query('SELECT definition FROM document_indexes WHERE collection_name=? AND name=?')
            .get(name, indexName) as { definition: string } | null;
        if (existing) {
            const prior = decode<IndexDefinition>(existing.definition);
            if (!!prior.unique !== !!definition.unique || !!prior.sparse !== !!definition.sparse)
                throw Object.assign(new Error('Index options conflict'), { code: 85 });
            return indexName;
        }
        const sqlName =
            'idx_' + createHash('sha256').update(`${name}:${indexName}`).digest('hex').slice(0, 24);
        const fields = Object.entries(key)
            .map(([key, direction]) => `${field(key)} ${direction === -1 ? 'DESC' : 'ASC'}`)
            .join(',');
        const partial = settings.sparse
            ? ' WHERE ' +
              Object.keys(key)
                  .map((key) => `${field(key)} IS NOT NULL`)
                  .join(' AND ')
            : '';
        try {
            db.exec(
                `CREATE ${settings.unique ? 'UNIQUE ' : ''}INDEX "${sqlName}" ON ${table(name)}(${fields})${partial}`,
            );
        } catch (error) {
            throw Object.assign(
                new Error(`Cannot create index ${name}.${indexName}: ${(error as Error).message}`),
                { code: 67 },
            );
        }
        db.query('INSERT INTO document_indexes VALUES(?,?,?,?)').run(
            name,
            indexName,
            encode(definition),
            sqlName,
        );
        return indexName;
    }
    if (op === 'bulkWrite') {
        const result = {
            acknowledged: true,
            insertedCount: 0,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            upsertedCount: 0,
        };
        for (const entry of args[0] as Array<Record<string, Doc>>) {
            const [kind, spec] = Object.entries(entry)[0]!;
            const response = operation(
                kind,
                name,
                kind === 'insertOne'
                    ? [spec.document]
                    : kind.startsWith('delete')
                      ? [spec.filter]
                      : [spec.filter, spec.update ?? spec.replacement, spec],
            ) as Record<string, number>;
            if (kind === 'insertOne') result.insertedCount++;
            for (const key of [
                'matchedCount',
                'modifiedCount',
                'deletedCount',
                'upsertedCount',
            ] as const)
                result[key] += response[key] ?? 0;
        }
        return result;
    }
    throw new Error(`Unsupported SQLite repository operation: ${op}`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
    let request: Request | undefined;
    const started = performance.now();
    try {
        request = decode<Request>(line);
        const value =
            request.operation === 'close'
                ? operation('close', undefined, [])
                : db
                      .transaction(() =>
                          operation(request!.operation, request!.collection, request!.args),
                      )
                      .immediate();
        process.stdout.write(encode({ id: request.id, value }) + '\n');
        if (request.operation === 'close') {
            input.close();
            process.exitCode = 0;
        }
    } catch (error) {
        process.stdout.write(
            encode({
                id: request?.id ?? -1,
                error: {
                    message: (error as Error).message,
                    code: (error as { code?: unknown }).code,
                },
            }) + '\n',
        );
    } finally {
        const elapsed = Math.round(performance.now() - started);
        if (elapsed >= 1000)
            console.error(
                `[SQLite] Slow operation ${request?.operation ?? 'decode'}${request?.collection ? ` (${request.collection})` : ''}: ${elapsed}ms`,
            );
    }
});
process.stdin.on('end', () => {
    try {
        db.close();
    } catch {}
});
