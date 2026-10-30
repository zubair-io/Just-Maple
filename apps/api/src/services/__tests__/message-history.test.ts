import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MacDataItem } from '@maple/shared';
import { testDb } from '../../__tests__/setup';
import {
    createUserFixture,
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
} from '../../__tests__/helpers/fixtures';
import { createTestApp } from '../../__tests__/helpers/app';
import { getSqliteDatabase } from '../../db/client';
import {
    upsertDeviceItems,
    findDeviceItems,
    findDeviceItemFacets,
    countDeviceItems,
} from '../../repositories/device-item.repo';
import { invalidateMessageMetadata } from '../../repositories/message-history.repo';
import { messageDirectory, messageHistoryPage } from '../message-history.service';
import {
    nativeMessageFingerprint,
    previewMessageArchive,
    startMessageArchive,
    messageArchiveProgress,
    pauseMessageArchive,
    readArchive,
    stopUserMessageImports,
    forgetUserMessageArchives,
} from '../message-archive.service';

const message = (id: string, body: string, extra: Partial<MacDataItem> = {}): MacDataItem => ({
    id,
    source: 'imessage',
    revision: '1',
    occurredAt: 1577898000,
    participants: ['+15185550123'],
    body,
    sender: '+15185550123',
    extra: { chatId: 'dm-a' },
    ...extra,
});
let owner: string;
let folder: string;
beforeEach(async () => {
    owner = (await createUserFixture())._id.toString();
    folder = await mkdtemp(join(tmpdir(), 'maple-archive-test-'));
    process.env.MESSAGE_ARCHIVE_DIR = join(folder, 'uploads');
});
afterEach(async () => {
    await stopUserMessageImports(owner);
    delete process.env.MESSAGE_ARCHIVE_DIR;
    await rm(folder, { recursive: true, force: true });
});

async function archive(size = 3) {
    const path = join(folder, 'messages.db');
    const script = `const { Database } = require('bun:sqlite'); const d = new Database(process.argv[1]);
    d.exec(\`CREATE TABLE people(id INTEGER PRIMARY KEY,name TEXT,kind TEXT);CREATE TABLE identities(person_id INT,platform TEXT,handle TEXT);CREATE TABLE threads(id INTEGER PRIMARY KEY,ext_key TEXT,title TEXT,is_group INT,is_junk INT);CREATE TABLE thread_members(thread_id INT,person_id INT);CREATE TABLE messages(id INTEGER PRIMARY KEY,thread_id INT,source TEXT,platform TEXT,ts_raw TEXT,ts_iso TEXT,sender_handle TEXT,person_id INT,is_me INT,text TEXT,has_attachment INT,dedup TEXT);\`);
    d.exec(\`INSERT INTO people VALUES (1,'Alice Archive','person'),(2,'Owner','self'),(3,'Bob Archive','person');INSERT INTO identities VALUES(1,'imessage','+15185550123'),(1,'aim','old-alice');INSERT INTO threads VALUES(1,'imsg:+15185550123','Alice',0,0),(2,'group-1','Friends',1,0),(3,'voice-alice','Alice Voice',0,0);INSERT INTO thread_members VALUES(1,1),(1,2),(2,1),(2,3),(3,1);\`);
    const q=d.query('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    q.run(1,1,'txt','imessage','2020-01-01 12:00:00','2020-01-01 12:00:00','+15185550123',1,0,'Exact native overlap',0,'one');
    q.run(2,2,'aim','aim','2020-01-02 12:00:00','2020-01-02 12:00:00','old-alice',1,0,'Group picnic',0,'two');
    q.run(3,3,'voice','voice','','','+15185550123',1,0,'Undated hello',0,'three');
    for(let n=4;n<=${size};n++)q.run(n,1,'aim','aim','2020-01-03 12:00:00','2020-01-03 12:00:00','old-alice',1,0,'Message '+n,0,'row'+n);d.close();`;
    execFileSync(process.env.BUN_EXEC_PATH || 'bun', ['-e', script, path]);
    return { path, file: new File([await readFile(path)], 'messages.db') };
}
async function waitFor(id: string, statuses = ['complete', 'failed']) {
    for (let n = 0; n < 200; n++) {
        const job = await messageArchiveProgress(owner, id);
        if (job && statuses.includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Import did not settle');
}
describe('message archive import', () => {
    it('reads a real archive in isolation, preserving groups, aliases and unknown dates', async () => {
        const { path } = await archive();
        const before = await readFile(path);
        const preview = await readArchive<{ total: number; undated: number }>(path, {
            op: 'preview',
        });
        expect(preview).toMatchObject({ total: 3, undated: 1 });
        const batch = await readArchive<{ items: MacDataItem[] }>(path, {
            op: 'batch',
            dataset: 'history',
            timeZone: 'America/New_York',
        });
        expect(batch.items[0]).toMatchObject({
            sender: 'Alice Archive',
            occurredAt: 1577898000,
            extra: {
                archivePlatform: 'imessage',
                archiveMembers: [{ name: 'Alice Archive', handles: ['+15185550123'] }],
                archiveTimestamp: '2020-01-01 12:00:00',
            },
        });
        expect(batch.items[1]?.extra?.['archiveIsGroup']).toBe(true);
        expect(batch.items[2]).toMatchObject({ occurredAt: 0, extra: { timestampUnknown: true } });
        expect(await readFile(path)).toEqual(before);
        const again = await readArchive<{ items: MacDataItem[] }>(path, {
            op: 'batch',
            dataset: 'history',
            timeZone: 'America/New_York',
        });
        expect(again.items.map((i) => i.id)).toEqual(batch.items.map((i) => i.id));
    });
    it('imports additively, skips exact native overlaps and makes repeated uploads idempotent', async () => {
        const { file } = await archive();
        await upsertDeviceItems(owner, 'mac', [message('imessage:1', 'Exact native overlap')]);
        const preview = await previewMessageArchive(owner, file);
        expect(preview).not.toHaveProperty('path');
        expect(preview).not.toHaveProperty('userId');
        const settings = {
            dataset: 'history',
            timeZone: 'America/New_York',
            platforms: ['imessage', 'aim', 'voice'],
        };
        await startMessageArchive(owner, preview.id, settings);
        expect(await waitFor(preview.id)).toMatchObject({
            status: 'complete',
            processed: 3,
            stored: 2,
            duplicates: 1,
        });
        expect(await testDb.collection('device_items').countDocuments({ userId: owner })).toBe(3);
        const second = await previewMessageArchive(owner, file);
        await startMessageArchive(owner, second.id, settings);
        expect(await waitFor(second.id)).toMatchObject({ stored: 0, duplicates: 3 });
        expect(await testDb.collection('device_items').countDocuments({ userId: owner })).toBe(3);
        const directory = await messageDirectory(owner, {});
        expect(directory.conversations).toHaveLength(2);
        expect(directory.conversations.some((c) => c.kind === 'group')).toBe(true);
        const found = await messageDirectory(owner, { search: 'picnic', platform: 'aim' });
        expect(found.total).toBe(1);
        const rows = await messageHistoryPage(owner, {
            conversation: found.conversations[0]!.key,
            search: 'picnic',
        });
        expect(rows.items[0]?.body).toBe('Group picnic');
    });
    it('pauses safely, resumes the same job, and does not resurrect forgotten data', async () => {
        const { file } = await archive(1200);
        const preview = await previewMessageArchive(owner, file);
        const settings = { dataset: 'history', timeZone: 'UTC', platforms: ['aim'] };
        await startMessageArchive(owner, preview.id, settings);
        await pauseMessageArchive(owner, preview.id);
        const paused = await messageArchiveProgress(owner, preview.id);
        expect(paused?.status).toBe('paused');
        await startMessageArchive(owner, preview.id, settings);
        expect((await waitFor(preview.id)).status).toBe('complete');
        const second = await previewMessageArchive(owner, file);
        await startMessageArchive(owner, second.id, settings);
        await stopUserMessageImports(owner);
        await testDb.collection('device_items').deleteMany({ userId: owner });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await testDb.collection('device_items').countDocuments({ userId: owner })).toBe(0);
        expect((await messageArchiveProgress(owner, second.id))?.status).toBe('paused');
        await forgetUserMessageArchives(owner);
        expect(await messageArchiveProgress(owner, second.id)).toBeNull();
        expect((await readFile(join(folder, 'messages.db'))).length).toBeGreaterThan(0);
    });
    it('requires authentication and never exposes another owner’s import', async () => {
        const { file } = await archive();
        const job = await previewMessageArchive(owner, file);
        const app = createTestApp();
        expect(
            (await app.handle(new Request('http://localhost/api/message-archives'))).status,
        ).toBe(401);
        const other = (await createUserFixture())._id.toString();
        const token = await createAuthToken(other);
        expect(
            (
                await app.handle(
                    new Request('http://localhost/api/message-archives/' + job.id, {
                        headers: { Authorization: 'Bearer ' + token },
                    }),
                )
            ).status,
        ).toBe(404);
    });
    it('rejects non-SQLite uploads', async () => {
        await expect(
            previewMessageArchive(owner, new File(['bad'], 'messages.db')),
        ).rejects.toThrow('SQLite');
    });
});
describe('message history access and pagination', () => {
    it('builds the directory only from messages allowed by the shared page', async () => {
        const other = (await createUserFixture())._id.toString();
        await upsertDeviceItems(owner, 'mac', [
            message('imessage:1', 'Allowed', {
                thread: 'Allowed name',
                extra: { chatId: 'allowed' },
            }),
            message('imessage:2', 'Secret', {
                thread: 'Secret name',
                participants: ['+15185550999'],
                extra: { chatId: 'hidden' },
            }),
            message('contacts:private', '', {
                source: 'contacts',
                title: 'Private Name',
                extra: { phones: [{ value: '+15185550123' }] },
            }),
        ]);
        const notebook = await createNotebookFixture({
            createdBy: owner,
            sharedWith: [
                { userId: owner, accessLevel: 'owner' },
                { userId: other, accessLevel: 'read' },
            ],
        });
        const page = await createPageFixture({
            userId: owner,
            notebookId: notebook._id.toString(),
        });
        await testDb.collection('pages').updateOne(
            { id: page.id },
            {
                $set: {
                    type: 'devicedata',
                    deviceSource: 'imessage',
                    deviceFilter: {
                        includeAll: false,
                        chats: [{ id: 'allowed', name: 'Allowed name' }],
                    },
                },
            },
        );
        const data = await messageDirectory(other, { pageId: page.id });
        expect(data.total).toBe(1);
        expect(JSON.stringify(data)).not.toMatch(/Secret|Private Name/);
        expect(
            (
                await messageHistoryPage(other, {
                    pageId: page.id,
                    conversation: 'person:+15185550999',
                })
            ).items,
        ).toEqual([]);
        await testDb.collection('pages').updateOne({ id: page.id }, { $set: { deviceFilter: {} } });
        expect((await messageDirectory(other, { pageId: page.id })).conversations).toEqual([]);
    });
    it('keeps chronological pages stable with timestamp ties and concurrent new messages', async () => {
        await upsertDeviceItems(
            owner,
            'mac',
            Array.from({ length: 7 }, (_, n) =>
                message(`imessage:${n}`, `Text ${n}`, { occurredAt: 1577898000 + n }),
            ),
        );
        const dir = await messageDirectory(owner, {});
        const conversation = dir.conversations[0]!.key;
        const latest = await messageHistoryPage(owner, { conversation, limit: 3 });
        expect(latest.items.map((i) => i.id)).toEqual(['imessage:4', 'imessage:5', 'imessage:6']);
        await upsertDeviceItems(owner, 'mac', [
            message('imessage:new', 'Newest', { occurredAt: 1577898999 }),
        ]);
        invalidateMessageMetadata(owner);
        const before = await messageHistoryPage(owner, {
            conversation,
            before: latest.items[0]!.id,
            limit: 3,
        });
        expect(before.items.map((i) => i.id)).toEqual(['imessage:1', 'imessage:2', 'imessage:3']);
        expect(
            (
                await messageHistoryPage(owner, { conversation, around: 'imessage:2', limit: 3 })
            ).items.map((i) => i.id),
        ).toContain('imessage:2');
        expect((await messageDirectory(owner, { from: 1577898004, to: 1577898006 })).total).toBe(3);
        expect((await messageDirectory(owner, { search: '" OR *' })).total).toBe(0);
    });
    it('keeps legacy message headers, collector counts and sharing choices on metadata-only reads', async () => {
        await upsertDeviceItems(
            owner,
            'mac',
            Array.from({ length: 250 }, (_, n) =>
                message(`imessage:${n}`, 'Large body '.repeat(200), {
                    thread: 'Alice',
                    extra: { chatId: 'dm-a' },
                }),
            ),
        );
        await upsertDeviceItems(owner, 'archive:history', [
            message('archive:other', 'Old history', { thread: 'Other', extra: { chatId: 'dm-b' } }),
        ]);
        const spy = vi.spyOn(getSqliteDatabase()!, 'request');
        try {
            expect(
                (await findDeviceItems(owner, { sources: ['imessage'], limit: 5 })).items,
            ).toHaveLength(5);
            expect((await countDeviceItems(owner, 'mac')).imessage).toBe(250);
            expect((await countDeviceItems(owner)).imessage).toBe(251);
            expect((await findDeviceItemFacets(owner)).chats).toHaveLength(2);
            const documentReads = spy.mock.calls.filter(
                (call) => call[0] === 'find' && call[1] === 'device_items',
            );
            expect(documentReads.length).toBeGreaterThan(0);
            expect(documentReads.every((call) => !!(call[2]?.[0] as { _id?: unknown })?._id)).toBe(
                true,
            );
            expect(spy.mock.calls.some((call) => call[0] === 'device.counts')).toBe(true);
            expect(spy.mock.calls.some((call) => call[0] === 'device.facets')).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    it('does not equate different platforms, incomplete peers or attachments', () => {
        const native = message('imessage:1', 'Hello');
        expect(
            nativeMessageFingerprint({
                ...native,
                id: 'archive:1',
                extra: { archivePlatform: 'imessage', archivePeerHandles: native.participants },
            }),
        ).toBe(nativeMessageFingerprint(native));
        expect(
            nativeMessageFingerprint({ ...native, extra: { archivePlatform: 'aim' } }),
        ).toBeNull();
        expect(
            nativeMessageFingerprint({ ...native, participants: ['+15185550123', 'unknown'] }),
        ).toBeNull();
        expect(
            nativeMessageFingerprint({ ...native, extra: { archiveAttachment: true } }),
        ).toBeNull();
    });
});
