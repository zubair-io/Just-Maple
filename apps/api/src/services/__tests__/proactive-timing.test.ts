import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Now or wait, the pending pile, and revising unread posts (proactive-bot.service).
// The pile lives in memory here; proactive-pile.repo.test.ts covers the real one.

const store = vi.hoisted(() => ({ piles: new Map<string, any>(), budgetLeft: 100 }));

vi.mock('../bot-executor.service', () => ({
    botExecutor: { invoke: vi.fn(), runProactive: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../mac-data-tools.service', () => ({ getMacDataToolContext: vi.fn() }));
vi.mock('../../repositories/page.repo', () => ({
    findProactivePages: vi.fn(),
    findPageByIdForBot: vi.fn(),
    setPageProactive: vi.fn(),
}));
vi.mock('../../repositories/notebook.repo', () => ({
    findNotebookByIdWithAccess: vi.fn().mockResolvedValue({ _id: 'n1' }),
}));
vi.mock('../../repositories/user-bot.repo', () => ({ findUserBotByIdInternal: vi.fn() }));
vi.mock('../../repositories/bot-template.repo', () => ({ findBotTemplateById: vi.fn() }));
vi.mock('../../repositories/message.repo', () => ({
    findMessageById: vi.fn(),
    findMessagesByPageId: vi.fn().mockResolvedValue([]),
    findMessagesByThreadId: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../repositories/thread.repo', () => ({ findThreadById: vi.fn() }));
vi.mock('../../repositories/collector.repo', () => ({
    collectorTimeZone: vi.fn().mockResolvedValue('America/New_York'),
}));
vi.mock('../../repositories/unread.repo', () => ({ getLastReadAtByPageId: vi.fn() }));
vi.mock('../calendar-overlap.service', () => ({
    overlapNewsFor: vi.fn(),
    briefOverlapsFor: vi.fn().mockResolvedValue({ notes: [], release: vi.fn() }),
}));
vi.mock('../../repositories/proactive-pile.repo', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getPile: vi.fn(async (pageId: string) => store.piles.get(pageId) ?? null),
    savePile: vi.fn(async (pageId: string, _userId: string, items: any[], view: any) => {
        if (items.length === 0) store.piles.delete(pageId);
        else
            store.piles.set(pageId, {
                pageId,
                items,
                oldestAt: new Date(Math.min(...items.map((i) => +i.addedAt))),
                urgency: view.urgency,
                headline: view.headline,
            });
    }),
    removeFromPile: vi.fn(async (pageId: string, covered: any[]) => {
        const pile = store.piles.get(pageId);
        if (!pile) return;
        const done = new Set(covered.map((i) => i.key));
        pile.items = pile.items.filter((i: any) => !done.has(i.key));
        if (pile.items.length === 0) store.piles.delete(pageId);
    }),
    takeTriageCall: vi.fn(async () => store.budgetLeft-- > 0),
}));
vi.mock('../proactive-triage.service', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    triageModelAvailable: () => true,
    triagePile: vi.fn(),
}));

import { flushPendingNews, handleDeviceDataChanges, runDailyBrief } from '../proactive-bot.service';
import { botExecutor } from '../bot-executor.service';
import { getMacDataToolContext } from '../mac-data-tools.service';
import { findProactivePages } from '../../repositories/page.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findMessagesByPageId } from '../../repositories/message.repo';
import { getLastReadAtByPageId } from '../../repositories/unread.repo';
import { overlapNewsFor } from '../calendar-overlap.service';
import { triagePile } from '../proactive-triage.service';

const page: any = {
    id: 'page',
    type: 'message',
    title: 'Family',
    notebookId: 'n1',
    proactive: {
        userBotId: 'bot',
        instructions: 'Track the kids’ sports.',
        enabled: true,
        ownerUserId: 'u1',
        updatedAt: '2026-10-24T00:00:00.000Z',
    },
};
const bot: any = { _id: 'bot', userId: 'u1', handle: 'maple', templateId: 'tpl', isEnabled: true };
const template: any = { _id: 'tpl', name: 'Maple', definition: { actions: [{ type: 'llm' }] } };

const mail = (n: number, snippet = `Newsletter ${n}`) => ({
    kind: 'added',
    item: {
        id: `mail:${n}`,
        source: 'mail',
        when: '2026-10-27T14:00:00-04:00',
        snippet,
        score: 0,
    },
});

/** Wednesday 2 pm in New York: outside the default quiet hours. */
const AFTERNOON = new Date('2026-10-28T14:00:00-04:00');
/** 11:30 pm: inside them. */
const NIGHT = new Date('2026-10-28T23:30:00-04:00');

async function arrive(entries: unknown[], at = AFTERNOON, onPage = page) {
    vi.setSystemTime(at);
    vi.mocked(findProactivePages).mockResolvedValue([onPage]);
    await handleDeviceDataChanges('u1', [{ notebookId: 'n1', entries }] as never);
    // The pass runs in the page queue; wait until it has settled.
    await vi.waitFor(() => expect(triagePile).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

const pileKeys = () => (store.piles.get('page')?.items ?? []).map((i: any) => i.key);
const lastRun = () => vi.mocked(botExecutor.runProactive).mock.calls.at(-1)?.[0];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.clearAllMocks();
    store.piles.clear();
    store.budgetLeft = 100;
    vi.mocked(findUserBotByIdInternal).mockResolvedValue(bot);
    vi.mocked(findBotTemplateById).mockResolvedValue(template);
    vi.mocked(getMacDataToolContext).mockResolvedValue({ now: 'now', userId: 'u1' } as any);
    vi.mocked(findMessagesByPageId).mockResolvedValue([]);
    vi.mocked(getLastReadAtByPageId).mockResolvedValue(null);
    vi.mocked(botExecutor.runProactive).mockResolvedValue({ id: 'posted' } as any);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('now or wait', () => {
    it('posts right away when the triage says now, and empties the pile', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency: 3, drop: [] });
        await arrive([mail(1, 'Can you pick up Sam at 4?')]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(lastRun()!.prompt).toContain('pick up Sam');
        expect(lastRun()!.proactiveMeta).toEqual({ kind: 'news', urgency: 3 });
        await vi.waitFor(() => expect(pileKeys()).toEqual([]));
    });

    it('keeps what can wait in the pile without posting', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1)]);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(pileKeys()).toEqual(['mail:1']);
    });

    it('re-scores the whole pile on every arrival, and posts once it tips', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 0, drop: [] });
        await arrive([mail(1, 'Team dinner idea')]);
        vi.mocked(triagePile).mockClear();
        vi.mocked(triagePile).mockResolvedValueOnce({
            now: true,
            urgency: 2,
            headline: 'Team dinner is set for Friday 7pm',
            drop: [],
        });
        await arrive([mail(2, 'Friday works'), mail(3, 'Booked for 7')], AFTERNOON);
        // The triage saw everything waiting, with what just came in marked new.
        const seen = vi.mocked(triagePile).mock.calls[0]![0].items;
        expect(seen.map((i) => [i.text, i.new])).toEqual([
            ['Team dinner idea', false],
            ['Friday works', true],
            ['Booked for 7', true],
        ]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        // One summary of the whole pile.
        expect(lastRun()!.prompt).toContain('Team dinner idea');
        expect(lastRun()!.prompt).toContain('Booked for 7');
        await vi.waitFor(() => expect(pileKeys()).toEqual([]));
    });

    it('drops what the triage says is not worth telling at all', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 0, drop: [0] });
        await arrive([mail(1, '20% off'), mail(2, 'Field trip form due Friday')]);
        expect(pileKeys()).toEqual(['mail:2']);
    });

    it('always tells a calendar clash now, even in quiet hours', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 0, drop: [] });
        const commit = vi.fn();
        vi.mocked(overlapNewsFor).mockResolvedValueOnce({
            flagged: [{ kind: 'overlap', summary: 'Dental overlaps Pizza party', events: [] }],
            cleared: [],
            commit,
            release: vi.fn(),
        } as any);
        const calendar = {
            kind: 'changed',
            item: {
                id: 'calendar:dental',
                source: 'calendar',
                when: '2026-10-29T13:00:00-04:00',
                snippet: 'Dental',
                score: 0,
            },
        };
        await arrive([calendar], NIGHT);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(lastRun()!.prompt).toContain('Dental overlaps Pizza party');
        await vi.waitFor(() => expect(commit).toHaveBeenCalled());
    });
});

describe('limits', () => {
    it('flushes an item that has waited the maximum when the next one arrives', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1)], new Date('2026-10-28T11:00:00-04:00'));
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        // Two hours later, still not "now", but the first item can't wait any longer.
        await arrive([mail(2)], new Date('2026-10-28T13:01:00-04:00'));
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(lastRun()!.prompt).toContain('waited long enough');
        expect(lastRun()!.prompt).toContain('Newsletter 1');
        expect(lastRun()!.prompt).toContain('Newsletter 2');
    });

    it("uses the chat's own max wait", async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        const patient = { ...page, proactive: { ...page.proactive, maxWaitMinutes: 240 } };
        await arrive([mail(1)], new Date('2026-10-28T09:00:00-04:00'), patient);
        await arrive([mail(2)], new Date('2026-10-28T12:00:00-04:00'), patient);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
    });

    it('holds overdue news in quiet hours', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1)], new Date('2026-10-28T20:00:00-04:00'));
        await arrive([mail(2)], NIGHT);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(pileKeys()).toEqual(['mail:1', 'mail:2']);
    });

    it('lets "now" news through quiet hours, and none when quiet hours are off', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency: 3, drop: [] });
        await arrive([mail(1, 'Flight cancelled')], NIGHT);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));

        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        const awake = {
            ...page,
            proactive: {
                ...page.proactive,
                quietHours: { enabled: false, start: '22:00', end: '07:00' },
            },
        };
        await arrive([mail(2)], new Date('2026-10-28T21:00:00-04:00'), awake);
        await arrive([mail(3)], NIGHT, awake);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(2));
    });

    it('the morning brief takes in the pile, and the items leave it', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1, 'Book fair next week')], NIGHT);
        vi.setSystemTime(new Date('2026-10-29T07:30:00-04:00'));
        expect(await runDailyBrief(page, 'u1')).toBe(true);
        expect(lastRun()!.prompt).toContain('daily brief');
        expect(lastRun()!.prompt).toContain('Book fair next week');
        expect(lastRun()!.proactiveMeta).toEqual({ kind: 'brief' });
        // A brief is never a revision.
        expect(lastRun()!.revise).toBeUndefined();
        expect(pileKeys()).toEqual([]);
    });

    it('the max-wait flush sends one summary and empties the pile', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1), mail(2)]);
        expect(await flushPendingNews(page, 'u1')).toBe(true);
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(lastRun()!.prompt).toContain('waited long enough');
        expect(pileKeys()).toEqual([]);
    });

    it('keeps the pile when the bot could not run', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1)]);
        vi.mocked(findBotTemplateById).mockResolvedValueOnce(null);
        expect(await flushPendingNews(page, 'u1')).toBe(false);
        expect(pileKeys()).toEqual(['mail:1']);
    });

    it('stops calling the model once the daily budget is spent, and goes by the signals', async () => {
        store.budgetLeft = 1;
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await arrive([mail(1)]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        await arrive([mail(2)]);
        // Out of budget: no model call, no clash, so it waits.
        expect(triagePile).toHaveBeenCalledTimes(1);
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(pileKeys()).toEqual(['mail:2']);
    });

    it('the "every item" escape hatch posts each batch without triage', async () => {
        const eager = { ...page, proactive: { ...page.proactive, everyItem: true } };
        vi.setSystemTime(NIGHT);
        vi.mocked(findProactivePages).mockResolvedValue([eager]);
        await handleDeviceDataChanges('u1', [{ notebookId: 'n1', entries: [mail(1)] }] as never);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(triagePile).not.toHaveBeenCalled();
        expect(lastRun()!.revise).toBeUndefined();
    });
});

describe('revising an unread post', () => {
    const earlier = (over: Record<string, unknown> = {}) => ({
        id: 'earlier',
        userBotId: 'bot',
        senderType: 'bot',
        content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Practice at 5' }] }],
        },
        proactiveMeta: { kind: 'news', urgency: 2 },
        createdAt: '2026-10-28T13:30:00.000Z',
        ...over,
    });

    async function postNews(urgency: number, headline = 'Practice moved to Westside') {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency, headline, drop: [] });
        await arrive([mail(9, 'Practice moved')]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        return lastRun()!;
    }

    it('revises the latest post when the owner has not read it, with no push', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([earlier()] as any);
        vi.mocked(getLastReadAtByPageId).mockResolvedValue(new Date('2026-10-28T13:00:00.000Z'));
        const run = await postNews(2);
        expect(run.revise).toEqual({ messageId: 'earlier' });
        expect(run.prompt).toContain('still unread');
        expect(run.prompt).toContain('Practice at 5');
        expect(getLastReadAtByPageId).toHaveBeenCalledWith('u1', 'page');
    });

    it('pushes once, saying what changed, when urgency rises', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([earlier()] as any);
        const run = await postNews(3, 'Practice cancelled tonight');
        expect(run.revise).toEqual({ messageId: 'earlier', push: 'Practice cancelled tonight' });
        expect(run.proactiveMeta).toEqual({ kind: 'news', urgency: 3 });
    });

    it('keeps the higher urgency when a calmer update revises the post', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([earlier()] as any);
        const run = await postNews(1);
        expect(run.revise).toEqual({ messageId: 'earlier' });
        expect(run.proactiveMeta).toEqual({ kind: 'news', urgency: 2 });
    });

    it('posts a new message once the owner has read it', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([earlier()] as any);
        vi.mocked(getLastReadAtByPageId).mockResolvedValue(new Date('2026-10-28T13:45:00.000Z'));
        expect((await postNews(2)).revise).toBeUndefined();
    });

    it('compares the read marker with the latest revision', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([
            earlier({ revisedAt: '2026-10-28T14:00:00.000Z' }),
        ] as any);
        // Read after the first version but before the revision: still unread.
        vi.mocked(getLastReadAtByPageId).mockResolvedValue(new Date('2026-10-28T13:45:00.000Z'));
        expect((await postNews(2)).revise).toEqual({ messageId: 'earlier' });
    });

    it('posts a new message when something came after it, or someone replied to it', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([
            { id: 'later', userId: 'u2', senderType: 'user', createdAt: '2026-10-28T13:40:00Z' },
        ] as any);
        expect((await postNews(2)).revise).toBeUndefined();

        vi.mocked(botExecutor.runProactive).mockClear();
        vi.mocked(triagePile).mockClear();
        vi.mocked(findMessagesByPageId).mockResolvedValue([earlier({ hasThread: true })] as any);
        expect((await postNews(2)).revise).toBeUndefined();
    });

    it('never revises a brief, an auto-reply or an old post', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([
            earlier({ proactiveMeta: { kind: 'brief' } }),
        ] as any);
        expect((await postNews(2)).revise).toBeUndefined();

        for (const latest of [
            earlier({ proactiveMeta: undefined }),
            earlier({ createdAt: '2026-10-27T13:30:00.000Z' }),
        ]) {
            vi.mocked(botExecutor.runProactive).mockClear();
            vi.mocked(triagePile).mockClear();
            vi.mocked(findMessagesByPageId).mockResolvedValue([latest] as any);
            expect((await postNews(2)).revise).toBeUndefined();
        }
    });
});
