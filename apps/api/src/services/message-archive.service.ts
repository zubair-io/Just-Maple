import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    normalizePersonHandle,
    type MacDataItem,
    type MessageArchivePreview,
    type MessageArchiveProgress,
} from '@maple/shared';
import { config } from '../config';
import { getDb, getSqliteDatabase } from '../db/client';
import { findDeviceItemRevisions, upsertDeviceItems } from '../repositories/device-item.repo';
import { bumpDeviceDataVersion } from './device-search.service';

interface Job extends MessageArchiveProgress {
    _id: string;
    userId: string;
    path: string;
    sha256: string;
    createdAt: number;
    platformsSelected?: string[];
}
const jobs = () => getDb().collection<Job>('message_archive_imports');
const active = new Map<string, Promise<void>>();
const stopping = new Set<string>();
let shuttingDown = false;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const publicJob = ({
    _id: _id,
    userId: _user,
    path: _path,
    sha256: _sha,
    createdAt: _created,
    platformsSelected: _platforms,
    ...job
}: Job): MessageArchiveProgress => ({
    ...job,
    ...(_platforms ? { selectedPlatforms: _platforms } : {}),
});

export async function readArchive<T>(path: string, options: Record<string, unknown>): Promise<T> {
    const entry =
        process.env.MESSAGE_ARCHIVE_WORKER_PATH ||
        fileURLToPath(
            new URL(
                import.meta.url.endsWith('.ts')
                    ? '../workers/message-archive.ts'
                    : './message-archive-worker.js',
                import.meta.url,
            ),
        );
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.env.BUN_EXEC_PATH || 'bun',
            [entry, path, JSON.stringify(options)],
            {
                cwd: dirname(path),
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
            },
        );
        const chunks: Buffer[] = [];
        let bytes = 0;
        const timer = setTimeout(() => child.kill(), 90_000);
        child.stdout.on('data', (data: Buffer) => {
            bytes += data.length;
            if (bytes > 32 * 1024 * 1024) child.kill();
            else chunks.push(data);
        });
        child.stderr.resume(); // Diagnostics can contain source data; never forward them.
        child.on('error', () => {
            clearTimeout(timer);
            reject(new Error('Could not start the archive reader.'));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0)
                return reject(
                    new Error(
                        'Could not read this message archive. Check its schema and selected timezone.',
                    ),
                );
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
            } catch {
                reject(new Error('The archive reader returned an invalid result.'));
            }
        });
    });
}

export async function previewMessageArchive(
    userId: string,
    file: File,
): Promise<MessageArchiveProgress> {
    if (file.size > 100 * 1024 * 1024) throw new Error('Choose an archive smaller than 100 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0')
        throw new Error('Choose the SQLite messages.db from message-archive.');
    const id = randomUUID();
    const folder = join(
        process.env.MESSAGE_ARCHIVE_DIR || join(dirname(config.databasePath), 'message-imports'),
        id,
    );
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, 'source.sqlite');
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    await chmod(folder, 0o700);
    try {
        const preview = await readArchive<Omit<MessageArchivePreview, 'id' | 'filename'>>(path, {
            op: 'preview',
        });
        const job: Job = {
            _id: id,
            id,
            userId,
            path,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            createdAt: Date.now(),
            filename: file.name.slice(0, 200),
            ...preview,
            status: 'ready',
            cursor: 0,
            processed: 0,
            stored: 0,
            duplicates: 0,
        };
        await jobs().insertOne(job);
        return publicJob(job);
    } catch (error) {
        await rm(folder, { recursive: true, force: true }); // Our failed staging copy only.
        throw error;
    }
}

export async function messageArchiveProgress(userId: string, id: string) {
    const job = await jobs().findOne({ _id: id, userId });
    return job ? publicJob(job) : null;
}

/** Only exact, unambiguous iMessage overlaps are dropped. Never deduplicate across platforms. */
export function nativeMessageFingerprint(item: MacDataItem): string | null {
    if (item.extra?.['archivePlatform'] && item.extra['archivePlatform'] !== 'imessage')
        return null;
    if (
        !item.occurredAt ||
        item.extra?.['archiveAttachment'] ||
        !item.body.trim() ||
        ['(attachment)', '(unsent)'].includes(item.body)
    )
        return null;
    const peers = Array.isArray(item.extra?.['archivePeerHandles'])
        ? (item.extra['archivePeerHandles'] as string[])
        : item.participants;
    const normalized = peers
        .map(normalizePersonHandle)
        .filter((value): value is string => !!value)
        .sort();
    if (
        !normalized.length ||
        normalized.length !== peers.length ||
        item.body.length >= 20_000 ||
        item.extra?.['archiveTruncated']
    )
        return null;
    const uniquePeers = [...new Set(normalized)];
    const author =
        uniquePeers.length > 1 && !item.isFromMe
            ? normalizePersonHandle(
                  typeof item.extra?.['senderHandle'] === 'string'
                      ? item.extra['senderHandle']
                      : item.sender,
              )
            : '';
    if (author === null) return null;
    return hash(
        JSON.stringify([
            Math.floor(item.occurredAt),
            !!item.isFromMe,
            uniquePeers,
            author,
            item.body.normalize('NFKC').replace(/\s+/g, ' ').trim(),
        ]),
    );
}

async function nativeFingerprints(userId: string) {
    const sqlite = getSqliteDatabase();
    const items = sqlite
        ? await sqlite.request<MacDataItem[]>('messages.native', undefined, [userId])
        : (
              await getDb()
                  .collection<{ item: MacDataItem }>('device_items')
                  .find(
                      { userId, source: 'imessage', id: /^imessage:/ },
                      { projection: { item: 1 } },
                  )
                  .toArray()
          ).map((row) => row.item);
    const counts = new Map<string, number>();
    for (const item of items) {
        const key = nativeMessageFingerprint(item);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

async function runImport(id: string): Promise<void> {
    let job = await jobs().findOne({ _id: id });
    if (!job || job.status !== 'queued') return;
    await jobs().updateOne({ _id: id }, { $set: { status: 'importing', error: undefined } });
    try {
        const native = await nativeFingerprints(job.userId);
        while (!stopping.has(job.userId)) {
            job = await jobs().findOne({ _id: id });
            if (!job || job.status !== 'importing') break;
            const batch = await readArchive<{
                items: MacDataItem[];
                cursor: number;
                rows: number;
                done: boolean;
            }>(job.path, {
                op: 'batch',
                dataset: job.dataset,
                timeZone: job.timeZone,
                cursor: job.cursor,
            });
            if (
                stopping.has(job.userId) ||
                (await jobs().findOne({ _id: id }))?.status !== 'importing'
            )
                break;
            const selected = batch.items.filter((item) =>
                job!.platformsSelected!.includes(String(item.extra?.['archivePlatform'])),
            );
            const unique = selected.filter((item) => {
                const key = nativeMessageFingerprint(item);
                return !key || native.get(key) !== 1;
            });
            const revisions = await findDeviceItemRevisions(
                job.userId,
                unique.map((item) => item.id),
            );
            const changed = unique.filter((item) => revisions.get(item.id) !== item.revision);
            await upsertDeviceItems(job.userId, `archive:${job.dataset}`, changed);
            // Historical imports intentionally bypass proactive news and collector takeover.
            await bumpDeviceDataVersion(job.userId);
            await jobs().updateOne(
                { _id: id, status: 'importing' },
                {
                    $set: {
                        cursor: batch.cursor,
                        processed: job.processed + batch.rows,
                        stored: job.stored + changed.length,
                        duplicates: job.duplicates + selected.length - changed.length,
                        status: batch.done ? 'complete' : 'importing',
                    },
                },
            );
            if (batch.done) break;
        }
    } catch {
        await jobs().updateOne(
            { _id: id, status: 'importing' },
            {
                $set: {
                    status: 'failed',
                    error: 'Import stopped safely. Resume to retry from its last saved batch.',
                },
            },
        );
    }
}

function enqueue(id: string) {
    if (shuttingDown || active.size || active.has(id)) return;
    const task = runImport(id).finally(() => {
        active.delete(id);
        if (!shuttingDown)
            void jobs()
                .findOne({ status: 'queued' })
                .then((next) => {
                    if (next) enqueue(next.id);
                })
                .catch(() => undefined);
    });
    active.set(id, task);
}

export async function startMessageArchive(
    userId: string,
    id: string,
    input: { timeZone: string; dataset: string; platforms: string[] },
) {
    new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format();
    if (!/^[a-z0-9-]{1,64}$/.test(input.dataset))
        throw new Error('Use a dataset name with lowercase letters, numbers and hyphens.');
    const job = await jobs().findOne({ _id: id, userId });
    if (!job) return null;
    if (['importing', 'queued', 'complete'].includes(job.status)) return publicJob(job);
    if (
        !input.platforms.length ||
        input.platforms.some(
            (platform) => !job.platforms.some((entry) => entry.platform === platform),
        )
    )
        throw new Error('Choose at least one platform from this archive.');
    if (
        job.cursor &&
        (job.timeZone !== input.timeZone ||
            job.dataset !== input.dataset ||
            JSON.stringify(job.platformsSelected) !== JSON.stringify(input.platforms))
    )
        throw new Error(
            'Resume with the original settings, or preview the archive again to change them.',
        );
    if (await jobs().findOne({ userId, status: { $in: ['queued', 'importing'] } }))
        throw new Error('Another archive is importing. Pause it before starting this one.');
    stopping.delete(userId);
    await jobs().updateOne(
        { _id: id },
        {
            $set: {
                status: 'queued',
                timeZone: input.timeZone,
                dataset: input.dataset,
                platformsSelected: input.platforms,
            },
        },
    );
    enqueue(id);
    return messageArchiveProgress(userId, id);
}

export async function pauseMessageArchive(userId: string, id: string) {
    await jobs().updateOne(
        { _id: id, userId, status: { $in: ['queued', 'importing'] } },
        { $set: { status: 'paused' } },
    );
    await active.get(id);
    return messageArchiveProgress(userId, id);
}

export async function stopUserMessageImports(userId: string) {
    stopping.add(userId);
    const pending = await jobs()
        .find({ userId, status: { $in: ['queued', 'importing'] } })
        .toArray();
    await jobs().updateMany(
        { userId, status: { $in: ['queued', 'importing'] } },
        { $set: { status: 'paused' } },
    );
    await Promise.all(pending.map((job) => active.get(job.id)));
}

/** Explicit account-data forgetting also removes our uploaded archive copies, never the user's original. */
export async function forgetUserMessageArchives(userId: string) {
    await stopUserMessageImports(userId);
    const archives = await jobs().find({ userId }).toArray();
    for (const job of archives) {
        const folder = join(
            process.env.MESSAGE_ARCHIVE_DIR ||
                join(dirname(config.databasePath), 'message-imports'),
            job.id,
        );
        if (job.path !== join(folder, 'source.sqlite'))
            throw new Error('Archive storage path changed; source copy needs operator review.');
        await rm(folder, { recursive: true, force: true });
    }
    await jobs().deleteMany({ userId });
}

/** Resume interrupted jobs after an API restart. Explicitly paused jobs stay paused. */
export async function resumeMessageArchives() {
    const pending = await jobs()
        .find({ status: { $in: ['queued', 'importing'] } })
        .toArray();
    for (const job of pending) {
        await jobs().updateOne({ _id: job.id }, { $set: { status: 'queued' } });
        enqueue(job.id);
    }
}

export async function listMessageArchives(userId: string) {
    return (await jobs().find({ userId }).sort({ createdAt: -1 }).limit(20).toArray()).map(
        publicJob,
    );
}
export async function shutdownMessageArchives() {
    shuttingDown = true;
    for (const job of await jobs().find({ status: 'importing' }).toArray())
        stopping.add(job.userId);
    await Promise.all(active.values());
}
