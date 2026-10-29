import { SqliteDatabase } from '../../db/sqlite/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import type { CalendarProposal, ChatEvent } from '@maple/shared';

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
import { attachProposals, withProposalCards } from '../../services/calendar-proposal.service';
import { macDataRelay } from '../../services/mac-data-relay.service';
import { broadcastChatEvent } from '../../services/realtime.service';

const DAY = 24 * 60 * 60 * 1000;

describe.runIf(mongoAvailable)('Add to calendar', () => {
    let app: ReturnType<typeof createTestApp>;
    let owner: { id: string; token: string };
    let member: { id: string; token: string };
    let outsider: { id: string; token: string };
    let notebookId: string;

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
    const json = async (response: Promise<Response>) => (await response).json();

    async function person(displayName: string) {
        const user = await createUserFixture({ displayName });
        const id = user._id.toString();
        return { id, token: await createAuthToken(id) };
    }

    /** The owner's Mac, collecting their calendar. */
    async function registerMac(deviceId = 'mac-one-1', sources = ['calendar']) {
        await call(owner, '/api/collectors', 'POST', {
            deviceId,
            platform: 'macos',
            name: `Mac ${deviceId}`,
            sources,
            timeZone: 'America/New_York',
        });
    }

    async function botContext(who = owner, inNotebook = notebookId): Promise<MacDataToolContext> {
        const ctx = await getMacDataToolContext(who.id, inNotebook, {
            id: 'bot-1',
            name: 'Maple',
            ownerId: who.id,
        });
        return ctx!;
    }

    const pizzaParty = {
        title: "Greyson's soccer pizza party",
        start: '2026-10-28T15:00',
        end: '2026-10-28T16:00',
        location: 'The Commons',
        notes: 'pickup 4:15–4:30, bring jersey',
    };

    /** A bot proposes the party and its card is posted in message `msg-1`. */
    async function propose(input: Record<string, unknown> = pizzaParty): Promise<string> {
        const ctx = await botContext();
        const result = await executeMacDataTool(ctx, 'propose_calendar_event', input);
        expect(result).toContain('Proposed');
        const id = ctx.proposedEvents![0]!;
        await attachProposals([id], 'chat-page', 'msg-1');
        return id;
    }

    const view = async (who: { token: string }, id: string) =>
        (await json(call(who, `/api/calendar-proposals/${id}`))).proposal as CalendarProposal;
    const confirm = (who: { token: string }, id: string) =>
        call(who, `/api/calendar-proposals/${id}/confirm`, 'POST');
    const actions = async (deviceId = 'mac-one-1') =>
        (await json(call(owner, `/api/collectors/${deviceId}/actions`))).actions as Array<{
            id: string;
            type: string;
            event: { title: string; start: number };
        }>;
    const report = (id: string, body: unknown, deviceId = 'mac-one-1') =>
        call(owner, `/api/collectors/${deviceId}/actions/${id}/result`, 'POST', body);
    const broadcasts = () =>
        vi
            .mocked(broadcastChatEvent)
            .mock.calls.map(([, event]) => event as ChatEvent)
            .filter((event) => event.action === 'calendar_proposal_updated')
            .map((event) => (event.data as CalendarProposal).status);

    beforeEach(async () => {
        vi.clearAllMocks();
        app = createTestApp();
        owner = await person('Alex');
        member = await person('Sam');
        outsider = await person('Pat');
        notebookId = (
            await createNotebookFixture({
                createdBy: owner.id,
                sharedWith: [
                    { userId: owner.id, accessLevel: 'owner' },
                    { userId: member.id, accessLevel: 'write' },
                ],
            })
        )._id.toString();
        await registerMac();
        const created = await call(owner, '/api/pages', 'POST', {
            type: 'devicedata',
            deviceSource: 'calendar',
            title: 'Calendar',
            notebookId,
        });
        // In a shared notebook a data page shares nothing, even with its owner's bots, until they choose.
        const { page } = await created.json();
        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { includeAll: true },
        });
    });

    // MARK: - Proposing

    it('gives the owner’s bot a propose tool and saves the event in their time zone', async () => {
        const ctx = await botContext();
        expect(macDataToolDefinitions(ctx).map((tool) => tool.name)).toContain(
            'propose_calendar_event',
        );
        const id = await propose();
        const proposal = await view(owner, id);
        expect(proposal).toMatchObject({
            status: 'proposed',
            canConfirm: true,
            messageId: 'msg-1',
            event: {
                title: "Greyson's soccer pizza party",
                location: 'The Commons',
                notes: 'pickup 4:15–4:30, bring jersey',
                timeZone: 'America/New_York',
            },
        });
        // 3:00 PM in New York on Oct 28, 2026 (EDT, UTC-4).
        expect(proposal.event.start).toBe(Date.UTC(2026, 9, 28, 19) / 1000);
        expect(proposal.event.end - proposal.event.start).toBe(3600);
    });

    it('offers the same event once and rejects bad input', async () => {
        const ctx = await botContext();
        await executeMacDataTool(ctx, 'propose_calendar_event', pizzaParty);
        const again = await executeMacDataTool(ctx, 'propose_calendar_event', {
            ...pizzaParty,
            title: "  greyson's SOCCER pizza party ",
        });
        expect(again).toContain('already proposed');
        expect(new Set(ctx.proposedEvents).size).toBe(1);
        expect(
            await executeMacDataTool(ctx, 'propose_calendar_event', { title: 'X', start: 'soon' }),
        ).toMatch(/^Error/);
        expect(
            await executeMacDataTool(ctx, 'propose_calendar_event', {
                title: 'X',
                start: '2026-10-28T15:00',
                end: '2026-10-28T14:00',
            }),
        ).toMatch(/^Error: end/);
        expect(await testDb!.collection('calendar_proposals').countDocuments()).toBe(1);
    });

    it('proposes all-day events from a bare date', async () => {
        const id = await propose({ title: 'Field trip', start: '2026-10-30' });
        const { event } = await view(owner, id);
        expect(event.allDay).toBe(true);
        expect(event.end - event.start).toBe(24 * 60 * 60);
    });

    it("doesn't give the tool to bots reading someone else's calendar", async () => {
        const ctx = await getMacDataToolContext(member.id, notebookId, {
            id: 'bot-2',
            name: 'Sam’s bot',
            ownerId: member.id,
        });
        // Sam's bot can read Alex's shared calendar, but can't propose events for it.
        expect(ctx!.sources).toEqual(['calendar']);
        expect(macDataToolDefinitions(ctx!).map((t) => t.name)).not.toContain(
            'propose_calendar_event',
        );
        expect(await executeMacDataTool(ctx!, 'propose_calendar_event', pizzaParty)).toBe(
            'Unknown tool: propose_calendar_event',
        );
    });

    it('attaches cards from saved proposals only, after any blocks the bot wrote', async () => {
        const id = await propose();
        const ui = await withProposalCards(
            { version: 1, format: 'openui', blocks: [{ type: 'text', content: 'Hi' }] },
            [id, id, 'b3c4a7d2-0000-4000-8000-000000000000'],
        );
        expect(ui!.blocks.map((block) => block.type)).toEqual(['text', 'event_proposal']);
        expect(ui!.blocks[1]).toMatchObject({ proposalId: id, event: { title: pizzaParty.title } });
    });

    // MARK: - Permissions

    it('shows the card to members, but only the calendar owner can confirm', async () => {
        const id = await propose();
        expect(await view(member, id)).toMatchObject({ status: 'proposed', canConfirm: false });
        expect((await call(outsider, `/api/calendar-proposals/${id}`)).status).toBe(404);

        expect((await confirm(member, id)).status).toBe(403);
        expect((await confirm(outsider, id)).status).toBe(404);
        expect((await view(owner, id)).status).toBe('proposed');
        expect(await actions()).toEqual([]);
    });

    it('stops the owner confirming once they leave the notebook', async () => {
        const id = await propose();
        await testDb!
            .collection('notebooks')
            .updateOne(
                {},
                { $set: { 'sharing.sharedWith': [{ userId: member.id, accessLevel: 'owner' }] } },
            );
        expect((await confirm(owner, id)).status).toBe(404);
    });

    // MARK: - The full flow

    it('goes proposed → adding → added, and the Mac gets the action exactly once', async () => {
        const id = await propose();

        const tapped = (await json(confirm(owner, id))).proposal as CalendarProposal;
        expect(tapped).toMatchObject({
            status: 'adding',
            device: { name: 'Mac mac-one-1', offline: false },
        });
        expect(macDataRelay.request).toHaveBeenCalledWith(owner.id, 'runActions', {}, 5000);
        // A second tap (double click) doesn't queue it again.
        expect((await json(confirm(owner, id))).proposal.status).toBe('adding');

        const first = await actions();
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
            id,
            type: 'create_event',
            event: { title: pizzaParty.title },
        });
        // Not reported yet (say the Mac crashed): offered again with the same id.
        expect((await actions()).map((a) => a.id)).toEqual([id]);

        const itemId = `calendar:ABC-123@${first[0]!.event.start}`;
        const done = (await json(report(id, { ok: true, eventIdentifier: 'EK-1', itemId })))
            .proposal as CalendarProposal;
        expect(done).toMatchObject({ status: 'added', itemId });
        // Reporting again (a retry after a lost reply) changes nothing.
        expect(
            (await json(report(id, { ok: true, eventIdentifier: 'EK-2', itemId: 'calendar:x@1' })))
                .proposal,
        ).toMatchObject({ status: 'added', itemId });
        expect((await json(report(id, { ok: false, error: 'late' }))).proposal.status).toBe(
            'added',
        );
        expect(await actions()).toEqual([]);
        expect(await view(member, id)).toMatchObject({ status: 'added', itemId });

        expect(broadcasts()).toEqual(['adding', 'adding', 'added']);
        const stored = await testDb!.collection('calendar_proposals').findOne({ _id: id as never });
        expect(stored).toMatchObject({ eventIdentifier: 'EK-1', deviceId: 'mac-one-1' });
    });

    it('only gives actions to the Mac collecting the calendar, and only it can report', async () => {
        const id = await propose();
        await registerMac('mac-two-2', ['imessage']);
        await confirm(owner, id);
        expect(await actions('mac-two-2')).toEqual([]);
        expect((await call(owner, '/api/collectors/unknown-device/actions')).status).toBe(404);
        expect(await actions('mac-one-1')).toHaveLength(1);
        expect((await report(id, { ok: true }, 'mac-two-2')).status).toBe(404);
        // Another user can't see or report it.
        expect(
            (
                await call(outsider, `/api/collectors/mac-one-1/actions/${id}/result`, 'POST', {
                    ok: true,
                })
            ).status,
        ).toBe(404);
        expect((await view(owner, id)).status).toBe('adding');
    });

    it('shows the reason when the Mac fails, and a new tap tries again', async () => {
        const id = await propose();
        await confirm(owner, id);
        await actions();
        const failed = (await json(report(id, { ok: false, error: 'Calendar is read-only' })))
            .proposal;
        expect(failed).toMatchObject({ status: 'failed', error: 'Calendar is read-only' });

        expect((await json(confirm(owner, id))).proposal.status).toBe('adding');
        expect((await actions()).map((a) => a.id)).toEqual([id]);
    });

    it('fails with a reason when no Mac collects the calendar', async () => {
        await call(owner, '/api/collectors/mac-one-1', 'PATCH', { activeSources: [] });
        const id = await propose();
        const result = (await json(confirm(owner, id))).proposal as CalendarProposal;
        expect(result.status).toBe('failed');
        expect(result.error).toContain('No Mac is collecting your calendar');
    });

    it('says the Mac is away after 10 minutes without hearing from it', async () => {
        const id = await propose();
        await confirm(owner, id);
        await testDb!
            .collection('collectors')
            .updateOne(
                { deviceId: 'mac-one-1' },
                { $set: { lastSeenAt: new Date(Date.now() - 11 * 60 * 1000) } },
            );
        expect((await view(owner, id)).device).toMatchObject({
            name: 'Mac mac-one-1',
            offline: true,
        });
        // Listing actions counts as being seen.
        await actions();
        expect((await view(owner, id)).device?.offline).toBe(false);
    });

    // MARK: - Expiry

    it('expires proposals nobody tapped after 7 days', async () => {
        const id = await propose();
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: id as never }, { $set: { expiresAt: new Date(Date.now() - 1) } });
        expect((await view(owner, id)).status).toBe('expired');
        expect((await confirm(owner, id)).status).toBe(409);
        expect(await actions()).toEqual([]);
    });

    it('expires actions the Mac never picked up, but still records a late success', async () => {
        const id = await propose();
        await confirm(owner, id);
        const coll = testDb!.collection('calendar_proposals');
        const confirmed = await coll.findOne({ _id: id as never });
        expect(confirmed!.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * DAY - 60_000);

        await actions();
        await coll.updateOne(
            { _id: id as never },
            { $set: { expiresAt: new Date(Date.now() - 1) } },
        );
        expect(await actions()).toEqual([]);
        expect((await view(owner, id)).status).toBe('expired');
        // The Mac added it just before: the event exists, so the card says so.
        expect((await json(report(id, { ok: true, itemId: 'calendar:A@1' }))).proposal.status).toBe(
            'added',
        );
    });

    // MARK: - Review fixes

    it('creates the indexes its queries need, and sorts in code (Cosmos needs an index to sort)', async () => {
        const { createIndexes } =
            await vi.importActual<typeof import('../../db/client')>('../../db/client');
        // A separate database: these indexes would outlive the other suites' cleanup.
        const storage = new SqliteDatabase(':memory:');
        await storage.ready;
        const scratch = storage.asRepositoryDatabase();
        try {
            await createIndexes(scratch);
            const keys = (await scratch.collection('calendar_proposals').indexes()).map(
                (i) => i.key,
            );
            expect(keys).toEqual(
                expect.arrayContaining([
                    { userId: 1, status: 1 },
                    { userId: 1, 'event.start': 1 },
                ]),
            );
        } finally {
            await storage.close();
        }

        // Two taps in order; the Mac gets the older one first.
        const first = await propose();
        const second = await propose({
            ...pizzaParty,
            title: 'Practice',
            start: '2026-10-29T17:00',
            end: '2026-10-29T18:00',
        });
        await confirm(owner, second);
        await confirm(owner, first);
        const coll = testDb!.collection('calendar_proposals');
        await coll.updateOne({ _id: first as never }, { $set: { confirmedAt: new Date(1000) } });
        expect((await actions()).map((a) => a.id)).toEqual([first, second]);
    });

    it('gives an action unreported for 15 minutes to the Mac now collecting the calendar', async () => {
        const id = await propose();
        await confirm(owner, id);
        expect(await actions()).toHaveLength(1);
        await registerMac('mac-two-2', ['calendar']);
        await call(owner, '/api/collectors/mac-two-2', 'PATCH', { activeSources: ['calendar'] });

        // Mac one stopped collecting: its action goes back to the queue right away.
        expect((await view(owner, id)).device?.name).toBe('Mac mac-two-2');
        expect((await actions('mac-two-2')).map((a) => a.id)).toEqual([id]);
        expect(await actions()).toEqual([]);

        // Mac two goes quiet for 15 minutes: offered again (to whichever Mac collects it).
        await testDb!
            .collection('calendar_proposals')
            .updateOne(
                { _id: id as never },
                { $set: { deliveredAt: new Date(Date.now() - 16 * 60 * 1000) } },
            );
        expect((await actions('mac-two-2')).map((a) => a.id)).toEqual([id]);

        // A late success from the first Mac still counts; the second then has nothing to do.
        expect((await json(report(id, { ok: true, itemId: 'calendar:A@1' }))).proposal.status).toBe(
            'added',
        );
        expect(await actions('mac-two-2')).toEqual([]);
        // Only the Mac holding it can report a failure.
        expect(
            (await json(report(id, { ok: false, error: 'x' }, 'mac-two-2'))).proposal.status,
        ).toBe('added');
    });

    it('nudges the Mac again when the owner taps while it is still adding', async () => {
        const id = await propose();
        await confirm(owner, id);
        vi.mocked(macDataRelay.request).mockClear();
        expect((await json(confirm(owner, id))).proposal.status).toBe('adding');
        expect(macDataRelay.request).toHaveBeenCalledWith(owner.id, 'runActions', {}, 5000);
        expect(await actions()).toHaveLength(1);
    });

    it('tells open cards when a proposal expires', async () => {
        const id = await propose();
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: id as never }, { $set: { expiresAt: new Date(Date.now() - 1) } });
        // Any read or poll catches it up, and the card is told.
        await actions();
        expect(broadcasts()).toEqual(['expired']);
        expect((await view(member, id)).status).toBe('expired');
        expect(broadcasts()).toEqual(['expired']);
    });

    it("doesn't offer an event again that is open in another chat or already added", async () => {
        const id = await propose();
        const otherNotebook = (await createNotebookFixture({ createdBy: owner.id }))._id.toString();
        await call(owner, '/api/pages', 'POST', {
            type: 'devicedata',
            deviceSource: 'calendar',
            title: 'Calendar',
            notebookId: otherNotebook,
        });
        const elsewhere = await botContext(owner, otherNotebook);
        expect(await executeMacDataTool(elsewhere, 'propose_calendar_event', pizzaParty)).toContain(
            'another chat',
        );
        expect(elsewhere.proposedEvents ?? []).toEqual([]);

        await confirm(owner, id);
        await actions();
        await report(id, { ok: true, itemId: 'calendar:A@1' });
        const again = await botContext();
        expect(await executeMacDataTool(again, 'propose_calendar_event', pizzaParty)).toContain(
            'already added',
        );
        expect(again.proposedEvents ?? []).toEqual([]);
        expect(await testDb!.collection('calendar_proposals').countDocuments()).toBe(1);
    });
});
