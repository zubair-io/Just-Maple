import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Now or wait, the pending pile, and revising unread posts (proactive-bot.service). The
// pile, its lease and its compare-and-set writes are the real ones, in the test database.

const store = vi.hoisted(() => ({
    budgetLeft: 100,
    shared: null as Set<string> | null,
    /** The owner's calendar events today and tomorrow (device items). */
    events: [] as Record<string, unknown>[],
    /** About me: people related to the owner, as [name, relation]. */
    people: [] as [string, string][],
}));

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
// What the chat's data pages share: everything, unless a test narrows it.
vi.mock('../device-data-access.service', () => ({
    dataPageSlicesFor: vi.fn(async (userId: string) => [
        {
            ownerId: userId,
            match: (item: { id: string }) => !store.shared || store.shared.has(item.id),
        },
    ]),
}));
vi.mock('../../repositories/device-item.repo', () => ({
    findDeviceItemsByIds: vi.fn(async (_userId: string, ids: string[]) =>
        ids.map((id) => ({ id })),
    ),
    findDeviceItems: vi.fn(async () => ({ items: store.events, total: store.events.length })),
}));
vi.mock('../../repositories/profile.repo', () => ({
    findMe: vi.fn(async () => ({ id: 'me', kind: 'person', name: 'Me', aliases: [] })),
    listEntities: vi.fn(async () =>
        store.people.map(([name], n) => ({ id: `p${n}`, kind: 'person', name, aliases: [] })),
    ),
    listRelations: vi.fn(async () =>
        store.people.map(([, type], n) => ({ from: 'me', to: `p${n}`, type })),
    ),
}));
vi.mock('../../repositories/proactive-pile.repo', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    takeTriageCall: vi.fn(async () => store.budgetLeft-- > 0),
}));
vi.mock('../proactive-triage.service', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    triageModelAvailable: () => true,
    triagePile: vi.fn(),
}));

import {
    briefPrompt,
    checkWaitingReplies,
    flushPendingNews,
    handleDeviceDataChanges,
    processPile,
    proactiveSystemPrompt,
    proactiveUserPrompt,
    runDailyBrief,
    whenIdle,
} from '../proactive-bot.service';
import { mongoAvailable } from '../../__tests__/setup';
import { addToPile, getPile, MAX_PILE_ITEMS } from '../../repositories/proactive-pile.repo';
import { botExecutor } from '../bot-executor.service';
import { getMacDataToolContext } from '../mac-data-tools.service';
import { findProactivePages } from '../../repositories/page.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findMessagesByPageId } from '../../repositories/message.repo';
import { getLastReadAtByPageId } from '../../repositories/unread.repo';
import { overlapNewsFor } from '../calendar-overlap.service';
import { triagePile, triageSystemPrompt } from '../proactive-triage.service';

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

/**
 * A new calendar event: something no notification told the user, so it always gets a
 * triage (unlike a lone text or email, which is held in code).
 */
const event = (n: number, snippet = `Event ${n}`) => ({
    kind: 'added',
    item: {
        id: `calendar:${n}`,
        source: 'calendar',
        when: '2026-11-20T10:00:00-05:00',
        snippet,
        score: 0,
    },
});

/** A text from someone else; `fromMe` for the user's own. Unanswered unless said otherwise. */
const text = (
    n: number,
    snippet: string,
    options: { sender?: string; when?: string; fromMe?: boolean; lastFromMe?: string } = {},
) => {
    const when = options.when ?? '2026-10-28T14:00:00-04:00';
    const sender = options.sender ?? 'Jennifer Pelham';
    return {
        kind: 'added',
        item: {
            id: `imessage:${n}`,
            source: 'imessage',
            when,
            sender: options.fromMe ? 'Me' : sender,
            participants: [sender],
            ...(options.fromMe ? { fromMe: true } : {}),
            snippet,
            score: 0,
        },
        conversation: {
            ...(options.lastFromMe ? { lastFromMe: options.lastFromMe } : {}),
            ...(options.fromMe ? { lastFromMe: when } : { lastFromThem: when }),
            recent: [],
        },
    };
};

/** Wednesday 2 pm in New York: outside the default quiet hours. */
const AFTERNOON = new Date('2026-10-28T14:00:00-04:00');
/** 11:30 pm: inside them. */
const NIGHT = new Date('2026-10-28T23:30:00-04:00');

async function arrive(entries: unknown[], at = AFTERNOON, onPage = page) {
    vi.setSystemTime(at);
    vi.mocked(findProactivePages).mockResolvedValue([onPage]);
    await handleDeviceDataChanges('u1', [{ notebookId: 'n1', entries }] as never);
    // The pass runs in the page queue; wait until it has settled.
    await whenIdle('page');
}

const pileKeys = async () => ((await getPile('page'))?.items ?? []).map((i) => i.key);
const lastRun = () => vi.mocked(botExecutor.runProactive).mock.calls.at(-1)?.[0];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.clearAllMocks();
    store.budgetLeft = 100;
    store.shared = null;
    store.events = [];
    store.people = [];
    // Calendar items get an overlap check; by default it finds nothing.
    vi.mocked(overlapNewsFor).mockResolvedValue(undefined as never);
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

describe.runIf(mongoAvailable)('now or wait', () => {
    it('posts right away when the triage says now, and empties the pile', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency: 3, drop: [] });
        await arrive([event(1, 'Pick up Sam at 4')]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(lastRun()!.prompt).toContain('Pick up Sam');
        expect(lastRun()!.proactiveMeta).toEqual({ kind: 'news', urgency: 3 });
        expect(await pileKeys()).toEqual([]);
    });

    it('keeps what can wait in the pile without posting', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 1, drop: [] });
        await arrive([event(1)]);
        expect(triagePile).toHaveBeenCalledTimes(1);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(await pileKeys()).toEqual(['calendar:1']);
    });

    it('re-scores the whole pile on every arrival, and posts once it tips', async () => {
        // One email alone is held in code: the user's phone already showed it to them.
        await arrive([mail(1, 'Team dinner idea')]);
        expect(triagePile).not.toHaveBeenCalled();
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
        expect(await pileKeys()).toEqual([]);
    });

    it('drops what the triage says is not worth telling at all', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 0, drop: [0] });
        await arrive([mail(1, '20% off'), mail(2, 'Field trip form due Friday')]);
        expect(await pileKeys()).toEqual(['mail:2']);
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

describe.runIf(mongoAvailable)('missed-only: no relaying what a notification showed', () => {
    const JEN = "My last meeting was canceled, I'm done at 2:30 today";
    const signalsSeen = () => vi.mocked(triagePile).mock.calls.at(-1)![0].signals;
    /** 2 pm plus `minutes`. */
    const later = (minutes: number) => new Date(+AFTERNOON + minutes * 60_000);

    it('a single fresh text is neither triaged nor posted, and is dropped once due', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 3, drop: [] });
        // She wrote last at 1:50; the user answered at 1:55. Nothing is owed.
        await arrive([
            text(1, JEN, {
                when: '2026-10-28T13:50:00-04:00',
                lastFromMe: '2026-10-28T13:55:00-04:00',
            }),
        ]);
        expect(triagePile).not.toHaveBeenCalled();
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(await pileKeys()).toEqual(['imessage:1']);
        // The max-wait summary has nothing to say: the text leaves without a post.
        vi.setSystemTime(later(125));
        expect(await flushPendingNews(page, 'u1')).toBe(true);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(triagePile).not.toHaveBeenCalled();
        expect(await pileKeys()).toEqual([]);
    });

    it('a single fresh email is held the same way', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 3, drop: [] });
        await arrive([mail(1, 'Your flight is cancelled')]);
        expect(triagePile).not.toHaveBeenCalled();
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
    });

    it('an unanswered question is told once its delay has passed, not before', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await arrive([text(1, 'Can you grab the cake on your way?')]);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        // Two hours later: past the max wait, still inside the three-hour reply delay. It
        // is kept (not dropped), and not told.
        vi.setSystemTime(later(125));
        expect(await flushPendingNews(page, 'u1')).toBe(true);
        expect(await checkWaitingReplies(page, 'u1')).toBe(true);
        expect(triagePile).not.toHaveBeenCalled();
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(await pileKeys()).toEqual(['imessage:1']);
        // Three hours, still unanswered: triaged with the signal, and told.
        vi.setSystemTime(later(185));
        expect(await checkWaitingReplies(page, 'u1')).toBe(true);
        expect(signalsSeen()).toContain('Unanswered for over 3 h: imessage:1');
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(lastRun()!.prompt).toContain('grab the cake');
        expect(lastRun()!.prompt).toContain('Unanswered for over 3 h');
        expect(await pileKeys()).toEqual([]);
    });

    it('a close person waits an hour, not three', async () => {
        store.people = [['Jennifer Pelham', 'spouse']];
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await arrive([text(1, 'Can you call the school?')]);
        vi.setSystemTime(later(55));
        await checkWaitingReplies(page, 'u1');
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        vi.setSystemTime(later(65));
        await checkWaitingReplies(page, 'u1');
        expect(signalsSeen()).toContain('Unanswered for over 1 h, from a close person: imessage:1');
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
    });

    it('a question the user has since answered is never told', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await arrive([text(1, 'Can you grab the cake on your way?')]);
        await arrive(
            [text(2, 'Sure', { fromMe: true, when: '2026-10-28T14:20:00-04:00' })],
            later(20),
        );
        vi.setSystemTime(later(200));
        await checkWaitingReplies(page, 'u1');
        await flushPendingNews(page, 'u1');
        expect(triagePile).not.toHaveBeenCalled();
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        expect(await pileKeys()).toEqual([]);
    });

    it("a text that moves one of today's events is posted now", async () => {
        store.events = [
            {
                id: 'calendar:soccer',
                source: 'calendar',
                title: 'Soccer practice',
                location: 'Eastside park',
                occurredAt: Date.parse('2026-10-28T16:00:00-04:00') / 1000,
            },
        ];
        vi.mocked(triagePile).mockResolvedValueOnce({
            now: true,
            urgency: 3,
            headline: 'Practice moved to 5pm',
            drop: [],
        });
        await arrive([text(1, 'Practice moved to 5pm tonight', { sender: 'Coach Dan' })]);
        expect(signalsSeen()).toEqual([
            'May change the user\'s plans: imessage:1 mentions their event "Soccer practice" (2026-10-28T16:00:00-04:00)',
        ]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(lastRun()!.prompt).toContain('Practice moved to 5pm');
        expect(lastRun()!.prompt).toContain('May change the user');
    });

    it("the complaint's text, about someone else's day, touches none of the user's plans", async () => {
        store.events = [
            {
                id: 'calendar:party',
                source: 'calendar',
                title: 'Greyson pizza party',
                occurredAt: Date.parse('2026-10-28T15:00:00-04:00') / 1000,
            },
        ];
        await arrive([text(1, JEN)]);
        expect(triagePile).not.toHaveBeenCalled();
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
    });

    it('several related messages across threads go out as one post', async () => {
        await arrive([text(1, 'Is the party still on Saturday?', { sender: 'Ana' })]);
        expect(triagePile).not.toHaveBeenCalled();
        vi.mocked(triagePile).mockResolvedValueOnce({
            now: true,
            urgency: 2,
            headline: 'Three parents asking about the party',
            drop: [],
        });
        await arrive(
            [
                text(2, 'Are we doing the party Saturday?', { sender: 'Ben' }),
                mail(3, 'Party venue cancelled our booking'),
            ],
            later(10),
        );
        // The triage sees all three, the earlier held one too.
        const pile = vi.mocked(triagePile).mock.calls[0]![0].items;
        expect(pile.map((i) => i.text)).toEqual([
            'Is the party still on Saturday?',
            'Are we doing the party Saturday?',
            'Party venue cancelled our booking',
        ]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(lastRun()!.prompt).toContain('Ana');
        expect(lastRun()!.prompt).toContain('venue cancelled');
        expect(await pileKeys()).toEqual([]);
    });

    it('"every item" still relays a single text, facts only', async () => {
        const eager = { ...page, proactive: { ...page.proactive, everyItem: true } };
        await arrive([text(1, JEN)], AFTERNOON, eager);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(triagePile).not.toHaveBeenCalled();
        expect(lastRun()!.prompt).toContain('done at 2:30');
        expect(lastRun()!.system).toContain("Never guess at people's availability");
        expect(lastRun()!.system).not.toContain('never just repeat one');
    });
});

describe('posting prompts: facts only', () => {
    const rules = [
        "Never guess at people's availability, intentions or feelings",
        'No suggestions or advice. When there is a concrete conflict, name the conflict',
        'No remarks about the message itself',
        'she may be free to help with party prep or pickup', // the bad example
    ];

    it('the news posting prompt has the no-speculation rules and the missed-only rule', () => {
        const system = proactiveSystemPrompt('Maple', page, '');
        for (const rule of rules) expect(system).toContain(rule);
        expect(system).toContain('never just repeat one');
        expect(system).toContain('reply NO_UPDATE');
        const prompt = proactiveUserPrompt('now', [], []);
        expect(prompt).toContain('never restate one on its own');
        expect(prompt).toContain('no guesses about people');
    });

    it('"every item" keeps relaying, with the same no-speculation rules', () => {
        const eager = { ...page, proactive: { ...page.proactive, everyItem: true } };
        const system = proactiveSystemPrompt('Maple', eager, '');
        for (const rule of rules) expect(system).toContain(rule);
        expect(system).not.toContain('never just repeat one');
        expect(proactiveUserPrompt('now', [], [], { relay: true })).not.toContain('never restate');
    });

    it('revisions and the morning brief are held to them too', () => {
        expect(proactiveUserPrompt('now', [], [], { revising: 'Practice at 5' })).toContain(
            'The Facts only rules apply to the revision too',
        );
        const brief = briefPrompt('now');
        expect(brief).toContain('never speculate');
        expect(brief).toContain("no guesses about people's availability, intentions or feelings");
    });

    it('the triage is told the phone already notified the user', () => {
        const triage = triageSystemPrompt();
        expect(triage).toContain('only for what they may have MISSED');
        expect(triage).toContain('A fresh one is never urgent');
    });
});

describe.runIf(mongoAvailable)('limits', () => {
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
        expect(await pileKeys()).toEqual(['mail:1', 'mail:2']);
    });

    it('lets "now" news through quiet hours, and none when quiet hours are off', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency: 3, drop: [] });
        await arrive([event(1, 'Flight cancelled')], NIGHT);
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
        expect(await pileKeys()).toEqual([]);
    });

    it('the max-wait flush sends one summary and empties the pile', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([mail(1), mail(2)]);
        expect(await flushPendingNews(page, 'u1')).toBe(true);
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(lastRun()!.prompt).toContain('waited long enough');
        expect(await pileKeys()).toEqual([]);
    });

    it('keeps the pile when the bot could not run', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([event(1)]);
        vi.mocked(findBotTemplateById).mockResolvedValueOnce(null);
        expect(await flushPendingNews(page, 'u1')).toBe(false);
        expect(await pileKeys()).toEqual(['calendar:1']);
    });

    it('stops calling the model once the daily budget is spent, and goes by the signals', async () => {
        store.budgetLeft = 1;
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await arrive([event(1)]);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        await arrive([event(2)]);
        // Out of budget: no model call, no clash, so it waits.
        expect(triagePile).toHaveBeenCalledTimes(1);
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(await pileKeys()).toEqual(['calendar:2']);
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

describe.runIf(mongoAvailable)('revising an unread post', () => {
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
        await arrive([event(9, 'Practice moved')]);
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

    it('never revises a post the owner read after it was posted, even before a revision', async () => {
        vi.mocked(findMessagesByPageId).mockResolvedValue([
            earlier({ revisedAt: '2026-10-28T14:00:00.000Z' }),
        ] as any);
        // Read after the first version, before the revision: it has been read.
        vi.mocked(getLastReadAtByPageId).mockResolvedValue(new Date('2026-10-28T13:45:00.000Z'));
        expect((await postNews(2)).revise).toBeUndefined();
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

describe.runIf(mongoAvailable)('several API instances, filters and limits', () => {
    const tz = 'America/New_York';
    /** Holds the bot's run open until `finish()`, so another pass can run meanwhile. */
    function slowRun() {
        let finish!: () => void;
        const done = new Promise<void>((resolve) => (finish = resolve));
        vi.mocked(botExecutor.runProactive).mockImplementationOnce(async () => {
            await done;
            return { id: 'posted' } as any;
        });
        return finish;
    }

    it('two passes at once on one pile: one tells it, the other steps aside', async () => {
        vi.setSystemTime(AFTERNOON);
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await addToPile('page', 'u1', [mail(1), mail(2)] as never);
        const finish = slowRun();
        const first = processPile(page, 'u1', tz);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        // Another instance gets an upload for the same chat while the first is posting.
        expect(await processPile(page, 'u1', tz)).toBe('busy');
        finish();
        expect(await first).toBe('posted');
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(await pileKeys()).toEqual([]);
    });

    it('keeps items another instance added during a pass, and tells them once', async () => {
        vi.setSystemTime(AFTERNOON);
        vi.mocked(triagePile).mockResolvedValue({ now: true, urgency: 2, drop: [] });
        await addToPile('page', 'u1', [event(1)] as never);
        const finish = slowRun();
        const first = processPile(page, 'u1', tz);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        // Arrives elsewhere at the same moment: both stored (no overwrite), and that pass
        // steps aside.
        await Promise.all([
            addToPile('page', 'u1', [event(2)] as never),
            addToPile('page', 'u1', [event(3)] as never),
        ]);
        expect(await processPile(page, 'u1', tz)).toBe('busy');
        finish();
        await first;
        // The lease holder saw the new items after its post and told them too.
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(2);
        const [one, two] = vi.mocked(botExecutor.runProactive).mock.calls.map((c) => c[0].prompt);
        expect(one).not.toContain('Event 2');
        expect(two).toContain('Event 2');
        expect(two).toContain('Event 3');
        expect(two).not.toContain('Event 1');
        expect(await pileKeys()).toEqual([]);
    });

    it('a newer version that arrives while a post is written stays in the pile', async () => {
        vi.setSystemTime(AFTERNOON);
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency: 2, drop: [] });
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 1, drop: [] });
        await addToPile('page', 'u1', [event(1, 'Practice at 5')] as never);
        const finish = slowRun();
        const first = processPile(page, 'u1', tz);
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        await addToPile('page', 'u1', [{ ...event(1, 'Practice at 6'), kind: 'changed' }] as never);
        finish();
        await first;
        const pile = await getPile('page');
        expect(pile!.items.map((i) => i.entry.item.snippet)).toEqual(['Practice at 6']);
    });

    it('drops waiting items the chat no longer shares, before triage and before posting', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        await arrive([event(1, 'From the school'), event(2, 'From the bank')]);
        expect(await pileKeys()).toEqual(['calendar:1', 'calendar:2']);
        // The owner narrows the Calendar page's filter while they wait.
        store.shared = new Set(['calendar:1']);
        expect(await flushPendingNews(page, 'u1')).toBe(true);
        const prompt = lastRun()!.prompt;
        expect(prompt).toContain('From the school');
        expect(prompt).not.toContain('From the bank');
        expect(await pileKeys()).toEqual([]);

        store.shared = new Set();
        vi.mocked(triagePile).mockClear();
        await arrive([event(3, 'Hidden')]);
        expect(triagePile).not.toHaveBeenCalled();
        expect(await pileKeys()).toEqual([]);
    });

    it('folds more than the cap into a "+N more" count, keeping the true oldest time', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 1, drop: [] });
        const batch = (from: number, count: number) =>
            Array.from({ length: count }, (_, n) => mail(from + n));
        const first = new Date('2026-10-28T22:30:00-04:00'); // quiet hours: nothing goes out
        await arrive(batch(0, 40), first);
        await arrive(batch(40, 30), new Date('2026-10-28T23:00:00-04:00'));
        await arrive(batch(70, 5), new Date('2026-10-28T23:30:00-04:00'));
        const pile = (await getPile('page'))!;
        expect(pile.items).toHaveLength(MAX_PILE_ITEMS);
        expect(pile.overflow).toMatchObject({ count: 15, sources: { mail: 15 } });
        expect(pile.oldestAt).toEqual(first);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        // The triage hears about the folded items too.
        expect(vi.mocked(triagePile).mock.calls.at(-1)![0].signals).toContain(
            '+15 more older items not listed (mail 15)',
        );

        // Morning, outside quiet hours: a full pile goes out, folded count included.
        await arrive([mail(99)], new Date('2026-10-29T07:05:00-04:00'));
        expect(lastRun()!.prompt).toContain('+16 more older items');
        expect(await getPile('page')).toBeNull();
    });

    it('a clash whose post failed stays urgent, and goes out with the next pass', async () => {
        vi.mocked(triagePile).mockResolvedValue({ now: false, urgency: 0, drop: [] });
        const commit = vi.fn();
        vi.mocked(overlapNewsFor).mockResolvedValueOnce({
            flagged: [
                {
                    kind: 'overlap',
                    summary: 'Dental overlaps Pizza party',
                    events: [{ id: 'calendar:dental' }],
                },
            ],
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
        // The bot can't run this time.
        vi.mocked(findBotTemplateById).mockResolvedValueOnce(null);
        await arrive([calendar], NIGHT);
        expect(botExecutor.runProactive).not.toHaveBeenCalled();
        // Kept in the pile, urgent, so it isn't flagged (or lost) again.
        expect(commit).toHaveBeenCalled();
        expect((await getPile('page'))!.items[0]).toMatchObject({
            key: 'calendar:dental',
            urgent: true,
        });

        // Next pass: the triage says wait and it's night, but the clash is still urgent.
        await arrive([mail(1)], new Date('2026-10-28T23:45:00-04:00'));
        expect(botExecutor.runProactive).toHaveBeenCalledTimes(1);
        expect(lastRun()!.prompt).toContain('Dental overlaps Pizza party');
        expect(await pileKeys()).toEqual([]);
    });

    it('an earlier "now" whose post failed stays urgent', async () => {
        vi.mocked(triagePile).mockResolvedValueOnce({ now: true, urgency: 3, drop: [] });
        vi.mocked(botExecutor.runProactive).mockRejectedValueOnce(new Error('model down'));
        await arrive([event(1, 'Flight cancelled')], NIGHT);
        expect((await getPile('page'))!.items[0]!.urgent).toBe(true);
        vi.mocked(triagePile).mockResolvedValueOnce({ now: false, urgency: 0, drop: [] });
        await arrive([event(2)], NIGHT);
        expect(lastRun()!.prompt).toContain('Flight cancelled');
    });
});
