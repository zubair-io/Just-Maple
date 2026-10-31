import { BlobServiceClient } from '@azure/storage-blob';
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import {
    mediaDestination,
    mediaUrlMap,
    rewriteMediaValue,
    rewriteMemoMedia,
    type MediaCopy,
} from '../src/services/media-migration.service';

const [mode, target, manifestPath, databasePath] = Bun.argv.slice(2);
if (
    !['plan', 'copy', 'verify', 'rewrite-preview', 'rewrite-apply'].includes(mode) ||
    !target ||
    !manifestPath
) {
    throw new Error(
        'Usage: migrate-media.ts plan|copy|verify|rewrite-preview|rewrite-apply TARGET MANIFEST [DATABASE]',
    );
}
const sha = async (path: string) => {
    const hash = createHash('sha256');
    for await (const data of createReadStream(path)) hash.update(data);
    return hash.digest('hex');
};
interface Manifest {
    azureHost: string;
    copies: MediaCopy[];
}
let manifest: Manifest;
if (mode === 'copy' || mode === 'plan') {
    const client = BlobServiceClient.fromConnectionString(Bun.env.HORNBEAM!);
    const copies: MediaCopy[] = [];
    const destinations = new Set<string>();
    for (const container of ['profile-picture', 'recordings', 'memo-images', 'data']) {
        for await (const blob of client.getContainerClient(container).listBlobsFlat()) {
            const relative = mediaDestination(container, blob.name);
            if (!relative) continue;
            if (destinations.has(relative)) throw new Error('Destination collision: ' + relative);
            destinations.add(relative);
            copies.push({
                container,
                name: blob.name,
                relative,
                url: '/api/storage/' + relative.split('/').map(encodeURIComponent).join('/'),
                bytes: blob.properties.contentLength ?? 0,
                etag: blob.properties.etag,
            });
        }
    }
    manifest = { azureHost: new URL(client.url).hostname, copies };
    if (mode === 'copy') {
        let previous: Manifest | null = null;
        try {
            previous = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await mkdir(target, { recursive: true });
        for (const copy of copies) {
            const destination = join(target, copy.relative);
            const prior = previous?.copies.find((item) => item.relative === copy.relative);
            if (
                prior?.sha256 &&
                prior.etag === copy.etag &&
                prior.bytes === copy.bytes &&
                (await sha(destination)) === prior.sha256
            ) {
                copy.sha256 = prior.sha256;
                continue;
            }
            await mkdir(join(destination, '..'), { recursive: true });
            const temporary = destination + '.partial-' + randomUUID();
            const response = await client
                .getContainerClient(copy.container)
                .getBlobClient(copy.name)
                .download(0, undefined, { conditions: { ifMatch: copy.etag } });
            if (!response.readableStreamBody) throw new Error('Missing Azure body');
            await pipeline(
                response.readableStreamBody,
                createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
            );
            if ((await stat(temporary)).size !== copy.bytes) throw new Error('Incomplete download');
            copy.sha256 = await sha(temporary);
            try {
                if ((await sha(destination)) !== copy.sha256)
                    throw new Error('Existing destination differs: ' + copy.relative);
                await unlink(temporary); // Only our verified temporary file; retain existing data.
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                await rename(temporary, destination);
            }
            if ((await sha(destination)) !== copy.sha256)
                throw new Error('Copy verification failed');
        }
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
} else {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    for (const copy of manifest.copies) {
        if (!copy.sha256 || (await sha(join(target, copy.relative))) !== copy.sha256)
            throw new Error('Unverified media copy');
    }
}
if (mode.startsWith('rewrite-')) {
    if (!databasePath)
        throw new Error('Database path required (stop the API before rewrite-apply)');
    await stat(databasePath);
    const db = new Database(
        databasePath,
        mode === 'rewrite-preview' ? { readonly: true } : undefined,
    );
    const urls = mediaUrlMap(manifest.copies, manifest.azureHost);
    const report: Record<string, number> = {};
    const run = () => {
        for (const { name } of db
            .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'docs_%'")
            .all() as { name: string }[]) {
            if (!/^docs_[a-z0-9_]+$/.test(name)) throw new Error('Unexpected table');
            for (const row of db
                .query(`SELECT _id,body,index_data FROM ${name} WHERE instr(body,'hornbeam')>0`)
                .iterate() as Iterable<{ _id: string; body: string; index_data: string }>) {
                const original = JSON.parse(row.body);
                const body = JSON.stringify(rewriteMediaValue(original, urls));
                if (body === JSON.stringify(original)) continue;
                report[name] = (report[name] ?? 0) + 1;
                if (mode === 'rewrite-apply')
                    db.query(`UPDATE ${name} SET body=?,index_data=? WHERE _id=? AND body=?`).run(
                        body,
                        JSON.stringify(rewriteMediaValue(JSON.parse(row.index_data), urls)),
                        row._id,
                        row.body,
                    );
            }
        }
        for (const row of db
            .query(
                "SELECT collection_name,document_id,path,bytes FROM document_blobs WHERE collection_name IN ('memos','memo_versions') AND path='[\"state\"]' AND instr(bytes,cast('hornbeam' AS BLOB))>0",
            )
            .iterate() as Iterable<{
            collection_name: string;
            document_id: string;
            path: string;
            bytes: Uint8Array;
        }>) {
            const next = rewriteMemoMedia(row.bytes, urls);
            if (!next) continue;
            report['yjs_' + row.collection_name] = (report['yjs_' + row.collection_name] ?? 0) + 1;
            if (mode === 'rewrite-apply') {
                db.query(
                    'UPDATE document_blobs SET bytes=? WHERE collection_name=? AND document_id=? AND path=? AND bytes=?',
                ).run(next, row.collection_name, row.document_id, row.path, row.bytes);
                if (row.collection_name === 'memos') {
                    const memo = db
                        .query('SELECT body,index_data FROM docs_memos WHERE _id=?')
                        .get(row.document_id) as { body: string; index_data: string };
                    const body = JSON.parse(memo.body);
                    const index = JSON.parse(memo.index_data);
                    const version = body.version;
                    if (typeof version === 'number') body.version++;
                    else if (version?.$numberInt)
                        version.$numberInt = String(Number(version.$numberInt) + 1);
                    else if (version?.$numberLong)
                        version.$numberLong = String(BigInt(version.$numberLong) + 1n);
                    else throw new Error('Unexpected memo version');
                    index.version = Number(
                        typeof body.version === 'number'
                            ? body.version
                            : Object.values(body.version)[0],
                    );
                    const now = Date.now();
                    body.updatedAt = { $date: { $numberLong: String(now) } };
                    index.updatedAt = now;
                    db.query('UPDATE docs_memos SET body=?,index_data=? WHERE _id=?').run(
                        JSON.stringify(body),
                        JSON.stringify(index),
                        row.document_id,
                    );
                }
            }
        }
    };
    if (mode === 'rewrite-apply') db.transaction(run)();
    else run();
    db.close();
    console.log(JSON.stringify({ mode, changed: report }));
}
console.log(
    JSON.stringify({
        mode,
        files: manifest.copies.length,
        bytes: manifest.copies.reduce((sum, item) => sum + item.bytes, 0),
    }),
);
