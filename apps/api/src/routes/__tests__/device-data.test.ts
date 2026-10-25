import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import type { MacDataItem } from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));

import { handleDeviceDataChanges } from '../../services/proactive-bot.service';
import { purgeExpiredDeviceItems } from '../../repositories/device-item.repo';
import { searchDeviceData } from '../../services/device-search.service';

const now = Math.floor(Date.now() / 1000);

function item(id: string, source: MacDataItem['source'], extra: Partial<MacDataItem> = {}) {
    return {
        id,
        source,
        revision: '1',
        occurredAt: now - 600,
        title: `Title ${id}`,
        sender: 'coach@example.com',
        participants: [],
        body: `Body of ${id}: practice moved to 4pm at Riverside Park`,
        ...extra,
    } satisfies MacDataItem;
}

/** Little-endian float32 values as base64, like the devices send. */
function encode(values: number[]): string {
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, i) => buffer.writeFloatLE(value, i * 4));
    return buffer.toString('base64');
}

describe.runIf(mongoAvailable)('device data routes', () => {
    let token: string;
    let userId: string;
    let request: (body: unknown, path: string, method?: string, auth?: string) => Promise<Response>;

    beforeEach(async () => {
        vi.clearAllMocks();
        const user = await createUserFixture();
        userId = user._id.toString();
        token = await createAuthToken(userId);
        const app = createTestApp();
        request = (body, path, method = 'POST', auth = token) =>
            app.handle(
                new Request('http://localhost' + path, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
                    },
                    ...(method === 'GET' || method === 'DELETE'
                        ? {}
                        : { body: JSON.stringify(body) }),
                }),
            );
    });
    afterEach(() => vi.useRealTimers());

    const register = (deviceId: string, sources: string[], platform = 'macos') =>
        request(
            { deviceId, platform, name: deviceId, sources, timeZone: 'America/New_York' },
            '/api/collectors',
        ).then((r) => r.json());

    it('makes each source come from one device, and switching moves it', async () => {
        const mac = await register('mac-device-1', ['imessage', 'mail', 'calendar', 'contacts']);
        expect(mac.collector.activeSources).toEqual(['imessage', 'mail', 'calendar', 'contacts']);
        const phone = await register('phone-device-1', ['location', 'health', 'calendar'], 'ios');
        // Calendar already comes from the Mac, so the phone doesn't upload it.
        expect(phone.collector.activeSources).toEqual(['location', 'health']);

        // An upload of a source the device isn't collecting is skipped.
        const skipped = await request(
            { deviceId: 'phone-device-1', upserts: [item('calendar:1', 'calendar')], removals: [] },
            '/api/device-data/items',
        ).then((r) => r.json());
        expect(skipped).toMatchObject({ stored: 0, skipped: 1 });

        await request(
            { deviceId: 'mac-device-1', upserts: [item('calendar:1', 'calendar')], removals: [] },
            '/api/device-data/items',
        );
        // Switching calendar to the phone drops the Mac's copy.
        const switched = await request(
            { activeSources: ['location', 'health', 'calendar'] },
            '/api/collectors/phone-device-1',
            'PATCH',
        ).then((r) => r.json());
        expect(switched.collector.activeSources).toContain('calendar');
        const list = await request(null, '/api/collectors', 'GET').then((r) => r.json());
        const macNow = list.collectors.find((c: any) => c.deviceId === 'mac-device-1');
        expect(macNow.activeSources).not.toContain('calendar');
        expect(
            await testDb!.collection('device_items').countDocuments({ source: 'calendar' }),
        ).toBe(0);
    });

    it('stores uploads idempotently, keeps vectors per revision, and removes items', async () => {
        await register('mac-device-1', ['imessage', 'mail']);
        const upload = (body: Record<string, unknown>) =>
            request(
                { deviceId: 'mac-device-1', removals: [], ...body },
                '/api/device-data/items',
            ).then((r) => r.json());
        expect(
            await upload({
                upserts: [item('mail:1', 'mail'), item('imessage:1', 'imessage')],
                cursor: '42',
            }),
        ).toMatchObject({ stored: 2, removed: 0, cursor: '42' });
        // Same revision again: nothing new to store.
        expect(await upload({ upserts: [item('mail:1', 'mail')] })).toMatchObject({ stored: 0 });

        expect(
            await upload({
                upserts: [],
                vectors: [
                    { id: 'mail:1', revision: '1', dimensions: 2, vectors: encode([0.6, 0.8]) },
                    { id: 'mail:1', revision: 'stale', dimensions: 2, vectors: encode([1, 0]) },
                ],
            }),
        ).toMatchObject({ vectors: 1 });

        const hits = await searchDeviceData(
            userId,
            { sources: ['mail'], query: 'when is the game' },
            'America/New_York',
            [0.6, 0.8],
        );
        expect(hits.map((h) => h.id)).toEqual(['mail:1']); // matched on meaning alone
        expect(hits[0]!.when).toMatch(/-0[45]:00$/);

        expect(await upload({ upserts: [], removals: ['mail:1'] })).toMatchObject({ removed: 1 });
        const left = await request(null, '/api/device-data/items?source=mail', 'GET').then((r) =>
            r.json(),
        );
        expect(left.total).toBe(0);
    });

    it('sends fresh news to proactive notebooks that have pages for it', async () => {
        await register('mac-device-1', ['imessage', 'mail', 'contacts']);
        const notebook = await createNotebookFixture({ userId });
        const notebookId = notebook._id.toString();
        const chat = await createPageFixture({ userId, notebookId, type: 'message' });
        await testDb!.collection('pages').updateOne(
            { _id: chat._id },
            {
                $set: {
                    proactive: {
                        userBotId: new ObjectId().toString(),
                        instructions: '',
                        enabled: true,
                        ownerUserId: userId,
                        updatedAt: new Date(),
                    },
                },
            },
        );
        const mailPage = await createPageFixture({
            userId,
            notebookId,
            type: 'devicedata' as never,
        });
        await testDb!
            .collection('pages')
            .updateOne({ _id: mailPage._id }, { $set: { deviceSource: 'mail' } });

        await request(
            {
                deviceId: 'mac-device-1',
                upserts: [
                    item('mail:new', 'mail'),
                    item('mail:old', 'mail', { occurredAt: now - 3 * 24 * 3600 }), // backlog
                    item('imessage:1', 'imessage'), // no Messages page in this notebook
                    item('contacts:1', 'contacts'), // contacts are never news
                ],
                removals: [],
            },
            '/api/device-data/items',
        );
        await vi.waitFor(() => expect(handleDeviceDataChanges).toHaveBeenCalled());
        const [owner, batches] = vi.mocked(handleDeviceDataChanges).mock.calls[0]!;
        expect(owner).toBe(userId);
        expect(batches).toEqual([
            {
                notebookId,
                entries: [{ kind: 'added', item: expect.objectContaining({ id: 'mail:new' }) }],
            },
        ]);
    });

    it('shows page data only to the page owner, even in a shared notebook', async () => {
        await register('mac-device-1', ['imessage']);
        await request(
            { deviceId: 'mac-device-1', upserts: [item('imessage:1', 'imessage')], removals: [] },
            '/api/device-data/items',
        );
        const page = await createPageFixture({ userId, type: 'devicedata' as never });
        await testDb!
            .collection('pages')
            .updateOne({ _id: page._id }, { $set: { deviceSource: 'imessage' } });

        const mine = await request(
            null,
            `/api/device-data/items?source=imessage&pageId=${page.id}`,
            'GET',
        ).then((r) => r.json());
        expect(mine.items.map((i: MacDataItem) => i.id)).toEqual(['imessage:1']);
        expect(mine.collector).toMatchObject({ name: 'mac-device-1', platform: 'macos' });

        const other = await createUserFixture();
        const otherToken = await createAuthToken(other._id.toString());
        const theirs = await request(
            null,
            '/api/device-data/items?source=imessage',
            'GET',
            otherToken,
        ).then((r) => r.json());
        expect(theirs.total).toBe(0); // their own (empty) data, never someone else's
    });

    it('forgets a device with its data, and deletes everything on request', async () => {
        await register('mac-device-1', ['mail']);
        await register('phone-device-1', ['location'], 'ios');
        await request(
            { deviceId: 'mac-device-1', upserts: [item('mail:1', 'mail')], removals: [] },
            '/api/device-data/items',
        );
        await request(
            { deviceId: 'phone-device-1', upserts: [item('location:1', 'location')], removals: [] },
            '/api/device-data/items',
        );
        expect(
            await request(null, '/api/collectors/mac-device-1', 'DELETE').then((r) => r.json()),
        ).toEqual({ removed: 1 });
        expect(await request(null, '/api/device-data', 'DELETE').then((r) => r.json())).toEqual({
            removed: 1,
        });
        const list = await request(null, '/api/collectors', 'GET').then((r) => r.json());
        expect(list.collectors.map((c: any) => [c.deviceId, c.activeSources])).toEqual([
            ['phone-device-1', []],
        ]);
    });

    it('drops items past 30 days but keeps contacts and events that are still going', async () => {
        await register('mac-device-1', ['mail', 'contacts', 'calendar']);
        const old = now - 40 * 24 * 3600;
        await request(
            {
                deviceId: 'mac-device-1',
                upserts: [
                    item('mail:old', 'mail', { occurredAt: old }),
                    item('mail:new', 'mail'),
                    item('contacts:1', 'contacts', { occurredAt: old }),
                    item('calendar:long', 'calendar', { occurredAt: old, endAt: now + 3600 }),
                    item('calendar:done', 'calendar', { occurredAt: old, endAt: old + 3600 }),
                ],
                removals: [],
            },
            '/api/device-data/items',
        );
        expect(await purgeExpiredDeviceItems()).toEqual([userId]);
        const ids = (await testDb!.collection('device_items').find({ userId }).toArray())
            .map((doc) => doc.id)
            .sort();
        expect(ids).toEqual(['calendar:long', 'contacts:1', 'mail:new']);
    });

    it('requires sign-in and a registered device', async () => {
        expect((await request(null, '/api/collectors', 'GET', '')).status).toBe(401);
        const unknown = await request(
            { deviceId: 'never-registered', upserts: [], removals: [] },
            '/api/device-data/items',
        );
        expect(unknown.status).toBe(404);
    });
});
