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
import { handleDeviceDataChanges } from '../../services/proactive-bot.service';
import { flushDeviceNews } from '../../services/device-data.service';
import { realtimeWSService } from '../../services/realtime-ws.service';

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

    /** The creator's (or someone's) device uploads these items. */
    async function upload(sources: MacDataSource[], items: MacDataItem[], who = creator) {
        await call(who, '/api/collectors', 'POST', {
            deviceId: `device-${who.id}`,
            platform: 'macos',
            name: 'Test Mac',
            sources,
            timeZone: 'America/New_York',
        });
        await call(who, `/api/collectors/device-${who.id}`, 'PATCH', {
            activeSources: sources,
        });
        const result = await json(
            call(who, '/api/device-data/items', 'POST', {
                deviceId: `device-${who.id}`,
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

    async function addPage(notebookId: string, source: MacDataSource, who = creator) {
        const { page } = await json(
            call(who, '/api/pages', 'POST', {
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
        await setFilter(page.id, { calendars: [{ name: 'Family' }] });

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
            deviceFilter: { calendars: [{ name: 'Family' }] },
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
            calendars: [{ name: 'Work' }, { name: 'Family' }],
            mailboxes: ['INBOX'],
            chats: [{ name: 'Family' }],
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
            ['calendar', { calendars: [{ name: 'Family' }] }, 'calendar:family'],
            ['mail', { mailboxes: ['Kids'] }, 'mail:label'],
            ['imessage', { chats: [{ name: 'Family' }] }, 'imessage:family'],
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
            deviceFilter: { calendars: [{ name: 'Family' }] },
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

    // MARK: - Review fixes

    const botOf = (who: { id: string }) => ({ id: `bot-${who.id}`, name: 'Bot', ownerId: who.id });
    const botSources = async (who: { id: string }, notebookId: string) =>
        (await getMacDataToolContext(who.id, notebookId, botOf(who)))?.sources ?? [];

    it('shares nothing from a trashed or archived page, while its creator still sees it', async () => {
        await upload(['calendar'], [item('calendar:1', 'calendar', { calendar: 'Family' })]);
        const notebookId = await notebook(true);
        const page = await addPage(notebookId, 'calendar');
        await setFilter(page.id, { calendars: [{ name: 'Family' }] });
        expect(ids(await view(member, page.id, 'calendar'))).toEqual(['calendar:1']);

        for (const flag of ['isTrashed', 'isArchived']) {
            await testDb!
                .collection('pages')
                .updateOne({ id: page.id }, { $set: { [flag]: true } });
            expect(
                (await call(member, `/api/device-data/items?source=calendar&pageId=${page.id}`))
                    .status,
            ).toBe(403);
            expect(
                (await call(member, `/api/device-data/items/calendar:1?pageId=${page.id}`)).status,
            ).toBe(404);
            expect(await botSources(member, notebookId)).toEqual([]);
            expect(await botSources(creator, notebookId)).toEqual([]);
            expect(ids(await view(creator, page.id, 'calendar'))).toEqual(['calendar:1']);
            await testDb!
                .collection('pages')
                .updateOne({ id: page.id }, { $set: { [flag]: false } });
        }
    });

    it('names excluded places only to the creator', async () => {
        await upload(['location'], [item('location:1', 'location', { occurredAt: todayAt(8) })]);
        const { place } = await json(
            call(creator, '/api/about-me/places', 'POST', { name: 'Work', lat: 40.7, lon: -74 }),
        );
        const page = await addPage(await notebook(true), 'location');
        await setFilter(page.id, { includeAll: true, excludePlaceIds: [place.id] });
        expect((await view(creator, page.id, 'location')).access.filterSummary).toBe(
            'All visits, not at Work',
        );
        expect((await view(member, page.id, 'location')).access.filterSummary).toBe(
            'All visits, not at a place',
        );
    });

    it("gives bots nothing from an unfiltered page once its notebook is shared, the creator's too", async () => {
        await upload(['calendar'], [item('calendar:1', 'calendar', { calendar: 'Family' })]);
        const notebookId = await notebook(false);
        const page = await addPage(notebookId, 'calendar');
        expect(page.deviceFilter).toBeUndefined();
        expect(await botSources(creator, notebookId)).toEqual(['calendar']);

        // The notebook is shared later: the page has no filter yet.
        await testDb!.collection('notebooks').updateOne(
            { _id: new ObjectId(notebookId) },
            {
                $push: {
                    'sharing.sharedWith': { userId: member.id, accessLevel: 'write' },
                } as never,
            },
        );
        expect(await botSources(creator, notebookId)).toEqual([]);
        expect(await botSources(member, notebookId)).toEqual([]);
        // The creator's own view still shows everything, marked as not shared.
        const own = await view(creator, page.id, 'calendar');
        expect(ids(own)).toEqual(['calendar:1']);
        expect(own.access).toMatchObject({ canManage: true, shared: true });
        expect(own.access.filterSummary).toBeUndefined();
        expect(
            (await call(member, `/api/device-data/items?source=calendar&pageId=${page.id}`)).status,
        ).toBe(403);

        // Proactive news for that notebook stops too.
        vi.mocked(handleDeviceDataChanges).mockClear();
        await newsFor(notebookId, [item('calendar:2', 'calendar', { calendar: 'Family' })]);
        expect(handleDeviceDataChanges).not.toHaveBeenCalled();
    });

    /** A proactive chat in the notebook, and fresh calendar items as news. */
    async function newsFor(notebookId: string, items: MacDataItem[]) {
        const chat = await createPageFixture({ userId: creator.id, notebookId, type: 'message' });
        await testDb!.collection('pages').updateOne(
            { _id: chat._id },
            {
                $set: {
                    proactive: {
                        userBotId: new ObjectId().toString(),
                        instructions: '',
                        enabled: true,
                        ownerUserId: creator.id,
                        updatedAt: new Date(),
                    },
                },
            },
        );
        await testDb!
            .collection('collectors')
            .updateOne(
                { deviceId: `device-${creator.id}` },
                { $set: { 'activeSince.calendar': new Date(Date.now() - 3600_000) } },
            );
        await upload(['calendar'], items);
        await flushDeviceNews(creator.id);
    }

    it("sends proactive news only for items the notebook's page shares", async () => {
        await upload(['calendar'], [item('calendar:0', 'calendar', { calendar: 'Family' })]);
        const notebookId = await notebook(false);
        const page = await addPage(notebookId, 'calendar');
        await setFilter(page.id, { calendars: [{ name: 'Family' }] });
        vi.mocked(handleDeviceDataChanges).mockClear();
        await newsFor(notebookId, [
            item('calendar:family', 'calendar', { calendar: 'Family' }),
            item('calendar:work', 'calendar', { calendar: 'Work' }),
        ]);
        expect(handleDeviceDataChanges).toHaveBeenCalledTimes(1);
        const [, batches] = vi.mocked(handleDeviceDataChanges).mock.calls[0]!;
        expect(batches[0]!.entries.map((e) => e.item.id)).toEqual(['calendar:family']);
    });

    it('hides the pages of someone who left, and lets only them delete those pages', async () => {
        await upload(
            ['calendar'],
            [item('calendar:sam', 'calendar', { calendar: 'Home' })],
            member,
        );
        const notebookId = await notebook(true);
        const page = await addPage(notebookId, 'calendar', member);
        await json(
            call(member, `/api/device-data/pages/${page.id}`, 'PATCH', {
                deviceFilter: { includeAll: true },
            }),
        );
        expect(ids(await view(creator, page.id, 'calendar'))).toEqual(['calendar:sam']);
        expect(await botSources(member, notebookId)).toEqual(['calendar']);

        // The notebook's owner removes the member.
        expect(
            (await call(creator, `/api/notebooks/${notebookId}/share/${member.id}`, 'DELETE'))
                .status,
        ).toBe(200);
        const listed = await json(call(creator, `/api/pages?notebookId=${notebookId}`));
        expect(listed.pages.map((p: { id: string }) => p.id)).not.toContain(page.id);
        expect(
            (await call(creator, `/api/device-data/items?source=calendar&pageId=${page.id}`))
                .status,
        ).toBe(404);
        expect(await botSources(creator, notebookId)).toEqual([]);
        // The removed member's own bots get nothing there either.
        expect(await getMacDataToolContext(member.id, notebookId, botOf(member))).toBeNull();
        // Nobody else can delete it; they can, wherever it is.
        expect((await call(creator, `/api/pages/${page.id}`, 'DELETE')).status).not.toBe(200);
        const left = await json(call(member, '/api/device-data/pages/left'));
        expect(left.pages.map((p: { id: string }) => p.id)).toEqual([page.id]);
        expect((await call(member, `/api/pages/${page.id}/trash`, 'POST')).status).toBe(200);
        expect((await call(member, `/api/pages/${page.id}`, 'DELETE')).status).toBe(200);
        expect(await testDb!.collection('pages').findOne({ id: page.id })).toBeNull();
    });

    it('matches calendars and chats by id, and by name for items without one', async () => {
        await upload(
            ['calendar', 'imessage'],
            [
                item('calendar:a', 'calendar', {
                    calendar: 'Family',
                    extra: { calendarId: 'cal-a' },
                }),
                item('calendar:b', 'calendar', {
                    calendar: 'Family',
                    extra: { calendarId: 'cal-b' },
                }),
                item('calendar:old', 'calendar', { calendar: 'Family' }), // before ids
                item('imessage:new', 'imessage', {
                    thread: 'Renamed',
                    extra: { chatId: 'chat-1' },
                }),
                item('imessage:old', 'imessage', {
                    thread: 'Original',
                    extra: { chatId: 'chat-1' },
                    occurredAt: now - 3600,
                }),
            ],
        );
        const notebookId = await notebook(true);
        const calendar = await addPage(notebookId, 'calendar');
        const { options } = await json(
            call(creator, `/api/device-data/pages/${calendar.id}/options`),
        );
        expect(options.calendars).toEqual(
            expect.arrayContaining([
                { id: 'cal-a', name: 'Family' },
                { id: 'cal-b', name: 'Family' },
            ]),
        );
        expect(options.calendars).toHaveLength(2); // the id-less copy isn't listed again
        expect(options.chats).toEqual([{ id: 'chat-1', name: 'Renamed' }]);

        await setFilter(calendar.id, { calendars: [{ id: 'cal-a', name: 'Family' }] });
        expect(ids(await view(member, calendar.id, 'calendar'))).toEqual([
            'calendar:a',
            'calendar:old',
        ]);
        const chats = await addPage(notebookId, 'imessage');
        await setFilter(chats.id, { chats: [{ id: 'chat-1', name: 'Original' }] });
        expect(ids(await view(member, chats.id, 'imessage'))).toEqual([
            'imessage:new',
            'imessage:old',
        ]);
    });

    it("never empties someone else's trashed data page", async () => {
        const notebookId = await notebook(true);
        const page = await addPage(notebookId, 'calendar');
        await call(creator, `/api/pages/${page.id}/trash`, 'POST');
        await call(member, '/api/pages/trash/empty', 'DELETE');
        expect(await testDb!.collection('pages').findOne({ id: page.id })).not.toBeNull();
        await call(creator, '/api/pages/trash/empty', 'DELETE');
        expect(await testDb!.collection('pages').findOne({ id: page.id })).toBeNull();
    });

    it('never publishes a data page, alone or with its notebook', async () => {
        const notebookId = await notebook(true);
        const page = await addPage(notebookId, 'calendar');
        for (const who of [creator, member]) {
            expect(
                (await call(who, `/api/pages/${page.id}/publish`, 'PATCH', { isPublished: true }))
                    .status,
            ).toBe(400);
        }
        await call(creator, `/api/notebooks/${notebookId}/public`, 'PATCH', { isPublic: true });
        const stored = await testDb!.collection('pages').findOne({ id: page.id });
        expect(stored?.isPublished).not.toBe(true);
    });

    it('resets the filter when a page moves into a shared notebook, and tells open clients', async () => {
        const send = vi.spyOn(realtimeWSService, 'sendToUsers');
        const solo = await notebook(false);
        const page = await addPage(solo, 'calendar');
        await setFilter(page.id, { includeAll: true });
        expect(send).toHaveBeenCalledWith(
            expect.arrayContaining([creator.id]),
            expect.objectContaining({
                type: 'page.updated',
                pageId: page.id,
                deviceFilter: { includeAll: true },
                description: '',
            }),
        );
        const shared = await notebook(true);
        const moved = await json(
            call(creator, `/api/pages/${page.id}`, 'PATCH', { notebookId: shared }),
        );
        expect(moved.page.deviceFilter).toEqual({});
        expect(send).toHaveBeenLastCalledWith(
            expect.arrayContaining([member.id]),
            expect.objectContaining({ type: 'page.updated', deviceFilter: {} }),
        );
        send.mockRestore();
    });

    it('leaves sharing alone when the creator only renames or describes a page', async () => {
        const notebookId = await notebook(true);
        const page = await createPageFixture({
            userId: creator.id,
            notebookId,
            type: 'devicedata' as never,
        });
        await testDb!
            .collection('pages')
            .updateOne({ _id: page._id }, { $set: { deviceSource: 'calendar' } });
        await json(
            call(creator, `/api/device-data/pages/${page.id}`, 'PATCH', {
                title: 'Renamed',
                description: 'What it is for',
            }),
        );
        const stored = await testDb!.collection('pages').findOne({ id: page.id });
        expect(stored).toMatchObject({ title: 'Renamed', description: 'What it is for' });
        expect(stored?.deviceFilter).toBeUndefined();
    });
});
