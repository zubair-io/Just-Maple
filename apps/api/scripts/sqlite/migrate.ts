import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SqliteDatabase } from '../../src/db/sqlite/client';
import { decode, encode } from '../../src/db/sqlite/codec';
import { createIndexes } from '../../src/db/client';

type Doc = Record<string, unknown>;
interface Entry {
    name: string;
    file: string;
    count: number;
    digest: string;
}
interface Manifest {
    version: 1;
    createdAt: string;
    consistency: 'quiesced-source' | 'live-rehearsal';
    collections: Entry[];
}
function canonical(value: unknown): string {
    const sort = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(sort)
            : value && typeof value === 'object'
              ? Object.fromEntries(
                    Object.entries(value)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([key, value]) => [key, sort(value)]),
                )
              : value;
    return JSON.stringify(sort(JSON.parse(encode(value))));
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const digest = (hashes: string[]) => hash(hashes.sort().join('\n'));
async function* jsonLines(path: string) {
    let pending = Buffer.alloc(0);
    for await (const chunk of createReadStream(path)) {
        pending = Buffer.concat([pending, Buffer.from(chunk)]);
        let start = 0,
            end: number;
        while ((end = pending.indexOf(10, start)) >= 0) {
            yield pending.subarray(start, end).toString('utf8');
            start = end + 1;
        }
        pending = pending.subarray(start);
        if (pending.length > 64 * 1024 * 1024) throw new Error('Export record exceeds 64 MiB');
    }
    if (pending.length) yield pending.toString('utf8');
}
const [command, first, second, ...flags] = process.argv.slice(2);

if (command === 'inventory') {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    try {
        await client.connect();
        const db = client.db();
        const rows = [];
        for (const { name } of await db.listCollections().toArray())
            rows.push({
                name,
                count: await db.collection(name).countDocuments(),
                indexes: (await db.collection(name).indexes()).map(({ key, unique, sparse }) => ({
                    key,
                    unique: !!unique,
                    sparse: !!sparse,
                })),
            });
        console.log(JSON.stringify({ collections: rows }, null, 2));
    } finally {
        await client.close();
    }
} else if (command === 'export') {
    if (!first || !process.env.MONGODB_URI)
        throw new Error(
            'Usage: migrate.ts export NEW_DIRECTORY [--source-quiesced] (MONGODB_URI required)',
        );
    const directory = resolve(first);
    if (existsSync(directory)) throw new Error('Export destination must not exist');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest: Manifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        consistency: process.argv.includes('--source-quiesced')
            ? 'quiesced-source'
            : 'live-rehearsal',
        collections: [],
    };
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    try {
        await client.connect();
        const db = client.db();
        for (const { name } of await db.listCollections().toArray()) {
            if (!/^[a-z][a-z0-9_]*$/.test(name))
                throw new Error(`Unmapped collection name: ${name}`);
            const file = name + '.ejsonl',
                output = Bun.file(join(directory, file)).writer();
            const hashes: string[] = [];
            let count = 0;
            for await (const document of db.collection(name).find({})) {
                const line = canonical(document);
                hashes.push(hash(line));
                output.write(line + '\n');
                count++;
            }
            await output.end();
            await Bun.$`chmod 600 ${join(directory, file)}`.quiet();
            manifest.collections.push({ name, file, count, digest: digest(hashes) });
            console.log(JSON.stringify({ collection: name, count }));
        }
        writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
            mode: 0o600,
        });
    } finally {
        await client.close();
    }
} else if (command === 'import') {
    if (!first || !second)
        throw new Error('Usage: migrate.ts import EXPORT_DIRECTORY NEW_DATABASE [--staging]');
    const directory = resolve(first),
        target = resolve(second);
    if (existsSync(target))
        throw new Error('Import requires a new database path; existing data is never overwritten');
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Manifest;
    if (manifest.version !== 1) throw new Error('Unsupported manifest version');
    const staging = flags.includes('--staging');
    const skipped = new Set([
        'passkeys',
        'passkey_challenges',
        'bot_access_tokens',
        'bot_auth_tokens',
        'device_registrations',
        'mac_data_hosts',
        'bot_provisioning_tokens',
        'bot_sessions',
        'magic_links',
    ]);
    const sqlite = new SqliteDatabase(target);
    try {
        await sqlite.ready;
        const db = sqlite.asRepositoryDatabase();
        const report = [];
        for (const entry of manifest.collections) {
            if (!/^[a-z][a-z0-9_]*$/.test(entry.name) || entry.file !== entry.name + '.ejsonl')
                throw new Error('Invalid manifest collection');
            const input = jsonLines(join(directory, entry.file));
            const inputHashes: string[] = [];
            const expected: string[] = [];
            let imported = 0;
            for await (const line of input) {
                if (!line.trim()) continue;
                inputHashes.push(hash(line));
                let doc = decode<Doc>(line);
                if (staging && skipped.has(entry.name)) continue;
                if (staging && entry.name === 'user_bots') {
                    doc = { ...doc, isEnabled: false, status: 'disabled', config: {} };
                    delete doc.webhookSecret;
                    delete doc.invokeUrl;
                }
                if (staging && entry.name === 'collectors') {
                    doc = { ...doc, activeSources: [], activeSince: {} };
                }
                if (staging && entry.name === 'users') {
                    doc = { ...doc };
                    delete doc.preferences;
                }
                if (staging && entry.name === 'bot_templates') {
                    doc = { ...doc, definition: {} };
                }
                if (staging && entry.name === 'canvases') {
                    doc = { ...doc, connectors: [] };
                }
                expected.push(hash(canonical(doc)));
                await db.collection(entry.name).insertOne(doc);
                imported++;
            }
            if (inputHashes.length !== entry.count || digest(inputHashes) !== entry.digest)
                throw new Error(`Source export integrity failed: ${entry.name}`);
            const actual: string[] = [];
            let offset = 0;
            for (;;) {
                const batch = await sqlite.request<Doc[]>('migration.scan', entry.name, [
                    offset,
                    100,
                ]);
                if (!batch.length) break;
                batch.forEach((doc) => actual.push(hash(canonical(doc))));
                offset += batch.length;
            }
            if (actual.length !== imported || digest(actual) !== digest(expected))
                throw new Error(`SQLite verification failed: ${entry.name}`);
            report.push({
                name: entry.name,
                sourceCount: entry.count,
                imported,
                verified: true,
                ...(staging && skipped.has(entry.name) ? { sanitized: 'credentials-omitted' } : {}),
            });
            console.log(JSON.stringify(report.at(-1)));
        }
        await createIndexes(db);
        const check = await sqlite.request<Array<{ integrity_check: string }>>('sql', undefined, [
            'PRAGMA integrity_check',
        ]);
        if (check[0]?.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
        writeFileSync(
            target + '.migration.json',
            JSON.stringify(
                {
                    sourceConsistency: manifest.consistency,
                    staging,
                    collections: report,
                    integrity: 'ok',
                },
                null,
                2,
            ),
            { mode: 0o600 },
        );
    } finally {
        await sqlite.close();
    }
} else {
    throw new Error(
        'Commands: inventory | export NEW_DIRECTORY [--source-quiesced] | import EXPORT_DIRECTORY NEW_DATABASE [--staging]',
    );
}
