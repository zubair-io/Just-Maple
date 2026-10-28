import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';
import {
    followUpsPageId,
    type DeviceDataFilter,
    type FollowUp,
    type FollowUpList,
    type MacDataItem,
    type MacDataSource,
} from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));
vi.mock('../../services/mac-data-relay.service', () => ({
    macDataRelay: { isOnline: vi.fn().mockResolvedValue(false), request: vi.fn() },
}));
vi.mock('../../services/graph.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/graph.service')>()),
    markGraphDirty: vi.fn(),
}));
const model = vi.hoisted(() => ({ available: true }));
vi.mock('../../services/follow-up-model.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/follow-up-model.service')>()),
    followUpModelAvailable: () => model.available,
    judgePromises: vi.fn(),
}));

import { judgePromises, type PromiseJudgeRequest } from '../../services/follow-up-model.service';
import {
    dueFollowUps,
    followUpTick,
    listFollowUps,
    runFollowUpPass,
    runFollowUpsForNotebook,
    USER_DAILY_CALLS,
} from '../../services/follow-up.service';
import { notebookDataSlices } from '../../services/device-data-access.service';
import {
    executeMacDataTool,
    getMacDataToolContext,
    macDataToolDefinitions,
} from '../../services/mac-data-tools.service';

const judge = vi.mocked(judgePromises);
const HOUR = 3600;
const DAY = 24 * HOUR;
const now = Math.floor(Date.now() / 1000);

const JORDAN_CHAT = 'iMessage;-;+15185550100';
const RILEY_CHAT = 'iMessage;-;+15185550199';

function text(id: string, fields: Partial<MacDataItem>): MacDataItem {
    return {
        id: `imessage:${id}`,
        source: 'imessage',
        revision: '1',
        occurredAt: now - HOUR,
        participants: ['+15185550100'],
        thread: 'Jordan',
        sender: 'Jordan',
        body: '',
        extra: { chatId: JORDAN_CHAT },
        ...fields,
    };
}

function mail(id: string, fields: Partial<MacDataItem>): MacDataItem {
    return {
        id: `mail:${id}`,
        source: 'mail',
        revision: '1',
        occurredAt: now - HOUR,
        participants: ['alex@home.com'],
        sender: 'Pat Lee <pat@builder.com>',
        mailbox: 'INBOX',
        title: 'Deck quote',
        body: '',
        ...fields,
    };
}

// You promised photos; Jordan promised to get back to you.
const photosPromise = text('photos', {
    isFromMe: true,
    sender: 'Me',
    occurredAt: now - 2 * DAY,
    body: "Great game! I'll send you the photos tomorrow.",
});
const jordanPromise = text('jordan-back', {
    occurredAt: now - 2 * DAY + HOUR,
    body: "Thanks! I'll get back to you Friday about carpool.",
});
// Pat asked you something in mail two days ago; you never answered.
const patQuestion = mail('pat-q', {
    occurredAt: now - 2 * DAY,
    body: 'Hi Alex, could you confirm the deck size by Friday?',
});
// You asked Riley something four days ago; no answer.
const rileyQuestion = text('riley-q', {
    isFromMe: true,
    sender: 'Me',
    thread: 'Riley',
    participants: ['+15185550199'],
    extra: { chatId: RILEY_CHAT },
    occurredAt: now - 4 * DAY,
    body: 'Are we still on for the hike Saturday?',
});

/** The model finds the promise in each item that has one. */
function promiseModel() {
    judge.mockImplementation(async (request: PromiseJudgeRequest) =>
        request.items
            .filter((item) => /I'll/.test(item.text))
            .map((item) => ({
                n: item.n,
                direction: item.from === 'me' ? ('you_promised' as const) : ('they_owe' as const),
                what: item.from === 'me' ? 'Send the photos' : 'Get back about carpool',
                ...(item.from === 'me' ? {} : { due: '2099-01-01' }),
                confidence: 0.9,
                sensitive: /lawyer|doctor/.test(item.text),
            })),
    );
}

describe.runIf(mongoAvailable)('follow-ups', () => {
    let app: ReturnType<typeof createTestApp>;
    let alex: { id: string; token: string };
    let sam: { id: string; token: string };

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

    async function upload(sources: MacDataSource[], items: MacDataItem[], who = alex) {
        await call(who, '/api/collectors', 'POST', {
            deviceId: `device-${who.id}`,
            platform: 'macos',
            name: 'Test Mac',
            sources,
            timeZone: 'America/New_York',
        });
        await call(who, `/api/collectors/device-${who.id}`, 'PATCH', { activeSources: sources });
        const result = await json(
            call(who, '/api/device-data/items', 'POST', {
                deviceId: `device-${who.id}`,
                upserts: items,
                removals: [],
            }),
        );
        expect(result.stored).toBe(items.length);
    }

    /** A notebook with data pages for these sources and a Follow-ups page. */
    async function notebook(sources: MacDataSource[], shared = false, withPage = true) {
        const doc = await createNotebookFixture({
            createdBy: alex.id,
            sharedWith: [
                { userId: alex.id, accessLevel: 'owner' },
                ...(shared ? [{ userId: sam.id, accessLevel: 'write' as const }] : []),
            ],
        });
        const notebookId = doc._id.toString();
        const pages: Record<string, string> = {};
        for (const source of sources) {
            const { page } = await json(
                call(alex, '/api/pages', 'POST', {
                    type: 'devicedata',
                    deviceSource: source,
                    title: source,
                    notebookId,
                }),
            );
            pages[source] = page.id;
        }
        if (withPage)
            await createPageFixture({
                id: followUpsPageId(notebookId),
                userId: alex.id,
                notebookId,
                type: 'followups',
                title: 'Follow-ups',
            });
        return { notebookId, pages };
    }

    const setFilter = (pageId: string, deviceFilter: DeviceDataFilter) =>
        json(call(alex, `/api/device-data/pages/${pageId}`, 'PATCH', { deviceFilter }));

    const pass = async (notebookId: string, at = new Date()) =>
        runFollowUpPass(
            alex.id,
            (await notebookDataSlices(notebookId)).filter((s) => s.ownerId === alex.id),
            at,
        );

    const list = async (who: { token: string }, notebookId: string) => {
        const response = await call(who, `/api/follow-ups/${notebookId}`);
        return { status: response.status, body: (await response.json()) as FollowUpList };
    };
    const find = (followUps: FollowUp[], direction: FollowUp['direction']) =>
        followUps.find((f) => f.direction === direction);
    const act = (notebookId: string, id: string, action: string, until?: string) =>
        call(alex, `/api/follow-ups/${notebookId}/${encodeURIComponent(id)}`, 'PATCH', {
            action,
            ...(until ? { until } : {}),
        });

    beforeEach(async () => {
        vi.clearAllMocks();
        model.available = true;
        judge.mockResolvedValue([]);
        app = createTestApp();
        alex = await person('Alex');
        sam = await person('Sam');
    });

    // MARK: - Detection

    it('finds promises both ways with the model, and questions left hanging by rule', async () => {
        promiseModel();
        await upload(
            ['imessage', 'mail'],
            [photosPromise, jordanPromise, patQuestion, rileyQuestion],
        );
        const { notebookId, pages } = await notebook(['imessage', 'mail']);

        const result = await pass(notebookId);
        expect(result).toMatchObject({ modelCalls: 1, pending: 0 });
        // Only messages that may hold a promise go to the model.
        const sent = judge.mock.calls[0]![0].items.map((item) => item.text);
        expect(sent).toHaveLength(2);
        expect(sent.join(' ')).not.toMatch(/hike|deck size/);

        const { body } = await list(alex, notebookId);
        expect(find(body.followUps, 'you_promised')).toMatchObject({
            who: 'Jordan',
            what: 'Send the photos',
            madeBy: 'model',
            status: 'open',
            evidence: [{ itemId: photosPromise.id, source: 'imessage', pageId: pages.imessage }],
        });
        // No due date from the model: the rule reads "tomorrow".
        expect(find(body.followUps, 'you_promised')!.dueAt).toBeGreaterThan(
            photosPromise.occurredAt,
        );
        expect(find(body.followUps, 'they_owe')).toMatchObject({
            who: 'Jordan',
            what: 'Get back about carpool',
        });
        expect(find(body.followUps, 'owe_reply')).toMatchObject({
            who: 'Pat Lee',
            what: 'Hi Alex, could you confirm the deck size by Friday?',
            madeBy: 'rule',
            evidence: [{ itemId: patQuestion.id, pageId: pages.mail }],
        });
        expect(find(body.followUps, 'waiting_reply')).toMatchObject({
            who: 'Riley',
            what: 'Are we still on for the hike Saturday?',
        });
        // Due and overdue first.
        const dues = body.followUps.map((f) => f.dueAt ?? f.at);
        expect([...dues].sort((a, b) => a - b)).toEqual(dues);
        expect(body.status.modelAvailable).toBe(true);

        // Read messages aren't sent again.
        await pass(notebookId, new Date(Date.now() + 11 * 60_000));
        expect(judge).toHaveBeenCalledTimes(1);
    });

    it('waits before calling a question unanswered, and skips answered ones and group chats', async () => {
        const fresh = text('fresh-q', {
            body: 'Can you drive Saturday?',
            occurredAt: now - 2 * HOUR,
        });
        const answered = text('answered-q', {
            thread: 'Riley',
            participants: ['+15185550199'],
            extra: { chatId: RILEY_CHAT },
            body: 'Can you bring chairs?',
            occurredAt: now - 3 * DAY,
        });
        const answer = text('answer', {
            thread: 'Riley',
            participants: ['+15185550199'],
            extra: { chatId: RILEY_CHAT },
            isFromMe: true,
            sender: 'Me',
            body: 'Yes!',
            occurredAt: now - 2 * DAY,
        });
        const group = text('group-q', {
            thread: 'Team parents',
            participants: ['+15185550100', '+15185550199'],
            extra: { chatId: 'iMessage;+;chat123' },
            body: 'Can someone bring oranges?',
            occurredAt: now - 3 * DAY,
        });
        await upload(['imessage'], [fresh, answered, answer, group]);
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps).toEqual([]);
    });

    it('finds explicit promises by rule when the server has no model', async () => {
        model.available = false;
        await upload(['imessage'], [photosPromise]);
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        expect(judge).not.toHaveBeenCalled();
        const { body } = await list(alex, notebookId);
        expect(body.followUps).toEqual([
            expect.objectContaining({
                direction: 'you_promised',
                what: 'Send you the photos',
                madeBy: 'rule',
            }),
        ]);
        expect(body.status.modelAvailable).toBe(false);
    });

    it('keeps model calls within the daily cap, and gives back failed calls', async () => {
        const many = Array.from({ length: 400 }, (_, i) =>
            text(`promise-${i}`, {
                isFromMe: true,
                occurredAt: now - DAY - i * 60,
                body: `I'll send you file ${i}`,
            }),
        );
        await upload(['imessage'], many);
        const { notebookId } = await notebook(['imessage']);

        // A failed reply is not counted.
        judge.mockResolvedValueOnce(null);
        const failed = await pass(notebookId);
        expect(failed).toMatchObject({ modelCalls: 1, pending: many.length });

        judge.mockResolvedValue([]);
        let calls = 0;
        for (let i = 1; i <= 10; i++) {
            const result = await pass(notebookId);
            calls += result?.modelCalls ?? 0;
        }
        // Each pass makes at most 3; the day allows USER_DAILY_CALLS successful ones.
        expect(judge.mock.calls.length - 1).toBe(USER_DAILY_CALLS);
        expect(calls).toBe(USER_DAILY_CALLS);
    });

    // MARK: - Closing by itself

    it('closes promises and questions when the thread shows they are done, and says why', async () => {
        promiseModel();
        await upload(
            ['imessage', 'mail'],
            [photosPromise, jordanPromise, patQuestion, rileyQuestion],
        );
        const { notebookId } = await notebook(['imessage', 'mail']);
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps).toHaveLength(4);

        await upload(
            ['imessage', 'mail', 'calendar'],
            [
                // The photos you sent; Jordan writes back; Riley answers.
                text('sent-photos', {
                    isFromMe: true,
                    sender: 'Me',
                    body: '(attachment)',
                    occurredAt: now - DAY,
                }),
                text('jordan-reply', {
                    body: 'Carpool works, I can drive',
                    occurredAt: now - 0.5 * DAY,
                }),
                text('riley-reply', {
                    thread: 'Riley',
                    sender: 'Riley',
                    participants: ['+15185550199'],
                    extra: { chatId: RILEY_CHAT },
                    body: 'Yes, 9am!',
                    occurredAt: now - 2 * HOUR,
                }),
                // You made an event for Pat's question.
                {
                    id: 'calendar:deck',
                    source: 'calendar',
                    revision: '1',
                    occurredAt: now + 2 * DAY,
                    title: 'Measure deck size',
                    participants: [],
                    body: '',
                    extra: { createdAt: new Date((now - HOUR) * 1000).toISOString() },
                },
            ],
        );
        const result = await pass(notebookId, new Date(Date.now() + 11 * 60_000));
        expect(result?.closed).toBe(4);
        expect((await list(alex, notebookId)).body.followUps).toEqual([]);

        // Undo brings one back, and it stays open.
        const { followUp } = await json(
            act(notebookId, `${alex.id}|you_promised|${photosPromise.id}`, 'reopen'),
        );
        expect(followUp.status).toBe('open');
        expect(followUp.closed).toBeUndefined();
        await pass(notebookId, new Date(Date.now() + 22 * 60_000));
        expect((await list(alex, notebookId)).body.followUps.map((f) => f.what)).toEqual([
            'Send the photos',
        ]);
    });

    // MARK: - Reading through the pages

    it('shows a follow-up only while the pages share its evidence, and only to its owner', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise, rileyQuestion]);
        const { notebookId, pages } = await notebook(['imessage']);
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps).toHaveLength(2);

        // The page stops sharing Jordan's chat: the promise drops out on read.
        await setFilter(pages.imessage!, { chats: [{ id: RILEY_CHAT, name: 'Riley' }] });
        expect((await list(alex, notebookId)).body.followUps.map((f) => f.who)).toEqual(['Riley']);
        // A bot can't act on it either.
        expect(
            (await act(notebookId, `${alex.id}|you_promised|${photosPromise.id}`, 'done')).status,
        ).toBe(404);
        // Shared again: it's back, nothing was lost.
        await setFilter(pages.imessage!, { includeAll: true });
        expect((await list(alex, notebookId)).body.followUps).toHaveLength(2);

        // Another notebook without the pages shows nothing; non-members get a 404.
        const other = await notebook([]);
        expect((await list(alex, other.notebookId)).body.followUps).toEqual([]);
        expect((await list(sam, notebookId)).status).toBe(404);
    });

    it('hides private follow-ups in shared notebooks, and shows each member only theirs', async () => {
        promiseModel();
        const lawyer = text('lawyer', {
            isFromMe: true,
            occurredAt: now - DAY,
            body: "I'll call the lawyer about the custody papers tomorrow",
        });
        await upload(['imessage'], [photosPromise, lawyer]);
        const { notebookId, pages } = await notebook(['imessage'], true);
        // A new page in a shared notebook shares nothing until its creator picks.
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps).toEqual([]);

        await setFilter(pages.imessage!, { chats: [{ id: JORDAN_CHAT, name: 'Jordan' }] });
        await pass(notebookId, new Date(Date.now() + 11 * 60_000));
        const { body } = await list(alex, notebookId);
        expect(body.followUps.map((f) => f.what)).toEqual(['Send the photos']);
        // Sam is a member, but these are Alex's.
        const forSam = await list(sam, notebookId);
        expect(forSam.status).toBe(200);
        expect(forSam.body.followUps).toEqual([]);
        // And Sam can't change Alex's.
        const response = await call(
            sam,
            `/api/follow-ups/${notebookId}/${encodeURIComponent(body.followUps[0]!.id)}`,
            'PATCH',
            { action: 'done' },
        );
        expect(response.status).toBe(404);

        // In a private notebook, the private one shows.
        const mine = await notebook(['imessage']);
        await runFollowUpsForNotebook(mine.notebookId, new Date(Date.now() + 22 * 60_000));
        expect((await list(alex, mine.notebookId)).body.followUps).toHaveLength(2);
    });

    // MARK: - Done, snooze, dismiss

    it('snoozes, dismisses and marks done, and every change can be undone', async () => {
        promiseModel();
        await upload(['imessage', 'mail'], [photosPromise, jordanPromise, patQuestion]);
        const { notebookId } = await notebook(['imessage', 'mail']);
        await pass(notebookId);
        const id = (direction: FollowUp['direction']) =>
            `${alex.id}|${direction}|${
                {
                    you_promised: photosPromise,
                    they_owe: jordanPromise,
                    owe_reply: patQuestion,
                    waiting_reply: rileyQuestion,
                }[direction].id
            }`;

        // Snooze a week: it stays on the list as snoozed, then wakes up.
        const until = new Date(Date.now() + 7 * DAY * 1000).toISOString();
        const snoozed = await json(act(notebookId, id('they_owe'), 'snooze', until));
        expect(snoozed.followUp).toMatchObject({ status: 'snoozed' });
        expect(snoozed.followUp.snoozedUntil).toBe(Math.floor(Date.parse(until) / 1000));
        const later = await listFollowUps(
            notebookId,
            alex.id,
            new Date(Date.now() + 8 * DAY * 1000),
        );
        expect(find(later, 'they_owe')?.status).toBe('open');
        expect((await act(notebookId, id('they_owe'), 'snooze', '2000-01-01')).status).toBe(400);

        // Dismissed: gone, and never found again.
        await act(notebookId, id('owe_reply'), 'dismiss');
        await pass(notebookId, new Date(Date.now() + 11 * 60_000));
        let { body } = await list(alex, notebookId);
        expect(find(body.followUps, 'owe_reply')).toBeUndefined();

        // Done, then undone.
        await act(notebookId, id('you_promised'), 'done');
        ({ body } = await list(alex, notebookId));
        expect(find(body.followUps, 'you_promised')).toBeUndefined();
        await act(notebookId, id('you_promised'), 'reopen');
        await act(notebookId, id('owe_reply'), 'reopen');
        ({ body } = await list(alex, notebookId));
        expect(body.followUps.map((f) => f.direction).sort()).toEqual([
            'owe_reply',
            'they_owe',
            'you_promised',
        ]);
    });

    it('gives the brief what is due or overdue', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise, jordanPromise]);
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        // The photos were due yesterday; Jordan's is far off.
        const due = await dueFollowUps(alex.id, notebookId);
        expect(due.map((f) => f.what)).toEqual(['Send the photos']);
        expect(await dueFollowUps(sam.id, notebookId)).toEqual([]);
    });

    // MARK: - Bots

    it("lets the owner's bots list follow-ups and mark them done or snooze them, reversibly", async () => {
        promiseModel();
        await upload(['imessage', 'mail'], [photosPromise, jordanPromise, patQuestion]);
        const { notebookId } = await notebook(['imessage', 'mail']);
        await pass(notebookId);

        const bot = { id: 'bot-1', name: 'Helper', ownerId: alex.id };
        const ctx = (await getMacDataToolContext(alex.id, notebookId, bot))!;
        expect(macDataToolDefinitions(ctx).map((t) => t.name)).toEqual(
            expect.arrayContaining(['list_follow_ups', 'update_follow_up']),
        );
        const listed = JSON.parse(
            await executeMacDataTool(ctx, 'list_follow_ups', { owed_by: 'you' }),
        );
        expect(listed.followUps.map((f: { kind: string }) => f.kind).sort()).toEqual([
            'you owe a reply',
            'you promised',
        ]);
        const promise = listed.followUps.find((f: { kind: string }) => f.kind === 'you promised');
        expect(promise.evidence).toEqual([photosPromise.id]);

        expect(
            await executeMacDataTool(ctx, 'update_follow_up', { id: promise.id, action: 'done' }),
        ).toMatch(/Marked done/);
        let { body } = await list(alex, notebookId);
        expect(find(body.followUps, 'you_promised')).toBeUndefined();
        expect(
            await executeMacDataTool(ctx, 'update_follow_up', { id: promise.id, action: 'reopen' }),
        ).toMatch(/Reopened/);
        expect(
            await executeMacDataTool(ctx, 'update_follow_up', {
                id: promise.id,
                action: 'snooze',
                until: new Date(Date.now() + 2 * DAY * 1000).toISOString(),
            }),
        ).toMatch(/Snoozed/);
        ({ body } = await list(alex, notebookId));
        expect(find(body.followUps, 'you_promised')?.status).toBe('snoozed');
        // Bots can't dismiss, and can't touch someone else's.
        expect(
            await executeMacDataTool(ctx, 'update_follow_up', {
                id: promise.id,
                action: 'dismiss',
            }),
        ).toMatch(/Choose/);
        expect(
            await executeMacDataTool(ctx, 'update_follow_up', {
                id: promise.id.replace(alex.id, sam.id),
                action: 'done',
            }),
        ).toMatch(/not in this notebook/);

        // A bot someone else owns gets no data context at all.
        expect(
            await getMacDataToolContext(alex.id, notebookId, { ...bot, ownerId: sam.id }),
        ).toBeNull();
        // Without a Follow-ups page there are no tools.
        const plain = await notebook(['imessage'], false, false);
        const plainCtx = (await getMacDataToolContext(alex.id, plain.notebookId, bot))!;
        expect(plainCtx.followUps).toBeUndefined();
        expect(macDataToolDefinitions(plainCtx).map((t) => t.name)).not.toContain(
            'list_follow_ups',
        );
        expect(await executeMacDataTool(plainCtx, 'list_follow_ups', {})).toMatch(/Unknown tool/);
    });

    // MARK: - The page

    it('adds one Follow-ups page per notebook, and the background pass picks it up', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise]);
        const doc = await createNotebookFixture({ createdBy: alex.id });
        const notebookId = doc._id.toString();
        await call(alex, '/api/pages', 'POST', {
            type: 'devicedata',
            deviceSource: 'imessage',
            title: 'Messages',
            notebookId,
        });
        expect((await list(alex, notebookId)).status).toBe(404);

        const first = await json(
            call(alex, '/api/pages', 'POST', {
                type: 'followups',
                title: 'Follow-ups',
                notebookId,
            }),
        );
        expect(first.page.id).toBe(followUpsPageId(notebookId));
        const again = await json(
            call(alex, '/api/pages', 'POST', {
                type: 'followups',
                title: 'Follow-ups',
                notebookId,
            }),
        );
        expect(again.page.id).toBe(first.page.id);

        await followUpTick(new Date(Date.now() + 11 * 60_000));
        expect((await list(alex, notebookId)).body.followUps.map((f) => f.what)).toEqual([
            'Send the photos',
        ]);
    });
});
