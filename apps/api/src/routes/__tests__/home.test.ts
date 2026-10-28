import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import type {
    ChatEvent,
    DeviceDataFilter,
    HomeProposal,
    MacDataItem,
    MacDataSource,
} from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));
vi.mock('../../services/mac-data-relay.service', () => ({
    macDataRelay: {
        isOnline: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(true),
    },
}));
vi.mock('../../services/realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
    executeMacDataTool,
    getMacDataToolContext,
    macDataToolDefinitions,
    type MacDataToolContext,
} from '../../services/mac-data-tools.service';
import { attachHomeProposalCards, withHomeProposalCards } from '../../services/home.service';
import { isNews } from '../../services/device-data.service';
import { purgeExpiredDeviceItems } from '../../repositories/device-item.repo';
import { macDataRelay } from '../../services/mac-data-relay.service';
import { broadcastChatEvent } from '../../services/realtime.service';

const now = Math.floor(Date.now() / 1000);

/** A Home item as the Mac uploads it: current state, or one change (`@time`). */
function entity(
    entityId: string,
    state: string,
    extra: Record<string, unknown> = {},
    at?: number,
): MacDataItem {
    const name = entityId
        .split('.')[1]!
        .split('_')
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(' ');
    return {
        id: at ? `home:${entityId}@${at}` : `home:${entityId}`,
        source: 'home',
        revision: `${state}-${at ?? 0}`,
        occurredAt: at ?? now - 3600,
        title: name,
        participants: [],
        body: `${name} is ${state}`,
        extra: { entityId, domain: entityId.split('.')[0], state, ...extra },
    };
}

const kitchen = entity('light.kitchen', 'on', { area: 'Kitchen' });
const porch = entity('light.porch', 'off', { area: 'Outside' });
const frontDoor = entity('lock.front_door', 'locked', { area: 'Entry' });
const garage = entity('cover.garage_door', 'closed', { area: 'Garage', deviceClass: 'garage' });
const temperature = entity('sensor.living_room_temperature', '21.5', {
    area: 'Living Room',
    unit: '°C',
    deviceClass: 'temperature',
});
const alex = entity('person.alex', 'home');
const phone = entity('device_tracker.alex_phone', 'home');
const kitchenChange = entity(
    'light.kitchen',
    'on',
    { area: 'Kitchen', from: 'off', kind: 'change' },
    now - 600,
);
const everything = [kitchen, porch, frontDoor, garage, temperature, alex, phone, kitchenChange];
const exposedIds = everything
    .map((item) => item.extra!['entityId'] as string)
    .filter((id, i, all) => all.indexOf(id) === i);

describe.runIf(mongoAvailable)('Home Assistant', () => {
    let app: ReturnType<typeof createTestApp>;
    let owner: { id: string; token: string };
    let member: { id: string; token: string };

    const call = (who: { token: string }, path: string, method = 'GET', body?: unknown) =>
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = async (response: Promise<Response>): Promise<any> => (await response).json();

    async function person(displayName: string) {
        const user = await createUserFixture({ displayName });
        const id = user._id.toString();
        return { id, token: await createAuthToken(id) };
    }

    /** The owner's Mac collects these sources. */
    async function registerMac(deviceId: string, sources: MacDataSource[]) {
        await call(owner, '/api/collectors', 'POST', {
            deviceId,
            platform: 'macos',
            name: `Mac ${deviceId}`,
            sources,
            timeZone: 'America/New_York',
        });
        await call(owner, `/api/collectors/${deviceId}`, 'PATCH', { activeSources: sources });
    }

    const expose = (entityIds: string[], deviceId = 'home-mac-1') =>
        call(owner, '/api/home/exposure', 'PUT', { deviceId, entityIds });

    async function upload(items: MacDataItem[], deviceId = 'home-mac-1') {
        const result = await json(
            call(owner, '/api/device-data/items', 'POST', {
                deviceId,
                upserts: items,
                removals: [],
            }),
        );
        expect(result.stored).toBe(items.length);
    }

    async function notebook(shared: boolean) {
        const doc = await createNotebookFixture({
            createdBy: owner.id,
            sharedWith: [
                { userId: owner.id, accessLevel: 'owner' },
                ...(shared ? [{ userId: member.id, accessLevel: 'write' as const }] : []),
            ],
        });
        return doc._id.toString();
    }

    async function homePage(notebookId: string, filter?: DeviceDataFilter) {
        const { page } = await json(
            call(owner, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: 'home',
                title: 'Home',
                notebookId,
            }),
        );
        if (filter)
            await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
                deviceFilter: filter,
            });
        return page as { id: string; deviceFilter?: DeviceDataFilter };
    }

    const pageIds = async (who: { token: string }, pageId: string) =>
        (
            (await json(call(who, `/api/device-data/items?source=home&pageId=${pageId}`))).items as
                | MacDataItem[]
                | undefined
        )
            ?.map((item) => item.id)
            .sort() ?? [];

    async function botContext(notebookId: string): Promise<MacDataToolContext> {
        return (await getMacDataToolContext(owner.id, notebookId, {
            id: 'bot-1',
            name: 'Maple',
            ownerId: owner.id,
        }))!;
    }

    const homeStates = async (ctx: MacDataToolContext, input: Record<string, unknown> = {}) =>
        JSON.parse(await executeMacDataTool(ctx, 'get_home_states', input)) as {
            entities: Array<{ entity_id: string; state: string; area?: string }>;
            changes: Array<{ entity_id: string; from: string; to: string }>;
        };

    beforeEach(async () => {
        vi.clearAllMocks();
        app = createTestApp();
        owner = await person('Alex');
        member = await person('Sam');
        await registerMac('home-mac-1', ['home']);
        expect((await expose(exposedIds)).status).toBe(200);
        await upload(everything);
    });

    // MARK: - Source and exposure

    it('stores Home items, and shows only entities that are still exposed without deleting the rest', async () => {
        const own = async () =>
            (
                (await json(call(owner, '/api/device-data/items?source=home&limit=50')))
                    .items as MacDataItem[]
            )
                .map((item) => item.id)
                .sort();
        expect(await own()).toHaveLength(everything.length);

        await expose(exposedIds.filter((id) => id !== 'light.kitchen'));
        expect(await own()).not.toContain('home:light.kitchen');
        expect(await own()).not.toContain(kitchenChange.id);
        const single = await call(owner, '/api/device-data/items/home:light.kitchen');
        expect(single.status).toBe(404);
        // Kept, just hidden: exposing it again brings it back.
        expect(await testDb!.collection('device_items').countDocuments({ source: 'home' })).toBe(
            everything.length,
        );
        await expose(exposedIds);
        expect(await own()).toContain('home:light.kitchen');
    });

    it('shows nothing without an exposure list, and takes it only from the Mac collecting Home', async () => {
        await testDb!.collection('home_exposure').deleteMany({});
        const notebookId = await notebook(false);
        const page = await homePage(notebookId);
        expect(await pageIds(owner, page.id)).toEqual([]);

        await registerMac('calendar-mac', ['calendar']);
        const refused = await expose(['light.kitchen'], 'calendar-mac');
        expect(refused.status).toBe(409);
        const invalid = await expose(['not an entity']);
        expect(invalid.status).toBe(422);
    });

    it('keeps current states past the retention window, but lets old changes go', async () => {
        const old = now - 40 * 24 * 60 * 60;
        await upload([
            { ...entity('switch.fountain', 'off'), occurredAt: old },
            entity('switch.fountain', 'on', { from: 'off' }, old),
        ]);
        await purgeExpiredDeviceItems();
        const ids = (await testDb!.collection('device_items').find({}).toArray()).map(
            (doc) => doc.id as string,
        );
        expect(ids).toContain('home:switch.fountain');
        expect(ids).not.toContain(`home:switch.fountain@${old}`);
        expect(isNews(kitchenChange, 'added')).toBe(false);
    });

    // MARK: - Pages

    it('lists current states and changes separately when asked', async () => {
        const ids = async (kind: string, extra = '') =>
            (
                (
                    await json(
                        call(owner, `/api/device-data/items?source=home&homeKind=${kind}${extra}`),
                    )
                ).items as MacDataItem[]
            ).map((item) => item.id);
        const states = await ids('state');
        expect(states).toHaveLength(everything.length - 1);
        expect(states).not.toContain(kitchenChange.id);
        expect(await ids('change')).toEqual([kitchenChange.id]);
        const notebookId = await notebook(false);
        const page = await homePage(notebookId, { includeAll: true });
        expect(await ids('change', `&pageId=${page.id}`)).toEqual([kitchenChange.id]);
        // Paging counts states only.
        const first = await json(
            call(owner, '/api/device-data/items?source=home&homeKind=state&limit=2'),
        );
        expect(first.items).toHaveLength(2);
        expect(first.total).toBe(everything.length - 1);
    });

    it('starts with nothing shared in a shared notebook, then shares entities or areas', async () => {
        const notebookId = await notebook(true);
        const page = await homePage(notebookId);
        expect(page.deviceFilter).toEqual({});
        expect(await pageIds(member, page.id)).toEqual([]);

        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: {
                homeAreas: ['Kitchen'],
                homeEntities: ['sensor.living_room_temperature'],
            },
        });
        expect(await pageIds(member, page.id)).toEqual(
            [kitchen.id, kitchenChange.id, temperature.id].sort(),
        );
        const { access } = await json(
            call(member, `/api/device-data/items?source=home&pageId=${page.id}`),
        );
        expect(access.filterSummary).toBe('Devices in Kitchen, and 1 chosen device');
    });

    it("never shares who's home by default, even with everything shared", async () => {
        const notebookId = await notebook(true);
        const page = await homePage(notebookId, { includeAll: true });
        const shared = await pageIds(member, page.id);
        expect(shared).toContain(kitchen.id);
        expect(shared).not.toContain(alex.id);
        expect(shared).not.toContain(phone.id);

        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { includeAll: true, includePresence: true },
        });
        expect(await pageIds(member, page.id)).toContain(alex.id);

        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { homeEntities: ['person.alex'] },
        });
        expect(await pageIds(member, page.id)).toEqual([alex.id]);
    });

    it('offers exposed entities and their areas as filter choices', async () => {
        await expose(exposedIds.filter((id) => id !== 'light.porch'));
        const page = await homePage(await notebook(true));
        const { options } = await json(call(owner, `/api/device-data/pages/${page.id}/options`));
        const ids = options.homeEntities.map((e: { id: string }) => e.id);
        expect(ids).toContain('light.kitchen');
        expect(ids).not.toContain('light.porch');
        expect(options.homeAreas).toEqual(['Entry', 'Garage', 'Kitchen', 'Living Room']);
    });

    // MARK: - Bots

    it("reads shared states and changes, and hides who's home from bots on a page without a filter", async () => {
        const notebookId = await notebook(false);
        await homePage(notebookId);
        const ctx = await botContext(notebookId);
        const names = macDataToolDefinitions(ctx).map((tool) => tool.name);
        expect(names).toContain('get_home_states');
        expect(names).toContain('propose_home_action');

        const all = await homeStates(ctx);
        const ids = all.entities.map((e) => e.entity_id);
        expect(ids).toContain('light.kitchen');
        expect(ids).not.toContain('person.alex');
        expect(ids).not.toContain('device_tracker.alex_phone');
        expect(all.changes).toEqual([
            expect.objectContaining({ entity_id: 'light.kitchen', from: 'off', to: 'on' }),
        ]);

        const kitchenOnly = await homeStates(ctx, { query: 'kitchen' });
        expect(kitchenOnly.entities.map((e) => e.entity_id)).toEqual(['light.kitchen']);
        const sensors = await homeStates(ctx, { domain: 'sensor' });
        expect(sensors.entities).toEqual([
            expect.objectContaining({ entity_id: 'sensor.living_room_temperature', state: '21.5' }),
        ]);
    });

    it('gives bots in a shared notebook only what the filter shares', async () => {
        const notebookId = await notebook(true);
        const page = await homePage(notebookId);
        // Nothing shared yet: the bot gets no Home tools (no data tools at all here).
        const before = await getMacDataToolContext(owner.id, notebookId, {
            id: 'bot-1',
            name: 'Maple',
            ownerId: owner.id,
        });
        expect(before ? macDataToolDefinitions(before).map((t) => t.name) : []).not.toContain(
            'get_home_states',
        );
        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { homeAreas: ['Kitchen', 'Garage'] },
        });
        const states = await homeStates(await botContext(notebookId));
        expect(states.entities.map((e) => e.entity_id).sort()).toEqual([
            'cover.garage_door',
            'light.kitchen',
        ]);
    });

    // MARK: - Proposals and the action queue

    describe('proposals', () => {
        let notebookId: string;
        let ctx: MacDataToolContext;

        beforeEach(async () => {
            notebookId = await notebook(true);
            await homePage(notebookId, { includeAll: true });
            ctx = await botContext(notebookId);
        });

        async function propose(input: Record<string, unknown>): Promise<string> {
            const result = await executeMacDataTool(ctx, 'propose_home_action', input);
            expect(result).toContain('Proposed');
            const id = ctx.proposedHomeActions!.at(-1)!;
            await attachHomeProposalCards([id], 'chat-page', 'msg-1');
            return id;
        }
        const view = async (who: { token: string }, id: string) =>
            (await json(call(who, `/api/home-proposals/${id}`))).proposal as HomeProposal;
        const confirm = (who: { token: string }, id: string, body?: unknown) =>
            call(who, `/api/home-proposals/${id}/confirm`, 'POST', body);
        const actions = async (deviceId = 'home-mac-1') =>
            (await json(call(owner, `/api/collectors/${deviceId}/actions`))).actions as Array<{
                id: string;
                type: string;
                source: string;
                call: { entityId: string; service: string; data?: Record<string, unknown> };
            }>;
        const report = (id: string, body: unknown, deviceId = 'home-mac-1') =>
            call(owner, `/api/collectors/${deviceId}/actions/${id}/result`, 'POST', body);

        it('only proposes allowed services on exposed, shared devices in control domains', async () => {
            const tryIt = (input: Record<string, unknown>) =>
                executeMacDataTool(ctx, 'propose_home_action', input);
            expect(
                await tryIt({ entity_id: 'sensor.living_room_temperature', service: 'turn_on' }),
            ).toMatch(/only be read/);
            expect(await tryIt({ entity_id: 'person.alex', service: 'turn_on' })).toMatch(
                /no shared, exposed device/,
            );
            expect(await tryIt({ entity_id: 'light.kitchen', service: 'explode' })).toMatch(
                /supports turn_on/,
            );
            expect(
                await tryIt({ entity_id: 'light.kitchen', service: 'turn_on', value: 400 }),
            ).toMatch(/between 0 and 100/);
            await expose(exposedIds.filter((id) => id !== 'light.porch'));
            expect(await tryIt({ entity_id: 'light.porch', service: 'turn_on' })).toMatch(
                /no shared, exposed device/,
            );
            expect(await testDb!.collection('home_proposals').countDocuments()).toBe(0);
        });

        it('queues a tapped action for the Mac collecting Home, which reports it done', async () => {
            await registerMac('calendar-mac', ['calendar']);
            const id = await propose({ entity_id: 'light.kitchen', service: 'turn_on', value: 80 });
            const card = await view(member, id);
            expect(card).toMatchObject({
                status: 'proposed',
                canConfirm: false,
                summary: 'Turn on Kitchen at 80%',
                call: {
                    entityId: 'light.kitchen',
                    service: 'turn_on',
                    data: { brightness_pct: 80 },
                },
            });
            const blocks = await withHomeProposalCards(undefined, [id]);
            expect(blocks?.blocks[0]).toMatchObject({ type: 'home_proposal', proposalId: id });

            expect((await confirm(member, id)).status).toBe(403);
            expect(await actions()).toEqual([]);
            const tapped = await json(confirm(owner, id));
            expect(tapped.proposal.status).toBe('running');
            expect(macDataRelay.request).toHaveBeenCalledWith(owner.id, 'runActions', {}, 5_000);

            expect(await actions('calendar-mac')).toEqual([]);
            const pending = await actions();
            expect(pending).toEqual([
                expect.objectContaining({ id, type: 'home_service', source: 'home' }),
            ]);
            // Listed again until it reports: the Mac's ledger keeps it from running twice.
            expect(await actions()).toHaveLength(1);

            expect((await report(id, { ok: true })).status).toBe(200);
            expect((await view(owner, id)).status).toBe('done');
            expect((await report(id, { ok: false, error: 'late' })).status).toBe(200);
            expect((await view(owner, id)).status).toBe('done');
            expect(await actions()).toEqual([]);
            const statuses = vi
                .mocked(broadcastChatEvent)
                .mock.calls.map(([, event]) => event as ChatEvent)
                .filter((event) => event.action === 'home_proposal_updated')
                .map((event) => (event.data as HomeProposal).status);
            expect(statuses).toEqual(['running', 'running', 'done']);
        });

        it('asks twice for locks and garage doors', async () => {
            const lock = await propose({ entity_id: 'lock.front_door', service: 'unlock' });
            expect((await view(owner, lock)).call.sensitive).toBe(true);
            expect((await confirm(owner, lock)).status).toBe(428);
            expect((await view(owner, lock)).status).toBe('proposed');
            expect((await json(confirm(owner, lock, { acknowledged: true }))).proposal.status).toBe(
                'running',
            );
            const door = await propose({ entity_id: 'cover.garage_door', service: 'open_cover' });
            expect((await confirm(owner, door)).status).toBe(428);
        });

        it('asks twice for scenes, scripts and switches that open a garage or gate', async () => {
            const extra = [
                entity('scene.movie_night', 'scening', { area: 'Living Room' }),
                entity('script.leave_home', 'off'),
                entity('switch.garage_opener', 'off', { area: 'Garage' }),
                entity('switch.kettle', 'off', { area: 'Kitchen' }),
            ];
            await upload(extra);
            await expose([
                ...exposedIds,
                ...extra.map((item) => item.extra!['entityId'] as string),
            ]);
            ctx = await botContext(notebookId);
            for (const [entityId, service] of [
                ['scene.movie_night', 'turn_on'],
                ['script.leave_home', 'turn_on'],
                ['switch.garage_opener', 'turn_on'],
            ] as const) {
                const id = await propose({ entity_id: entityId, service });
                expect((await view(owner, id)).call.sensitive).toBe(true);
                expect((await confirm(owner, id)).status).toBe(428);
            }
            ctx = await botContext(notebookId); // three proposals per reply
            const kettle = await propose({ entity_id: 'switch.kettle', service: 'turn_on' });
            expect((await view(owner, kettle)).call.sensitive).toBeUndefined();
            expect((await json(confirm(owner, kettle))).proposal.status).toBe('running');
        });

        it('rejects inherited object keys as services', async () => {
            const result = await executeMacDataTool(ctx, 'propose_home_action', {
                entity_id: 'light.kitchen',
                service: 'constructor',
            });
            expect(result).toMatch(/supports turn_on/);
        });

        it('refuses a tap once the entity is no longer exposed, and fails without a Home Mac', async () => {
            const id = await propose({ entity_id: 'light.porch', service: 'turn_on' });
            await expose(exposedIds.filter((entityId) => entityId !== 'light.porch'));
            const refused = await confirm(owner, id);
            expect(refused.status).toBe(409);
            expect((await refused.json()).error).toMatch(/no longer exposed/);

            await expose(exposedIds);
            await call(owner, '/api/collectors/home-mac-1', 'PATCH', { activeSources: [] });
            const failed = await json(confirm(owner, id));
            expect(failed.proposal.status).toBe('failed');
            expect(failed.proposal.error).toMatch(/No Mac is connected to Home Assistant/);
        });

        it('lets a failed action be tried again, and expires actions the Mac never ran', async () => {
            const id = await propose({
                entity_id: 'switch.unknown_thing',
                service: 'turn_on',
            }).catch(() => null);
            expect(id).toBeNull();
            const fan = await propose({ entity_id: 'light.kitchen', service: 'turn_off' });
            await confirm(owner, fan);
            await actions();
            await report(fan, { ok: false, error: 'Light.kitchen is no longer exposed' });
            expect(await view(owner, fan)).toMatchObject({
                status: 'failed',
                error: 'Light.kitchen is no longer exposed',
            });
            expect((await json(confirm(owner, fan))).proposal.status).toBe('running');
            await testDb!
                .collection('home_proposals')
                .updateOne(
                    { _id: fan as never },
                    { $set: { expiresAt: new Date(Date.now() - 1000) } },
                );
            expect(await actions()).toEqual([]);
            expect((await view(owner, fan)).status).toBe('expired');
        });

        it('shows the same open action once', async () => {
            await propose({ entity_id: 'light.kitchen', service: 'turn_off' });
            const again = await executeMacDataTool(ctx, 'propose_home_action', {
                entity_id: 'light.kitchen',
                service: 'turn_off',
            });
            expect(again).toContain('already proposed');
            expect(await testDb!.collection('home_proposals').countDocuments()).toBe(1);
        });
    });
});
