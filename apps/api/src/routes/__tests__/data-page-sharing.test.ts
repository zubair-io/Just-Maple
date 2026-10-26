import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import type { DeviceDataFilter, MacDataItem, MacDataSource } from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));
vi.mock('../../services/mac-data-relay.service', () => ({
    macDataRelay: { isOnline: vi.fn().mockResolvedValue(false), request: vi.fn() },
}));

import { executeMacDataTool, getMacDataToolContext } from '../../services/mac-data-tools.service';

const now = Math.floor(Date.now() / 1000);

function item(id: string, source: MacDataSource, extra: Partial<MacDataItem> = {}): MacDataItem {
    return {
        id,
        source,
        revision: '1',
        occurredAt: now - 600,
        title: `Title ${id}`,
        participants: [],
        body: `Body of ${id}: practice at the park`,
        ...extra,
    };
}

/** Seconds since 1970 for today at this New York wall-clock time. */
function todayAt(hour: number, minute = 0): number {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
        new Date(),
    );
    const probe = new Date(`${day}T12:00:00Z`);
    const offset =
        new Date(probe.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime() -
        new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    const local = Date.parse(
        `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
    );
    return Math.floor((local - offset) / 1000);
}

describe.runIf(mongoAvailable)('data pages in shared notebooks', () => {
    let app: ReturnType<typeof createTestApp>;
    let creator: { id: string; token: string };
    let member: { id: string; token: string };

    const call = (
        who: { token: string },
        path: string,
        method = 'GET',
        body?: unknown,
    ): Promise<Response> =>
        app.handle(
            new Request('http://localhost' + path, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + who.token,
                },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            }),
        );
    const json = async (response: Promise<Response>) => (await response).json();

    async function person(displayName: string) {
        const user = await createUserFixture({ displayName });
        const id = user._id.toString();
        return { id, token: await createAuthToken(id) };
    }

    /** The creator's device uploads these items. */
    async function upload(sources: MacDataSource[], items: MacDataItem[]) {
        await call(creator, '/api/collectors', 'POST', {
            deviceId: `device-${creator.id}`,
            platform: 'macos',
            name: 'Test Mac',
            sources,
            timeZone: 'America/New_York',
        });
        await call(creator, `/api/collectors/device-${creator.id}`, 'PATCH', {
            activeSources: sources,
        });
        const result = await json(
            call(creator, '/api/device-data/items', 'POST', {
                deviceId: `device-${creator.id}`,
                upserts: items,
                removals: [],
            }),
        );
        expect(result.stored).toBe(items.length);
    }

    async function notebook(shared: boolean) {
        const doc = await createNotebookFixture({
            createdBy: creator.id,
            sharedWith: [
                { userId: creator.id, accessLevel: 'owner' },
                ...(shared ? [{ userId: member.id, accessLevel: 'write' as const }] : []),
            ],
        });
        return doc._id.toString();
    }

    async function addPage(notebookId: string, source: MacDataSource) {
        const { page } = await json(
            call(creator, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: source,
                title: 'Data',
                notebookId,
            }),
        );
        return page as { id: string; deviceFilter?: DeviceDataFilter };
    }

    const setFilter = (pageId: string, deviceFilter: DeviceDataFilter) =>
        json(call(creator, `/api/device-data/pages/${pageId}`, 'PATCH', { deviceFilter }));

    const view = async (who: { token: string }, pageId: string, source: string, search = '') =>
        json(
            call(
                who,
                `/api/device-data/items?source=${source}&pageId=${pageId}${search ? `&search=${search}` : ''}`,
            ),
        );
    const ids = (result: { items: MacDataItem[] }) => result.items.map((i) => i.id).sort();

    beforeEach(async () => {
        vi.clearAllMocks();
        app = createTestApp();
        creator = await person('Alex');
        member = await person('Sam');
    });

    // MARK: - Defaults

    it('starts a page in a shared notebook with nothing shared, and a private one with everything', async () => {
        await upload(['calendar'], [item('calendar:1', 'calendar', { calendar: 'Family' })]);

        const shared = await addPage(await notebook(true), 'calendar');
        expect(shared.deviceFilter).toEqual({});
        const empty = await view(creator, shared.id, 'calendar');
        expect(empty.items).toEqual([]);
        expect(empty.access).toMatchObject({
            canManage: true,
            ownerName: 'Alex',
            shared: true,
            filterSummary: 'Nothing yet',
        });
        expect((await view(member, shared.id, 'calendar')).items).toEqual([]);

        const solo = await addPage(await notebook(false), 'calendar');
        expect(solo.deviceFilter).toBeUndefined();
        const all = await view(creator, solo.id, 'calendar');
        expect(ids(all)).toEqual(['calendar:1']);
        expect(all.access).toMatchObject({ canManage: true, shared: false });
        expect(all.access.filterSummary).toBeUndefined();
    });

    it('keeps an older page without a filter owner-only, even in a shared notebook', async () => {
        await upload(['imessage'], [item('imessage:1', 'imessage', { thread: 'Family' })]);
        const notebookId = await notebook(true);
        const page = await createPageFixture({
            userId: creator.id,
            notebookId,
            type: 'devicedata' as never,
        });
        await testDb!
            .collection('pages')
            .updateOne({ _id: page._id }, { $set: { deviceSource: 'imessage' } });

        expect(ids(await view(creator, page.id, 'imessage'))).toEqual(['imessage:1']);
        const response = await call(
            member,
            `/api/device-data/items?source=imessage&pageId=${page.id}`,
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ ownerOnly: true });
    });

    // MARK: - Permissions

    it('lets members view a page, and only its creator rename, filter, move or remove it', async () => {
        await upload(['calendar'], [item('calendar:1', 'calendar', { calendar: 'Family' })]);
        const notebookId = await notebook(true);
        const page = await addPage(notebookId, 'calendar');
        await setFilter(page.id, { calendars: ['Family'] });

        const seen = await view(member, page.id, 'calendar');
        expect(ids(seen)).toEqual(['calendar:1']);
        expect(seen.access).toMatchObject({ canManage: false, ownerName: 'Alex' });
        expect(seen.collector).toBeNull(); // the creator's device isn't shown to others

        const other = await testDb!.collection('notebooks').insertOne({
            type: 'folder',
            value: 'mixed',
            label: 'Elsewhere',
            sharing: { sharedWith: [{ userId: member.id, accessLevel: 'owner' }] },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const attempts = [
            call(member, `/api/pages/${page.id}`, 'PATCH', { title: 'Mine now' }),
            call(member, `/api/pages/${page.id}`, 'PUT', { title: 'Mine now' }),
            call(member, `/api/pages/${page.id}`, 'PATCH', {
                notebookId: other.insertedId.toString(),
            }),
            call(member, `/api/pages/${page.id}/trash`, 'POST'),
            call(member, `/api/pages/${page.id}`, 'DELETE'),
            call(member, `/api/device-data/pages/${page.id}`, 'PATCH', {
                deviceFilter: { includeAll: true },
            }),
            call(member, `/api/device-data/pages/${page.id}/options`),
        ];
        for (const response of await Promise.all(attempts)) expect(response.status).toBe(403);

        const stored = await testDb!.collection('pages').findOne({ id: page.id });
        expect(stored).toMatchObject({
            title: 'Data',
            isTrashed: false,
            deviceFilter: { calendars: ['Family'] },
            notebookId: new ObjectId(notebookId),
        });

        const renamed = await json(
            call(creator, `/api/device-data/pages/${page.id}`, 'PATCH', {
                title: 'Family calendar',
                description: 'School, sports and pickups',
            }),
        );
        expect(renamed.page).toMatchObject({
            title: 'Family calendar',
            description: 'School, sports and pickups',
        });
        expect((await call(creator, `/api/pages/${page.id}/trash`, 'POST')).status).toBe(200);
    });

    it("gives the creator the choices for a page's filter from their own data", async () => {
        await upload(
            ['calendar', 'mail', 'imessage'],
            [
                item('calendar:1', 'calendar', { calendar: 'Family' }),
                item('calendar:2', 'calendar', { calendar: 'Work', occurredAt: now - 60 }),
                item('mail:1', 'mail', { mailbox: 'INBOX' }),
                item('imessage:1', 'imessage', { thread: 'Family' }),
            ],
        );
        const page = await addPage(await notebook(true), 'calendar');
        const { options } = await json(call(creator, `/api/device-data/pages/${page.id}/options`));
        expect(options).toMatchObject({
            calendars: ['Work', 'Family'],
            mailboxes: ['INBOX'],
            chats: ['Family'],
        });
    });

    // MARK: - Filters in the page view and its search

    it('shows only the chosen calendars, mailboxes and chats, in the view, search and item lookups', async () => {
        await upload(
            ['calendar', 'mail', 'imessage'],
            [
                item('calendar:family', 'calendar', { calendar: 'Family' }),
                item('calendar:work', 'calendar', { calendar: 'Work' }),
                item('mail:label', 'mail', { mailbox: 'Kids' }),
                item('mail:inbox', 'mail', { mailbox: 'INBOX' }),
                item('imessage:family', 'imessage', { thread: 'Family' }),
                item('imessage:boss', 'imessage', { thread: 'Boss' }),
            ],
        );
        const notebookId = await notebook(true);
        const cases: Array<[MacDataSource, DeviceDataFilter, string]> = [
            ['calendar', { calendars: ['Family'] }, 'calendar:family'],
            ['mail', { mailboxes: ['Kids'] }, 'mail:label'],
            ['imessage', { chats: ['Family'] }, 'imessage:family'],
        ];
        for (const [source, filter, allowed] of cases) {
            const page = await addPage(notebookId, source);
            await setFilter(page.id, filter);
            for (const who of [creator, member]) {
                expect(ids(await view(who, page.id, source))).toEqual([allowed]);
                // The search box only searches inside the filter.
                expect(ids(await view(who, page.id, source, 'practice'))).toEqual([allowed]);
            }
            const blocked = {
                calendar: 'calendar:work',
                mail: 'mail:inbox',
                imessage: 'imessage:boss',
            }[source as 'calendar' | 'mail' | 'imessage'];
            expect(
                (await call(member, `/api/device-data/items/${blocked}?pageId=${page.id}`)).status,
            ).toBe(404);
            expect(
                (await call(member, `/api/device-data/items/${allowed}?pageId=${page.id}`)).status,
            ).toBe(200);
        }
    });

    it('limits Places to time windows and leaves out named places', async () => {
        await upload(
            ['location'],
            [
                item('location:morning', 'location', {
                    occurredAt: todayAt(8),
                    extra: { place: 'School' },
                }),
                item('location:work', 'location', {
                    occurredAt: todayAt(10),
                    extra: { place: 'Somewhere', lat: 40.7, lon: -74.0 },
                }),
                item('location:night', 'location', {
                    occurredAt: todayAt(22),
                    extra: { place: 'Gym' },
                }),
            ],
        );
        const { place } = await json(
            call(creator, '/api/about-me/places', 'POST', {
                name: 'Work',
                lat: 40.7001,
                lon: -74.0001,
            }),
        );
        const page = await addPage(await notebook(true), 'location');
        await setFilter(page.id, {
            includeAll: true,
            timeWindows: [{ start: '07:00', end: '12:00' }],
            excludePlaceIds: [place.id],
        });
        // The 10:00 visit is at Work (by distance), the 22:00 one is outside the window.
        expect(ids(await view(member, page.id, 'location'))).toEqual(['location:morning']);
        const access = (await view(creator, page.id, 'location')).access;
        expect(access.filterSummary).toBe('Visits starting 07:00–12:00, not at Work');
    });

    it('shares Contacts and Health only with the include-all switch', async () => {
        await upload(
            ['contacts', 'health'],
            [item('contacts:1', 'contacts'), item('health:1', 'health')],
        );
        const notebookId = await notebook(true);
        for (const source of ['contacts', 'health'] as const) {
            const page = await addPage(notebookId, source);
            expect((await view(member, page.id, source)).items).toEqual([]);
            await setFilter(page.id, { includeAll: true });
            expect(ids(await view(member, page.id, source))).toEqual([`${source}:1`]);
        }
    });

    // MARK: - Bots

    it("gives a member's own bot the creator's filtered slice, and outside bots nothing", async () => {
        await upload(
            ['calendar'],
            [
                item('calendar:family', 'calendar', { calendar: 'Family' }),
                item('calendar:work', 'calendar', { calendar: 'Work' }),
            ],
        );
        const notebookId = await notebook(true);
        const page = await addPage(notebookId, 'calendar');
        await call(creator, `/api/device-data/pages/${page.id}`, 'PATCH', {
            title: 'Family calendar',
            description: 'School and sports',
            deviceFilter: { calendars: ['Family'] },
        });

        const ctx = await getMacDataToolContext(member.id, notebookId, {
            id: 'bot-sam',
            name: 'Sam bot',
            ownerId: member.id,
        });
        expect(ctx?.sources).toEqual(['calendar']);
        const search = JSON.parse(
            await executeMacDataTool(ctx!, 'search_local_data', { query: 'practice' }),
        );
        expect(search.results.map((r: { id: string }) => r.id)).toEqual(['calendar:family']);
        expect(search.results[0]).toMatchObject({ page: 'Family calendar', sharedBy: 'Alex' });
        const listing = JSON.parse(await executeMacDataTool(ctx!, 'search_local_data', {}));
        expect(listing.results.map((r: { id: string }) => r.id)).toEqual(['calendar:family']);
        expect(await executeMacDataTool(ctx!, 'get_local_item', { id: 'calendar:work' })).toBe(
            'No item with that id.',
        );
        expect(
            JSON.parse(await executeMacDataTool(ctx!, 'get_local_item', { id: 'calendar:family' })),
        ).toMatchObject({ id: 'calendar:family', sharedBy: 'Alex' });
        const { macDataSystemPrompt } = await import('../../services/mac-data-tools.service');
        expect(macDataSystemPrompt(ctx!)).toContain(
            '"Family calendar" (calendar events, Alex\'s, shared here; shares: Only the Family calendar) — School and sports',
        );

        // A bot someone outside the notebook shared in never reads device data.
        expect(
            await getMacDataToolContext(member.id, notebookId, {
                id: 'bot-x',
                name: 'Outside',
                ownerId: new ObjectId().toString(),
            }),
        ).toBeNull();

        // With nothing shared yet, a member's bot sees no data from the page.
        await setFilter(page.id, {});
        const none = await getMacDataToolContext(member.id, notebookId, {
            id: 'bot-sam',
            name: 'Sam bot',
            ownerId: member.id,
        });
        expect(none?.sources ?? []).toEqual([]);
    });

    it("reads the creator's own page without a filter exactly as before", async () => {
        await upload(
            ['calendar'],
            [
                item('calendar:family', 'calendar', { calendar: 'Family' }),
                item('calendar:work', 'calendar', { calendar: 'Work' }),
            ],
        );
        const notebookId = await notebook(false);
        await addPage(notebookId, 'calendar');
        const ctx = await getMacDataToolContext(creator.id, notebookId, {
            id: 'bot-alex',
            name: 'Alex bot',
            ownerId: creator.id,
        });
        const search = JSON.parse(await executeMacDataTool(ctx!, 'search_local_data', {}));
        expect(search.results.map((r: { id: string }) => r.id).sort()).toEqual([
            'calendar:family',
            'calendar:work',
        ]);
        expect(search.results[0].sharedBy).toBeUndefined();
    });
});
