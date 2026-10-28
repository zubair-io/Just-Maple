import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createUserBotFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import {
    ALWAYS_ASK_HOME_DOMAINS,
    isAlwaysAsk,
    isSensitiveHomeService,
    type BotAction,
    type CalendarProposal,
    type ChatEvent,
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
    type MacDataToolContext,
} from '../../services/mac-data-tools.service';
import { attachProposals } from '../../services/calendar-proposal.service';
import {
    attachActions,
    decideAutonomy,
    recordAction,
    withActionReceipts,
} from '../../services/bot-action.service';
import { syncCalendarAction } from '../../services/calendar-action.service';
import {
    findProposal,
    type CalendarProposalDocument,
} from '../../repositories/calendar-proposal.repo';
import { macDataRelay } from '../../services/mac-data-relay.service';
import { broadcastChatEvent } from '../../services/realtime.service';

const HOUR = 60 * 60 * 1000;

describe.runIf(mongoAvailable)('Bot action log and autonomy', () => {
    let app: ReturnType<typeof createTestApp>;
    let owner: { id: string; token: string };
    let member: { id: string; token: string };
    let outsider: { id: string; token: string };
    let shared: string;
    let privateNotebook: string;
    let botId: string;

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

    async function calendarPage(notebookId: string) {
        const created = await call(owner, '/api/pages', 'POST', {
            type: 'devicedata',
            deviceSource: 'calendar',
            title: 'Calendar',
            notebookId,
        });
        const { page } = await created.json();
        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { includeAll: true },
        });
    }

    async function botContext(notebookId: string): Promise<MacDataToolContext> {
        return (await getMacDataToolContext(owner.id, notebookId, {
            id: botId,
            name: 'Maple',
            ownerId: owner.id,
        }))!;
    }

    const party = {
        title: 'Pizza party',
        start: '2026-10-28T15:00',
        end: '2026-10-28T16:00',
        location: 'The Commons',
    };

    /** The bot proposes the party in `notebookId`; its reply is posted as `msg-1`. */
    async function propose(notebookId = shared, input: Record<string, unknown> = party) {
        const ctx = await botContext(notebookId);
        const result = await executeMacDataTool(ctx, 'propose_calendar_event', input);
        const ids = [...(ctx.proposedEvents ?? []), ...(ctx.actionReceipts ?? [])];
        if (ctx.proposedEvents?.length)
            await attachProposals(ctx.proposedEvents, 'chat-page', 'msg-1');
        if (ids.length) await attachActions(ids, 'chat-page', 'msg-1');
        return { ctx, result, id: ids[0] };
    }

    const setAutonomy = (kind: string, autonomy: string, who = owner, bot = botId) =>
        call(who, `/api/bot-autonomy/${bot}`, 'PUT', { kind, autonomy });
    const action = async (who: { token: string }, id: string) =>
        (await json(call(who, `/api/bot-actions/${id}`))).action as BotAction;
    const botActivity = async (query = '') =>
        (await json(call(owner, `/api/bot-actions?botId=${botId}${query}`))).actions as BotAction[];
    const notebookActivity = async (who: { token: string }, notebookId = shared, query = '') =>
        (await json(call(who, `/api/bot-actions?notebookId=${notebookId}${query}`)))
            .actions as BotAction[];
    const confirm = (id: string) => call(owner, `/api/calendar-proposals/${id}/confirm`, 'POST');
    const undo = (who: { token: string }, id: string) =>
        call(who, `/api/bot-actions/${id}/undo`, 'POST');
    const macActions = async (deviceId = 'mac-one-1') =>
        (await json(call(owner, `/api/collectors/${deviceId}/actions`))).actions as Array<
            Record<string, unknown> & { id: string; type: string }
        >;
    const report = (id: string, body: unknown, deviceId = 'mac-one-1') =>
        call(owner, `/api/collectors/${deviceId}/actions/${id}/result`, 'POST', body);
    const row = (id: string) => testDb!.collection('bot_actions').findOne({ _id: id as never });
    const actionBroadcasts = () =>
        vi
            .mocked(broadcastChatEvent)
            .mock.calls.map(([, event]) => event as ChatEvent)
            .filter((event) => event.action === 'bot_action_updated')
            .map((event) => event.data as BotAction);

    /** Proposed, tapped, and added by the Mac as EK-1. */
    async function addedEvent(notebookId = shared, title = party.title): Promise<string> {
        const { id } = await propose(notebookId, { ...party, title });
        await confirm(id!);
        await macActions();
        await report(id!, { ok: true, eventIdentifier: 'EK-1', itemId: 'calendar:A@1' });
        return id!;
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        app = createTestApp();
        owner = await person('Alex');
        member = await person('Sam');
        outsider = await person('Pat');
        shared = (
            await createNotebookFixture({
                createdBy: owner.id,
                sharedWith: [
                    { userId: owner.id, accessLevel: 'owner' },
                    { userId: member.id, accessLevel: 'write' },
                ],
            })
        )._id.toString();
        privateNotebook = (await createNotebookFixture({ createdBy: owner.id }))._id.toString();
        botId = (
            await createUserBotFixture({ userId: owner.id, displayName: 'Maple' })
        )._id.toString();
        await call(owner, '/api/collectors', 'POST', {
            deviceId: 'mac-one-1',
            platform: 'macos',
            name: 'Mac one',
            sources: ['calendar'],
            timeZone: 'America/New_York',
        });
        await calendarPage(shared);
        await calendarPage(privateNotebook);
    });

    // MARK: - The log for every calendar path

    it('logs a proposal, the tap, and the Mac adding it', async () => {
        const { id } = await propose();
        expect(await row(id!)).toMatchObject({
            kind: 'calendar_add',
            ownerId: owner.id,
            botId,
            botName: 'Maple',
            notebookId: shared,
            pageId: 'chat-page',
            messageId: 'msg-1',
            status: 'proposed',
            decision: 'ask',
            params: { event: { title: 'Pizza party', location: 'The Commons' } },
        });
        expect((await row(id!))!.summary).toContain('“Pizza party” · Wed, Oct 28, 3:00');

        await confirm(id!);
        expect(await row(id!)).toMatchObject({ status: 'queued', approvedBy: owner.id });
        await macActions();
        expect((await row(id!))!.status).toBe('queued');
        await report(id!, { ok: true, eventIdentifier: 'EK-1', itemId: 'calendar:A@1' });
        const done = await action(owner, id!);
        expect(done).toMatchObject({
            status: 'done',
            isOwner: true,
            canUndo: true,
            result: { eventIdentifier: 'EK-1', itemId: 'calendar:A@1', deviceId: 'mac-one-1' },
        });
        expect(Date.parse(done.undoableUntil!) - Date.now()).toBeGreaterThan(23 * HOUR);
        expect(actionBroadcasts().map((update) => update.status)).toEqual([
            'proposed',
            'queued',
            'queued',
            'done',
        ]);
        // Broadcasts reach the whole chat: never the parameters.
        expect(actionBroadcasts().every((update) => !('params' in update))).toBe(true);
    });

    it('logs failures, Try again, and expiry', async () => {
        const { id } = await propose();
        await confirm(id!);
        await macActions();
        await report(id!, { ok: false, error: 'Calendar is read-only' });
        expect(await action(owner, id!)).toMatchObject({
            status: 'failed',
            error: 'Calendar is read-only',
        });
        await confirm(id!);
        const retried = await action(owner, id!);
        expect(retried.status).toBe('queued');
        expect(retried.error).toBeUndefined();

        const { id: other } = await propose(shared, { ...party, title: 'Practice' });
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: other as never }, { $set: { expiresAt: new Date(Date.now() - 1) } });
        expect((await botActivity()).find((a) => a.id === other)?.status).toBe('expired');
    });

    it('logs a proposal from before the log the first time it changes', async () => {
        const { id } = await propose();
        await testDb!.collection('bot_actions').deleteMany({});
        await confirm(id!);
        expect(await row(id!)).toMatchObject({ kind: 'calendar_add', status: 'queued' });
    });

    // MARK: - Autonomy

    it('asks by default and never lets a bot read or skip the settings', async () => {
        expect((await json(call(owner, `/api/bot-autonomy/${botId}`))).settings).toEqual({
            calendar_add: 'ask',
            home_service: 'ask',
            send_reply: 'ask',
        });
        expect(
            await decideAutonomy({
                ownerId: owner.id,
                botId,
                kind: 'calendar_add',
                notebookId: privateNotebook,
            }),
        ).toEqual({ autonomy: 'ask', setting: 'ask' });
        // Someone else's bot: no settings to see or change.
        expect((await call(member, `/api/bot-autonomy/${botId}`)).status).toBe(404);
        expect((await setAutonomy('calendar_add', 'auto', member)).status).toBe(404);
    });

    it('enforces the hard floors', async () => {
        // Sending is always Ask: auto can't be saved, and one saved anyway is ignored.
        expect((await setAutonomy('send_reply', 'auto')).status).toBe(400);
        expect((await setAutonomy('send_reply', 'never')).status).toBe(200);
        await testDb!
            .collection('bot_autonomy')
            .updateOne(
                { _id: `${owner.id}:${botId}` as never },
                { $set: { 'settings.send_reply': 'auto' } },
            );
        expect(
            await decideAutonomy({
                ownerId: owner.id,
                botId,
                kind: 'send_reply',
                notebookId: privateNotebook,
            }),
        ).toMatchObject({ autonomy: 'ask' });

        // Home: auto for lights, never for unlocking or opening the garage.
        expect((await setAutonomy('home_service', 'auto')).status).toBe(200);
        const home = (params: Record<string, unknown>) =>
            decideAutonomy({
                ownerId: owner.id,
                botId,
                kind: 'home_service',
                notebookId: privateNotebook,
                params,
            });
        expect(
            await home({ domain: 'light', service: 'turn_on', entityId: 'light.kitchen' }),
        ).toMatchObject({ autonomy: 'auto' });
        expect(await home({ domain: 'lock', service: 'unlock', entityId: 'lock.front' })).toEqual({
            autonomy: 'ask',
            setting: 'auto',
            lowered: 'always_ask',
        });
        expect(
            await home({ domain: 'cover', service: 'open_cover', entityId: 'cover.garage_door' }),
        ).toMatchObject({ autonomy: 'ask', lowered: 'always_ask' });

        expect(isSensitiveHomeService({ domain: 'notify', service: 'mobile_app' })).toBe(true);
        expect(isSensitiveHomeService({ entityId: 'notify.phone', service: 'send' })).toBe(true);
        expect(isSensitiveHomeService({})).toBe(true);
        expect(isAlwaysAsk('calendar_add', {})).toBe(false);
        expect(isAlwaysAsk('send_reply', {})).toBe(true);
    });

    it('takes the Home Assistant domain only from the entity id, never the bot', async () => {
        const call = (params: Record<string, unknown>, known?: Parameters<typeof isAlwaysAsk>[2]) =>
            isAlwaysAsk('home_service', params, known);
        // A bot claiming a harmless domain or device class changes nothing.
        expect(call({ domain: 'light', service: 'unlock', entityId: 'lock.front' })).toBe(true);
        expect(call({ domain: 'light', service: 'turn_on', entityId: 'script.open_all' })).toBe(
            true,
        );
        expect(call({ domain: 'light', service: 'turn_on' })).toBe(true); // No entity
        expect(call({ service: 'turn_on', entityId: 'light' })).toBe(true); // No domain in it
        expect(
            call({ service: 'open_cover', entityId: 'cover.side', deviceClass: 'curtain' }),
        ).toBe(true);
        expect(call({ service: 'turn_on', entityId: 'light.kitchen', domain: 'lock' })).toBe(false);

        // Every one of these asks unless the server vouches for the entity.
        for (const domain of [
            'homeassistant',
            'script',
            'scene',
            'button',
            'switch',
            'valve',
            'lock',
            'alarm_control_panel',
            'cover',
        ]) {
            expect(ALWAYS_ASK_HOME_DOMAINS).toContain(domain);
            const service = domain === 'lock' ? 'lock' : 'turn_on';
            expect(call({ service, entityId: `${domain}.thing` })).toBe(true);
            expect(call({ service, entityId: `${domain}.thing` }, { safe: true })).toBe(false);
        }
        // Even a "safe" entity never unlocks, disarms or opens a door on its own.
        expect(call({ service: 'unlock', entityId: 'lock.front' }, { safe: true })).toBe(true);
        expect(call({ service: 'open', entityId: 'lock.front' }, { safe: true })).toBe(true);
        expect(
            call({ service: 'alarm_disarm', entityId: 'alarm_control_panel.home' }, { safe: true }),
        ).toBe(true);
        expect(call({ service: 'open_cover', entityId: 'cover.garage_door' }, { safe: true })).toBe(
            true,
        );
        // The device class counts only when the server knows it.
        expect(
            call(
                { service: 'open_cover', entityId: 'cover.side' },
                { safe: true, deviceClass: 'garage' },
            ),
        ).toBe(true);
        expect(
            call(
                { service: 'open_cover', entityId: 'cover.blinds' },
                { safe: true, deviceClass: 'blind' },
            ),
        ).toBe(false);
        expect(call({ service: 'mobile_app', entityId: 'notify.x' }, { safe: true })).toBe(true);

        // Through decideAutonomy: the server's knowledge is an input, the bot's isn't.
        await setAutonomy('home_service', 'auto');
        const decide = (params: Record<string, unknown>, known?: { safe?: boolean }) =>
            decideAutonomy({
                ownerId: owner.id,
                botId,
                kind: 'home_service',
                notebookId: privateNotebook,
                params,
                ...(known ? { known } : {}),
            });
        expect(
            await decide({ service: 'turn_on', entityId: 'scene.movie', safe: true }),
        ).toMatchObject({ autonomy: 'ask', lowered: 'always_ask' });
        expect(
            await decide({ service: 'turn_on', entityId: 'scene.movie' }, { safe: true }),
        ).toMatchObject({ autonomy: 'auto' });
    });

    it('is auto only in the owner’s own private notebook', async () => {
        expect((await setAutonomy('calendar_add', 'auto')).status).toBe(200);
        expect(
            await decideAutonomy({
                ownerId: owner.id,
                botId,
                kind: 'calendar_add',
                notebookId: shared,
            }),
        ).toEqual({ autonomy: 'ask', setting: 'auto', lowered: 'shared_notebook' });

        // In the shared notebook the bot still only proposes: the card, no action queued.
        const { ctx, result } = await propose(shared);
        expect(result).toContain('Proposed');
        expect(ctx.actionReceipts ?? []).toEqual([]);
        expect(await macActions()).toEqual([]);

        // A notebook made public counts as shared too.
        await testDb!
            .collection('notebooks')
            .updateOne(
                { _id: new ObjectId(privateNotebook) },
                { $set: { 'sharing.isPublic': true } },
            );
        expect(
            (
                await decideAutonomy({
                    ownerId: owner.id,
                    botId,
                    kind: 'calendar_add',
                    notebookId: privateNotebook,
                })
            ).autonomy,
        ).toBe('ask');
    });

    it('never: no proposal, the bot is told, and the log says denied', async () => {
        await setAutonomy('calendar_add', 'never');
        const { ctx, result } = await propose(privateNotebook);
        expect(result).toContain('turned off');
        expect(ctx.proposedEvents ?? []).toEqual([]);
        expect(await testDb!.collection('calendar_proposals').countDocuments()).toBe(0);
        const [denied] = await botActivity();
        expect(denied).toMatchObject({ kind: 'calendar_add', status: 'denied', decision: 'never' });
        // Bots never see the setting: the tool result doesn't name it.
        expect(result).not.toMatch(/autonomy|setting/i);
    });

    // MARK: - Auto: "Done · Undo"

    it('does it without a tap and posts "Done · Undo"', async () => {
        await setAutonomy('calendar_add', 'auto');
        const { ctx, result, id } = await propose(privateNotebook);
        expect(result).toContain('Added');
        expect(ctx.proposedEvents ?? []).toEqual([]);
        expect(ctx.actionReceipts).toEqual([id]);
        expect(macDataRelay.request).toHaveBeenCalledWith(owner.id, 'runActions', {}, 5000);
        expect(await row(id!)).toMatchObject({
            status: 'queued',
            decision: 'auto',
            approvedBy: 'auto',
            messageId: 'msg-1',
        });

        const ui = await withActionReceipts(
            { version: 1, format: 'openui', blocks: [{ type: 'text', content: 'Added it.' }] },
            ctx.actionReceipts!,
        );
        expect(ui!.blocks[1]).toEqual({
            type: 'action_receipt',
            actionId: id,
            summary: expect.stringContaining('Pizza party'),
        });

        // The Mac gets it with no tap at all, then the card says Done with Undo.
        expect((await macActions()).map((a) => a.id)).toEqual([id]);
        await report(id!, { ok: true, eventIdentifier: 'EK-1', itemId: 'calendar:A@1' });
        expect(await action(owner, id!)).toMatchObject({ status: 'done', canUndo: true });
        expect(actionBroadcasts().at(-1)).toMatchObject({ id, status: 'done', messageId: 'msg-1' });
    });

    it('falls back to the card when it can’t be done (no Mac)', async () => {
        await setAutonomy('calendar_add', 'auto');
        await call(owner, '/api/collectors/mac-one-1', 'PATCH', { activeSources: [] });
        await calendarPage(privateNotebook);
        const { ctx, result, id } = await propose(privateNotebook);
        expect(result).toContain('could not be added');
        expect(ctx.proposedEvents).toEqual([id]);
        expect(ctx.actionReceipts ?? []).toEqual([]);
        expect((await row(id!))!.status).toBe('failed');
    });

    // MARK: - Undo

    it('undoes an added event through the Mac, once', async () => {
        const id = await addedEvent();
        vi.mocked(macDataRelay.request).mockClear();
        const undoing = (await json(undo(owner, id))).action as BotAction;
        expect(undoing).toMatchObject({
            status: 'done',
            canUndo: false,
            undo: { state: 'queued' },
        });
        expect(macDataRelay.request).toHaveBeenCalledWith(owner.id, 'runActions', {}, 5000);
        // A double tap doesn't queue a second removal.
        expect((await json(undo(owner, id))).action.undo.state).toBe('queued');

        const [removal] = await macActions();
        expect(removal).toMatchObject({
            type: 'delete_event',
            source: 'calendar',
            eventIdentifier: 'EK-1',
            createdBy: id,
            event: { title: 'Pizza party' },
        });
        expect(removal!.id).not.toBe(id);
        // Not reported yet (say the Mac crashed): offered again with the same id.
        expect((await macActions()).map((a) => a.id)).toEqual([removal!.id]);

        const reported = (await json(report(removal!.id, { ok: true }))).action as BotAction;
        expect(reported).toMatchObject({ status: 'undone', undo: { state: 'done' } });
        expect(await macActions()).toEqual([]);
        // Reported again: nothing changes.
        expect((await json(report(removal!.id, { ok: true }))).action.status).toBe('undone');
        // The chat card says it was removed, and a late repeat of the add doesn't bring it back.
        const card = (await json(call(owner, `/api/calendar-proposals/${id}`)))
            .proposal as CalendarProposal;
        expect(card.status).toBe('removed');
        await report(id, { ok: true, eventIdentifier: 'EK-1', itemId: 'calendar:A@1' });
        expect((await action(owner, id)).status).toBe('undone');

        // The bot doesn't offer it again.
        const again = await propose();
        expect(again.result).toContain('removed it again');
    });

    it('keeps the event when the Mac can’t remove it, and lets the owner try again', async () => {
        const id = await addedEvent();
        await undo(owner, id);
        const [removal] = await macActions();
        await report(removal!.id, { ok: false, error: 'Not added by Just Maple' });
        expect(await action(owner, id)).toMatchObject({
            status: 'done',
            canUndo: true,
            undo: { state: 'failed', error: 'Not added by Just Maple' },
        });
        await undo(owner, id);
        expect((await macActions()).map((a) => a.type)).toEqual(['delete_event']);
    });

    it('offers undo for 24 hours, only to the owner, only on their Mac', async () => {
        const id = await addedEvent();
        expect((await undo(member, id)).status).toBe(403);
        expect((await undo(outsider, id)).status).toBe(404);
        await undo(owner, id);
        const [removal] = await macActions();
        await call(owner, '/api/collectors', 'POST', {
            deviceId: 'mac-two-2',
            platform: 'macos',
            name: 'Mac two',
            sources: ['imessage'],
            timeZone: 'America/New_York',
        });
        expect(await macActions('mac-two-2')).toEqual([]);
        expect((await report(removal!.id, { ok: true }, 'mac-two-2')).status).toBe(404);

        const later = await addedEvent(privateNotebook, 'Bake sale');
        await testDb!
            .collection('bot_actions')
            .updateOne(
                { _id: later as never },
                { $set: { completedAt: new Date(Date.now() - 25 * HOUR) } },
            );
        expect((await action(owner, later)).canUndo).toBe(false);
        expect((await undo(owner, later)).status).toBe(409);

        const { id: open } = await propose(shared, { ...party, title: 'Not yet' });
        expect((await undo(owner, open!)).status).toBe(409);
    });

    // MARK: - Review fixes

    it('never moves a row back, whatever order the syncs arrive in', async () => {
        const id = await addedEvent();
        const stale = (await findProposal(id))!;
        // A sync carrying an older copy (queued) arrives after the Mac's report.
        await syncCalendarAction({ ...stale, status: 'queued' } as CalendarProposalDocument);
        expect((await row(id))!.status).toBe('done');

        // Undone, then the proposal itself looks queued again: the row stays undone.
        await undo(owner, id);
        const [removal] = await macActions();
        await report(removal!.id, { ok: true });
        expect((await row(id))!.status).toBe('undone');
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: id as never }, { $set: { status: 'queued' } });
        await syncCalendarAction((await findProposal(id))!);
        expect((await row(id))!.status).toBe('undone');

        // Expired and denied are ends too.
        const { id: other } = await propose(shared, { ...party, title: 'Practice' });
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: other as never }, { $set: { expiresAt: new Date(Date.now() - 1) } });
        await botActivity();
        expect((await row(other!))!.status).toBe('expired');
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: other as never }, { $set: { status: 'failed' } });
        await syncCalendarAction((await findProposal(other!))!);
        expect((await row(other!))!.status).toBe('expired');
    });

    it('Try again is the owner’s approval, not the setting’s', async () => {
        await setAutonomy('calendar_add', 'auto');
        await call(owner, '/api/collectors/mac-one-1', 'PATCH', { activeSources: [] });
        const { id } = await propose(privateNotebook);
        expect(await row(id!)).toMatchObject({
            status: 'failed',
            decision: 'auto',
            approvedBy: 'auto',
        });
        await call(owner, '/api/collectors/mac-one-1', 'PATCH', { activeSources: ['calendar'] });
        await confirm(id!);
        expect(await row(id!)).toMatchObject({
            status: 'queued',
            decision: 'ask',
            approvedBy: owner.id,
        });
        // A requeue of an automatic add keeps `auto`.
        const { id: autoId } = await propose(privateNotebook, { ...party, title: 'Bake sale' });
        await macActions();
        await testDb!
            .collection('calendar_proposals')
            .updateOne(
                { _id: autoId as never },
                { $set: { deliveredAt: new Date(Date.now() - 16 * 60 * 1000) } },
            );
        await botActivity();
        expect(await row(autoId!)).toMatchObject({ decision: 'auto', approvedBy: 'auto' });
    });

    it('dates rows for proposals from before the log by the proposal', async () => {
        const { id } = await propose();
        const proposedAt = new Date(Date.now() - 3 * 24 * HOUR);
        await testDb!.collection('bot_actions').deleteMany({});
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: id as never }, { $set: { createdAt: proposedAt } });
        const { id: newer } = await propose(shared, { ...party, title: 'Practice' });
        await confirm(id!);
        expect((await row(id!))!.createdAt).toEqual(proposedAt);
        // Newest first: the old proposal doesn't jump to the top.
        expect((await botActivity()).map((a) => a.id)).toEqual([newer, id]);
    });

    it('Never: one row per bot and event, and none for events already added', async () => {
        const added = await addedEvent(privateNotebook);
        await setAutonomy('calendar_add', 'never');
        // Already added: the bot is told so, nothing is logged as denied.
        expect((await propose(privateNotebook)).result).toContain('already added');
        expect(await testDb!.collection('bot_actions').countDocuments({ status: 'denied' })).toBe(
            0,
        );

        // The same email seen 12 times: one denied row.
        for (let i = 0; i < 12; i++)
            await propose(privateNotebook, { ...party, title: 'Swim meet' });
        const denied = await testDb!.collection('bot_actions').find({ status: 'denied' }).toArray();
        expect(denied).toHaveLength(1);
        // Different events are different rows, and they don't push the rest out.
        for (let i = 0; i < 5; i++)
            await propose(privateNotebook, { ...party, title: `Game ${i}` });
        expect((await botActivity('&limit=3')).map((a) => a.status)).toEqual([
            'denied',
            'denied',
            'denied',
        ]);
        expect((await botActivity('&status=done&limit=1')).map((a) => a.id)).toEqual([added]);
        expect((await botActivity('&kind=calendar_add&status=denied')).length).toBe(6);
    });

    it('applies visibility and filters before the limit', async () => {
        const posted = await addedEvent();
        // Newer rows the member can't see.
        for (let i = 0; i < 5; i++)
            await recordAction({
                kind: 'home_service',
                ownerId: owner.id,
                botId,
                notebookId: shared,
                summary: `Light ${i}`,
                params: { entityId: 'light.kitchen' },
            });
        expect((await notebookActivity(member, shared, '&limit=1')).map((a) => a.id)).toEqual([
            posted,
        ]);
        expect(
            (await notebookActivity(owner, shared, '&kind=calendar_add&limit=1')).map((a) => a.id),
        ).toEqual([posted]);
        expect((await notebookActivity(owner, shared, '&limit=2')).length).toBe(2);
    });

    it('says when the Mac couldn’t find the event, and lets the bot offer it again', async () => {
        const id = await addedEvent();
        await undo(owner, id);
        const [removal] = await macActions();
        const reported = (await json(report(removal!.id, { ok: true, outcome: 'not_found' })))
            .action as BotAction;
        expect(reported).toMatchObject({
            status: 'done',
            canUndo: false,
            undo: { state: 'not_found' },
        });
        // Repeated: nothing changes, and no second Undo.
        await report(removal!.id, { ok: true });
        expect((await action(owner, id)).undo?.state).toBe('not_found');
        expect((await json(undo(owner, id))).error).toBeDefined();
        const card = (await json(call(owner, `/api/calendar-proposals/${id}`)))
            .proposal as CalendarProposal;
        expect(card.status).toBe('not_found');
        // It isn't on the calendar: the bot may propose it again.
        const again = await propose();
        expect(again.result).toContain('Proposed');
        expect(again.id).not.toBe(id);
    });

    it('sends the undo to the Mac that added the event, or says it couldn’t', async () => {
        // A second Mac; only one collects the calendar at a time (mac-one-1 here).
        await call(owner, '/api/collectors', 'POST', {
            deviceId: 'mac-two-2',
            platform: 'macos',
            name: 'Mac two',
            sources: ['calendar'],
            timeZone: 'America/New_York',
        });
        const moveCalendarTo = (deviceId: string) =>
            call(owner, `/api/collectors/${deviceId}`, 'PATCH', { activeSources: ['calendar'] });

        const id = await addedEvent(); // Added by mac-one-1
        const queued = (await json(undo(owner, id))).action as BotAction;
        expect(queued.undo).toMatchObject({ state: 'queued', deviceName: 'Mac one' });
        expect(queued.undo).not.toHaveProperty('fallback');
        expect(await macActions('mac-two-2')).toEqual([]);
        const [removal] = await macActions('mac-one-1');
        expect(removal).toMatchObject({ type: 'delete_event', eventIdentifier: 'EK-1' });
        await report(removal!.id, { ok: true });
        expect((await action(owner, id)).status).toBe('undone');

        // The calendar moved to the other Mac before the undo: that one, and say so.
        const later = await addedEvent(shared, 'Bake sale');
        await moveCalendarTo('mac-two-2');
        const fallback = (await json(undo(owner, later))).action as BotAction;
        expect(fallback.undo).toMatchObject({ deviceName: 'Mac two', fallback: true });
        expect(await macActions('mac-one-1')).toEqual([]);
        expect((await macActions('mac-two-2')).map((a) => a.createdBy)).toEqual([later]);

        // It moves after the undo was queued for the Mac that added it: rerouted, and said so.
        await moveCalendarTo('mac-one-1');
        const third = await addedEvent(shared, 'Recital');
        expect((await json(undo(owner, third))).action.undo.deviceName).toBe('Mac one');
        await moveCalendarTo('mac-two-2');
        expect((await macActions('mac-two-2')).map((a) => a.createdBy)).toContain(third);
        expect((await action(owner, third)).undo).toMatchObject({
            state: 'delivered',
            deviceName: 'Mac two',
            fallback: true,
        });
    });

    it('an older Mac refusing delete_event leaves the event and lets the owner retry', async () => {
        const id = await addedEvent();
        await undo(owner, id);
        const [removal] = await macActions();
        // What a Mac from before undo reports for an action type it doesn't know.
        await report(removal!.id, {
            ok: false,
            error: 'This Mac doesn\'t know how to do "delete_event". Update Just Maple.',
        });
        expect(await action(owner, id)).toMatchObject({
            status: 'done',
            canUndo: true,
            undo: { state: 'failed', error: expect.stringContaining('Update Just Maple') },
        });
        // Not offered again until the owner taps Undo again; the card still says added.
        expect(await macActions()).toEqual([]);
        const card = (await json(call(owner, `/api/calendar-proposals/${id}`)))
            .proposal as CalendarProposal;
        expect(card.status).toBe('added');
        await undo(owner, id);
        expect((await macActions()).map((a) => a.type)).toEqual(['delete_event']);
    });

    it('cancels an automatic add before the Mac takes it', async () => {
        await setAutonomy('calendar_add', 'auto');
        const { id } = await propose(privateNotebook);
        expect(await action(owner, id!)).toMatchObject({ status: 'queued', canCancel: true });
        expect((await call(member, `/api/bot-actions/${id}/cancel`, 'POST')).status).toBe(404);
        const cancelled = (await json(call(owner, `/api/bot-actions/${id}/cancel`, 'POST')))
            .action as BotAction;
        expect(cancelled).toMatchObject({ status: 'denied', canCancel: false, canUndo: false });
        expect(await macActions()).toEqual([]);
        expect((await findProposal(id!))!.status).toBe('cancelled');
        // Repeated: same answer. The bot doesn't offer it again.
        expect((await call(owner, `/api/bot-actions/${id}/cancel`, 'POST')).status).toBe(200);
        expect((await propose(privateNotebook)).result).toContain('cancelled');
        // Done actions can't be cancelled.
        const done = await addedEvent(shared, 'Bake sale');
        expect((await call(owner, `/api/bot-actions/${done}/cancel`, 'POST')).status).toBe(409);
    });

    it('cancel after the Mac took it undoes it once it is added', async () => {
        await setAutonomy('calendar_add', 'auto');
        const { id } = await propose(privateNotebook);
        expect((await macActions()).map((a) => a.id)).toEqual([id]);
        const cancelling = (await json(call(owner, `/api/bot-actions/${id}/cancel`, 'POST')))
            .action as BotAction;
        expect(cancelling).toMatchObject({ status: 'queued', canCancel: false });
        expect(cancelling.cancelRequestedAt).toBeDefined();
        await report(id!, { ok: true, eventIdentifier: 'EK-7', itemId: 'calendar:A@7' });
        expect(await action(owner, id!)).toMatchObject({
            status: 'done',
            undo: { state: 'queued' },
        });
        const removal = (await macActions()).find((a) => a.type === 'delete_event');
        expect(removal).toMatchObject({ eventIdentifier: 'EK-7', createdBy: id });
        await report(removal!.id, { ok: true });
        expect((await action(owner, id!)).status).toBe('undone');
    });

    it('reading one card catches up only that card', async () => {
        const done = await addedEvent();
        const { id: open } = await propose(shared, { ...party, title: 'Practice' });
        await testDb!
            .collection('calendar_proposals')
            .updateOne({ _id: open as never }, { $set: { expiresAt: new Date(Date.now() - 1) } });
        await action(owner, done);
        expect((await findProposal(open!))!.status).toBe('proposed');
        expect((await action(owner, open!)).status).toBe('expired');
    });

    // MARK: - Expiry of other kinds

    it('expires open actions of kinds without their own lifecycle', async () => {
        const doc = await recordAction({
            kind: 'home_service',
            ownerId: owner.id,
            botId,
            notebookId: privateNotebook,
            summary: 'Turn on the kitchen lights',
            params: { domain: 'light', service: 'turn_on', entityId: 'light.kitchen' },
            expiresAt: new Date(Date.now() - 1),
        });
        const fresh = await recordAction({
            kind: 'home_service',
            ownerId: owner.id,
            botId,
            notebookId: privateNotebook,
            summary: 'Turn off the porch light',
            params: {},
            expiresAt: new Date(Date.now() + HOUR),
        });
        const list = await botActivity('&kind=home_service');
        expect(list.find((a) => a.id === doc._id)?.status).toBe('expired');
        expect(list.find((a) => a.id === fresh._id)?.status).toBe('proposed');
        expect((await botActivity('&kind=home_service&status=expired')).map((a) => a.id)).toEqual([
            doc._id,
        ]);
    });

    // MARK: - Reading the log

    it('lists newest first and filters by kind and status', async () => {
        const first = await addedEvent();
        const { id: second } = await propose(shared, { ...party, title: 'Practice' });
        await testDb!
            .collection('bot_actions')
            .updateOne(
                { _id: first as never },
                { $set: { createdAt: new Date(Date.now() - HOUR) } },
            );
        expect((await botActivity()).map((a) => a.id)).toEqual([second, first]);
        expect((await botActivity('&status=done')).map((a) => a.id)).toEqual([first]);
        expect(await botActivity('&kind=send_reply')).toEqual([]);
        expect((await call(owner, `/api/bot-actions?botId=${botId}&status=bogus`)).status).toBe(
            422,
        );
        expect((await call(owner, '/api/bot-actions')).status).toBe(400);
    });

    it('shows other members only summaries of actions posted in their chat', async () => {
        const posted = await addedEvent();
        // An action in the shared notebook that was never posted anywhere.
        const unposted = await recordAction({
            kind: 'home_service',
            ownerId: owner.id,
            botId,
            notebookId: shared,
            summary: 'Turn on the kitchen lights',
            params: { entityId: 'light.kitchen' },
        });

        const mine = await notebookActivity(owner);
        expect(mine.map((a) => a.id).sort()).toEqual([posted, unposted._id].sort());
        expect(mine.find((a) => a.id === posted)).toMatchObject({
            isOwner: true,
            params: { event: { title: 'Pizza party' } },
        });

        const theirs = await notebookActivity(member);
        expect(theirs.map((a) => a.id)).toEqual([posted]);
        expect(theirs[0]).toMatchObject({ isOwner: false, canUndo: false, status: 'done' });
        expect(theirs[0]!.summary).toContain('Pizza party');
        for (const key of ['params', 'result', 'error', 'undo', 'approvedBy'])
            expect(theirs[0]).not.toHaveProperty(key);
        expect(await action(member, posted)).toMatchObject({ isOwner: false });
        expect((await call(member, `/api/bot-actions/${unposted._id}`)).status).toBe(404);

        // Outsiders and other people's bots see nothing.
        expect((await call(outsider, `/api/bot-actions?notebookId=${shared}`)).status).toBe(404);
        expect((await call(outsider, `/api/bot-actions/${posted}`)).status).toBe(404);
        expect((await call(member, `/api/bot-actions?botId=${botId}`)).status).toBe(404);
        // A member's view of the owner's private notebook: not a member, nothing.
        expect((await call(member, `/api/bot-actions?notebookId=${privateNotebook}`)).status).toBe(
            404,
        );
    });

    it('adds one Activity page per notebook', async () => {
        const body = { type: 'activity', title: 'Activity', notebookId: shared };
        const first = await json(call(owner, '/api/pages', 'POST', body));
        expect(first.page).toMatchObject({ id: `activity-${shared}`, type: 'activity' });
        const second = await json(call(member, '/api/pages', 'POST', body));
        expect(second.page.id).toBe(`activity-${shared}`);
        expect(await testDb!.collection('pages').countDocuments({ type: 'activity' })).toBe(1);
    });

    it('creates the indexes its queries need', async () => {
        const { createIndexes } =
            await vi.importActual<typeof import('../../db/client')>('../../db/client');
        const scratch = testDb!.client.db('bot-action-indexes');
        try {
            await createIndexes(scratch);
            const keys = (await scratch.collection('bot_actions').indexes()).map((i) => i.key);
            expect(keys).toEqual(
                expect.arrayContaining([
                    { ownerId: 1, botId: 1, createdAt: 1 },
                    { notebookId: 1, createdAt: 1 },
                    { createdAt: -1 },
                    { ownerId: 1, status: 1 },
                    { ownerId: 1, 'undo.state': 1 },
                    { 'undo.id': 1 },
                ]),
            );
        } finally {
            await scratch.dropDatabase();
        }
    });
});
