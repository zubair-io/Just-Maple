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
    recentFollowUps,
    runFollowUpsForNotebook,
    runFollowUpsForUser,
    USER_DAILY_CALLS,
} from '../../services/follow-up.service';
import { findFollowUpsPages } from '../../repositories/page.repo';
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

    /** A pass for Alex over every notebook where Alex added a Follow-ups page. */
    const pass = (_notebookId: string, at = new Date()) => runFollowUpsForUser(alex.id, at);
    const sentTexts = () =>
        judge.mock.calls.flatMap((c) => c[0].items.map((item) => item.text)).join(' | ');

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
            body: 'Yes, I can bring four chairs',
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
        // The fresh one shows once it has waited a day.
        const tomorrow = new Date(Date.now() + 25 * HOUR * 1000);
        expect((await listFollowUps(notebookId, alex.id, tomorrow)).map((f) => f.what)).toEqual([
            'Can you drive Saturday?',
        ]);
    });

    it('does not count "lol" or an emoji as answering them', async () => {
        const question = text('pickup-q', {
            body: 'Can you pick up Mia at 3?',
            occurredAt: now - 3 * DAY,
        });
        await upload(
            ['imessage'],
            [
                question,
                text('lol', { isFromMe: true, body: 'lol', occurredAt: now - 2 * DAY }),
                text('thumbs', { isFromMe: true, body: '👍', occurredAt: now - 2 * DAY + 60 }),
            ],
        );
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps.map((f) => f.what)).toEqual([
            'Can you pick up Mia at 3?',
        ]);
    });

    it('leaves group mail out, and keeps one card per thread for the newest question', async () => {
        const crowd = mail('crowd-q', {
            title: 'Reunion',
            participants: Array.from({ length: 6 }, (_, i) => `friend${i}@home.com`),
            body: 'Could you all confirm the venue?',
            occurredAt: now - 2 * DAY,
        });
        const listMail = mail('list-q', {
            title: 'PTA',
            sender: 'PTA Chair <chair@pta.org>',
            extra: { listId: 'parents.pta.org' },
            body: 'Can you volunteer Saturday?',
            occurredAt: now - 2 * DAY,
        });
        const first = text('first-q', { body: 'Can you pick up Mia?', occurredAt: now - 3 * DAY });
        const second = text('second-q', {
            body: 'Can you bring snacks too?',
            occurredAt: now - 3 * DAY + 60,
        });
        await upload(['imessage', 'mail'], [crowd, listMail, first, second]);
        const { notebookId } = await notebook(['imessage', 'mail']);
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps.map((f) => f.what)).toEqual([
            'Can you bring snacks too?',
        ]);

        // A newer question in the thread replaces it; the old one isn't listed as closed.
        await upload(
            ['imessage', 'mail'],
            [text('third-q', { body: 'Could you call me tonight?', occurredAt: now - 2 * DAY })],
        );
        await pass(notebookId, new Date(Date.now() + 11 * 60_000));
        const { body } = await list(alex, notebookId);
        expect(body.followUps.map((f) => f.what)).toEqual(['Could you call me tonight?']);
        expect(body.recent).toEqual([]);
    });

    it('knows mail you sent by your own address, and reads each email once', async () => {
        promiseModel();
        const card: MacDataItem = {
            id: 'contacts:me',
            source: 'contacts',
            revision: '1',
            occurredAt: now - 100 * DAY,
            title: 'Alex',
            participants: ['alex@home.com'],
            body: '',
            extra: { isMe: true },
        };
        const sent = mail('promise-sent', {
            sender: 'Alex <alex@home.com>',
            participants: ['Pat Lee <pat@builder.com>'],
            mailbox: '[Gmail]/Sent Mail',
            body: "Thanks Pat. I'll send you the measurements tomorrow.",
            extra: { messageId: '<m1@home.com>' },
        });
        // The same email again in All Mail.
        const copy = { ...sent, id: 'mail:promise-all', mailbox: '[Gmail]/All Mail' };
        // Your question, filed in a German Sent folder.
        const question = mail('question-sent', {
            sender: 'Alex <alex@home.com>',
            participants: ['Pat Lee <pat@builder.com>'],
            mailbox: 'Gesendete Objekte',
            title: 'Deck colour',
            body: 'Do you have the stain samples?',
            occurredAt: now - 4 * DAY,
        });
        await upload(['mail', 'contacts'], [card, sent, copy, question]);
        const { notebookId } = await notebook(['mail']);
        await pass(notebookId);

        const asked = judge.mock.calls.flatMap((c) => c[0].items);
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({ from: 'me', who: 'Pat Lee' });
        const { body } = await list(alex, notebookId);
        expect(body.followUps.map((f) => [f.direction, f.who]).sort()).toEqual([
            ['waiting_reply', 'Pat Lee'],
            ['you_promised', 'Pat Lee'],
        ]);
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

    it('counts failed calls against the daily cap, and sets aside a batch that keeps failing', async () => {
        const many = Array.from({ length: 400 }, (_, i) =>
            text(`promise-${i}`, {
                isFromMe: true,
                occurredAt: now - DAY - i * 60,
                body: `I'll send you file ${i}`,
            }),
        );
        await upload(['imessage'], many);
        const { notebookId } = await notebook(['imessage']);

        const batchOf = (call: number) => judge.mock.calls[call]![0].items.map((i) => i.text);

        // An unreadable reply: the call counts, the pass stops, the batch gets a strike.
        judge.mockResolvedValue(null);
        expect(await pass(notebookId)).toMatchObject({ modelCalls: 1, pending: many.length });
        // It fails again: set aside after two strikes...
        await pass(notebookId);
        expect(batchOf(1)).toEqual(batchOf(0));
        // ...so the next pass moves on to newer-than-stuck items.
        await pass(notebookId);
        expect(batchOf(2)).not.toContain(batchOf(0)[0]);
        // A call that throws counts too.
        judge.mockRejectedValueOnce(new Error('overloaded'));
        await pass(notebookId);

        judge.mockResolvedValue([]);
        let calls = 0;
        for (let i = 1; i <= 10; i++) {
            const result = await pass(notebookId);
            calls += result?.modelCalls ?? 0;
        }
        // Failed calls used 4 of the day's calls; the cap holds across all of them.
        expect(judge.mock.calls.length).toBe(USER_DAILY_CALLS);
        expect(calls).toBe(USER_DAILY_CALLS - 4);
        // The batch that failed twice was never sent again.
        expect(
            judge.mock.calls.slice(2).flatMap((c) => c[0].items.map((i) => i.text)),
        ).not.toContain(batchOf(0)[0]);
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
                    participants: ['Pat Lee <pat@builder.com>'],
                    body: '',
                    extra: { createdAt: new Date((now - HOUR) * 1000).toISOString() },
                },
            ],
        );
        const result = await pass(notebookId, new Date(Date.now() + 11 * 60_000));
        expect(result?.closed).toBe(4);
        const after = (await list(alex, notebookId)).body;
        expect(after.followUps).toEqual([]);
        // Recently closed: each one, closed by Follow-ups itself, with why.
        expect(after.recent).toHaveLength(4);
        expect(after.recent.every((f) => f.closedBy?.type === 'auto')).toBe(true);
        expect(find(after.recent, 'owe_reply')?.closed?.reason).toBe('calendar');
        expect(find(after.recent, 'you_promised')?.closed?.reason).toBe('attachment');

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

    it('closes a promise only on a message that delivers it, one promise per message', async () => {
        judge.mockImplementation(async (request: PromiseJudgeRequest) =>
            request.items.map((item) => ({
                n: item.n,
                direction: 'you_promised' as const,
                what: /photos/.test(item.text) ? 'Send the photos' : 'Send the schedule',
                confidence: 0.9,
                sensitive: false,
            })),
        );
        const schedule = text('schedule', {
            isFromMe: true,
            occurredAt: now - 2 * DAY + 60,
            body: "And I'll send you the schedule tonight.",
        });
        await upload(['imessage'], [photosPromise, schedule]);
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        await upload(
            ['imessage'],
            [
                text('done', { isFromMe: true, body: 'done', occurredAt: now - DAY }),
                text('lol', { isFromMe: true, body: 'lol', occurredAt: now - DAY + 60 }),
            ],
        );
        expect((await pass(notebookId))?.closed).toBe(0);
        // One attachment delivers one of them.
        await upload(
            ['imessage'],
            [text('pic', { isFromMe: true, body: '(attachment)', occurredAt: now - HOUR })],
        );
        expect((await pass(notebookId))?.closed).toBe(1);
        expect((await list(alex, notebookId)).body.followUps).toHaveLength(1);
    });

    it('expires open follow-ups after a while, and lists them as recently closed', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise, rileyQuestion]);
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        // Both were due yesterday: still open three weeks on, expired after 30 days.
        expect((await pass(notebookId, new Date(Date.now() + 21 * DAY * 1000)))?.expired).toBe(0);
        const later = new Date(Date.now() + 31 * DAY * 1000);
        expect((await pass(notebookId, later))?.expired).toBe(2);
        expect(await listFollowUps(notebookId, alex.id, later)).toEqual([]);
        const recent = await recentFollowUps(notebookId, alex.id, later);
        expect(recent.map((f) => [f.status, f.closedBy?.type])).toEqual([
            ['expired', 'auto'],
            ['expired', 'auto'],
        ]);
        // Two weeks later they're gone from Recently closed too.
        expect(
            await recentFollowUps(notebookId, alex.id, new Date(Date.now() + 46 * DAY * 1000)),
        ).toEqual([]);
    });

    it('drops a follow-up whose message was deleted', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise]);
        const { notebookId } = await notebook(['imessage']);
        await pass(notebookId);
        expect((await list(alex, notebookId)).body.followUps).toHaveLength(1);
        const removed = await json(
            call(alex, '/api/device-data/items', 'POST', {
                deviceId: `device-${alex.id}`,
                upserts: [],
                removals: [photosPromise.id],
            }),
        );
        expect(removed.removed).toBe(1);
        expect((await list(alex, notebookId)).body.followUps).toEqual([]);
    });

    // MARK: - What a pass reads

    it('reads only what changed since the last pass, and everything when the pages change', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise]);
        const { notebookId, pages } = await notebook(['imessage']);
        expect(await pass(notebookId)).toMatchObject({ incremental: false, modelCalls: 1 });

        const schedule = text('schedule', {
            isFromMe: true,
            occurredAt: now - HOUR,
            body: "I'll send you the schedule tonight.",
        });
        await upload(['imessage'], [schedule]);
        expect(await pass(notebookId, new Date(Date.now() + 11 * 60_000))).toMatchObject({
            incremental: true,
            modelCalls: 1,
        });
        expect(judge.mock.calls[1]![0].items.map((i) => i.text)).toEqual([schedule.body]);

        // The page's filter changed: read everything again (nothing new for the model).
        await setFilter(pages.imessage!, { includeAll: true });
        expect(await pass(notebookId, new Date(Date.now() + 22 * 60_000))).toMatchObject({
            incremental: false,
            modelCalls: 0,
        });
    });

    it('scans only the data of the member who added the Follow-ups page', async () => {
        promiseModel();
        await upload(['imessage'], [photosPromise]);
        const invoice = text('sam-invoice', {
            isFromMe: true,
            occurredAt: now - DAY,
            body: "I'll send you the invoice tomorrow.",
        });
        await upload(['imessage'], [invoice], sam);
        const { notebookId, pages } = await notebook(['imessage'], true);
        await setFilter(pages.imessage!, { includeAll: true });
        // Sam shares everything through a data page in the same notebook.
        const { page } = await json(
            call(sam, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: 'imessage',
                title: 'Sam messages',
                notebookId,
            }),
        );
        await call(sam, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { includeAll: true },
        });
        await followUpTick(new Date(Date.now() + 11 * 60_000));
        expect(sentTexts()).toMatch(/photos/);
        expect(sentTexts()).not.toMatch(/invoice/);
        expect(await listFollowUps(notebookId, sam.id)).toEqual([]);

        // Sam opts in with a Follow-ups page of their own: then Sam's data is read.
        const own = await createNotebookFixture({ createdBy: sam.id });
        const ownId = own._id.toString();
        await call(sam, '/api/pages', 'POST', {
            type: 'devicedata',
            deviceSource: 'imessage',
            title: 'Messages',
            notebookId: ownId,
        });
        await createPageFixture({
            id: followUpsPageId(ownId),
            userId: sam.id,
            notebookId: ownId,
            type: 'followups',
            title: 'Follow-ups',
        });
        await followUpTick(new Date(Date.now() + 22 * 60_000));
        expect(sentTexts()).toMatch(/invoice/);
        expect((await listFollowUps(ownId, sam.id)).map((f) => f.what)).toEqual([
            'Send the photos',
        ]);
    });

    it('pages through every Follow-ups page', async () => {
        const made = [];
        for (let i = 0; i < 3; i++) made.push((await notebook([])).notebookId);
        const first = await findFollowUpsPages(undefined, 2);
        expect(first.pages).toHaveLength(2);
        expect(first.next).toBeDefined();
        const seen = first.pages.map((p) => p.notebookId);
        let after = first.next;
        while (after) {
            const next = await findFollowUpsPages(after, 2);
            seen.push(...next.pages.map((p) => p.notebookId));
            after = next.next;
        }
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toEqual(expect.arrayContaining(made));
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
        // Mail follow-ups are keyed by the email, not one mailbox's copy: take the ids listed.
        const ids = new Map(
            (await list(alex, notebookId)).body.followUps.map((f) => [f.direction, f.id]),
        );
        const id = (direction: FollowUp['direction']) => ids.get(direction)!;

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
        expect(find(body.recent, 'you_promised')).toMatchObject({
            status: 'done',
            closedBy: { type: 'you' },
        });
        expect(find(body.recent, 'owe_reply')).toMatchObject({
            status: 'dismissed',
            closedBy: { type: 'you' },
        });
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
        // The wording is quoted from messages: framed as untrusted, like other message text.
        expect(listed.note).toMatch(/untrusted/);
        expect(ctx.readThirdPartyText).toBe(true);

        expect(
            await executeMacDataTool(ctx, 'update_follow_up', { id: promise.id, action: 'done' }),
        ).toMatch(/Marked done/);
        let { body } = await list(alex, notebookId);
        expect(find(body.followUps, 'you_promised')).toBeUndefined();
        // Visible, with the bot's name, and reversible.
        expect(find(body.recent, 'you_promised')?.closedBy).toEqual({
            type: 'bot',
            name: 'Helper',
        });
        expect(
            await executeMacDataTool(ctx, 'update_follow_up', { id: promise.id, action: 'reopen' }),
        ).toMatch(/Reopened/);
        // A bot can't bring back one the user dismissed.
        const owed = listed.followUps.find((f: { kind: string }) => f.kind === 'you owe a reply');
        await act(notebookId, owed.id, 'dismiss');
        expect(
            await executeMacDataTool(ctx, 'update_follow_up', { id: owed.id, action: 'reopen' }),
        ).toMatch(/only they can/);
        ({ body } = await list(alex, notebookId));
        expect(find(body.recent, 'owe_reply')?.status).toBe('dismissed');
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
