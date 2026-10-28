import { describe, expect, it } from 'vitest';
import {
    clashMarks,
    closeMatcher,
    closePeopleNames,
    compactItem,
    asks,
    closeAlarm,
    deterministicSignals,
    emptyContext,
    eventTouched,
    mailAlert,
    othersChange,
    relayOnly,
    type PileContext,
    fallbackVerdict,
    holdNews,
    inQuietHours,
    parseTriage,
} from '../proactive-triage.service';

const settings: any = { userBotId: 'b', instructions: '', enabled: true, ownerUserId: 'u' };
const NY = 'America/New_York';
const at = (local: string) => new Date(`${local}-04:00`);

const item = (entry: any) => ({ key: entry.item.id, entry, addedAt: new Date(), rev: 0 });
/** Who the user is, and who is close to them. */
const context = (close: string[] = []): PileContext => ({
    ...emptyContext,
    isClose: closeMatcher(close),
    myNames: new Set(['zubair lawrence']),
});

describe('quiet hours', () => {
    it('defaults to 10pm to 7am in the owner’s zone, across midnight', () => {
        expect(inQuietHours(settings, at('2026-10-28T21:59:00'), NY)).toBe(false);
        expect(inQuietHours(settings, at('2026-10-28T22:00:00'), NY)).toBe(true);
        expect(inQuietHours(settings, at('2026-10-29T03:00:00'), NY)).toBe(true);
        expect(inQuietHours(settings, at('2026-10-29T07:00:00'), NY)).toBe(false);
        // The same moment is 3am in New York but 8am in London.
        expect(inQuietHours(settings, at('2026-10-29T03:00:00'), 'Europe/London')).toBe(false);
    });

    it('follows the chat’s own hours, or none', () => {
        const day = { ...settings, quietHours: { enabled: true, start: '13:00', end: '15:00' } };
        expect(inQuietHours(day, at('2026-10-28T14:00:00'), NY)).toBe(true);
        expect(inQuietHours(day, at('2026-10-28T23:00:00'), NY)).toBe(false);
        const off = { ...settings, quietHours: { enabled: false, start: '22:00', end: '07:00' } };
        expect(inQuietHours(off, at('2026-10-28T23:00:00'), NY)).toBe(false);
    });

    it('also holds news in the hour before the daily brief', () => {
        const briefed = { ...settings, briefTime: '07:30' };
        expect(holdNews(briefed, at('2026-10-29T07:10:00'), NY)).toBe(true);
        expect(holdNews(briefed, at('2026-10-29T07:31:00'), NY)).toBe(false);
        expect(holdNews(settings, at('2026-10-29T07:10:00'), NY)).toBe(false);
    });
});

describe('signals found in code', () => {
    const now = at('2026-10-28T12:00:00');

    it('a calendar clash marks its item urgent, and urgent items always go out now', () => {
        const dental = {
            kind: 'changed',
            item: {
                id: 'calendar:dental',
                source: 'calendar',
                when: '',
                snippet: 'Dental',
                score: 0,
            },
        } as any;
        const marks = clashMarks([dental], {
            flagged: [
                {
                    kind: 'overlap',
                    summary: 'Dental overlaps Party',
                    events: [{ id: 'calendar:party' } as any, { id: 'calendar:dental' } as any],
                },
            ],
            cleared: [{ kind: 'overlap', summary: 'Gym and Lunch', events: [] }],
        } as any);
        expect([...marks.urgent]).toEqual(['calendar:dental']);
        expect(marks.notes.get('calendar:dental')).toEqual([
            'New calendar clash: Dental overlaps Party',
            'Clash cleared: Gym and Lunch',
        ]);
        const signals = deterministicSignals(
            [{ ...item(dental), urgent: true, notes: marks.notes.get('calendar:dental') }],
            now,
        );
        expect(signals.forceNow).toBe(true);
        expect(signals.notes[0]).toBe('New calendar clash: Dental overlaps Party');
        expect(fallbackVerdict(signals)).toMatchObject({ now: true, urgency: 2 });
        expect(fallbackVerdict(deterministicSignals([], now))).toMatchObject({ now: false });
    });

    it('notes changed events starting soon, threads waiting on the user and big piles', () => {
        const changed = item({
            kind: 'changed',
            item: {
                id: 'calendar:1',
                source: 'calendar',
                when: '2026-10-28T17:00:00-04:00',
                sender: 'Coach Dan',
                snippet: 'Game',
                score: 0,
            },
        });
        const waiting = item({
            kind: 'added',
            item: {
                id: 'imessage:1',
                source: 'imessage',
                when: '2026-10-28T11:00:00-04:00',
                snippet: 'Dinner?',
                score: 0,
            },
            conversation: {
                lastFromMe: '2026-10-28T09:00:00-04:00',
                lastFromThem: '2026-10-28T11:00:00-04:00',
                recent: [],
            },
        });
        const answered = item({
            ...waiting.entry,
            item: { ...waiting.entry.item, id: 'imessage:2' },
            conversation: {
                lastFromMe: '2026-10-28T11:30:00-04:00',
                lastFromThem: '2026-10-28T11:00:00-04:00',
                recent: [],
            },
        });
        // An hour after the text, it isn't overdue yet: they just got the notification.
        expect(
            deterministicSignals([changed, waiting, answered], now, undefined, context()).notes,
        ).toEqual(['Calendar event changed by Coach Dan, starts within a day: calendar:1']);
        const notes = deterministicSignals(
            [changed, waiting, answered],
            at('2026-10-28T14:05:00'),
            undefined,
            context(),
        ).notes;
        expect(notes).toEqual([
            'Calendar event changed by Coach Dan, starts within a day: calendar:1',
            'Unanswered for over 3 h: imessage:1',
        ]);
        // The user's own change (they organize it, or nobody is named) is no news to them.
        const own = (sender?: string) =>
            item({ ...changed.entry, item: { ...changed.entry.item, sender } });
        expect(
            deterministicSignals([own('Zubair Lawrence')], now, undefined, context()).notes,
        ).toEqual([]);
        expect(deterministicSignals([own(undefined)], now, undefined, context()).notes).toEqual([]);
        // Without knowing the user's names, nothing is evidence of someone else.
        expect(othersChange(changed, emptyContext)).toBe(false);
        // From a close person, an hour is enough.
        const close = deterministicSignals(
            [
                {
                    ...waiting,
                    entry: {
                        ...waiting.entry,
                        item: { ...waiting.entry.item, sender: 'Emma Lee' },
                    },
                },
            ],
            at('2026-10-28T12:05:00'),
            undefined,
            context(['emma lee']),
        ).notes;
        expect(close).toEqual(['Unanswered for over 1 h, from a close person: imessage:1']);
        expect(compactItem(waiting, 0, true)).toMatchObject({
            n: 0,
            new: true,
            awaitingReply: true,
        });
        expect(compactItem(answered, 1, false).awaitingReply).toBeUndefined();

        const pile = Array.from({ length: 12 }, (_, n) =>
            item({
                kind: 'added',
                item: { id: `mail:${n}`, source: 'mail', when: '', snippet: '', score: 0 },
            }),
        );
        expect(deterministicSignals(pile, now).notes.at(-1)).toContain('12 items');
        // Folded items count, and are named.
        const folded = deterministicSignals(pile.slice(0, 2), now, {
            count: 9,
            sources: { mail: 7, imessage: 2 },
            oldestAt: now,
        }).notes;
        expect(folded).toEqual([
            '11 items are pending; together they may be worth a summary.',
            '+9 more older items not listed (mail 7, imessage 2)',
        ]);
    });
});

describe('missed-only checks in code', () => {
    const now = at('2026-10-28T14:00:00');
    const message = (id: string, sender: string, snippet: string, source = 'imessage') =>
        item({
            kind: 'added',
            item: { id, source, when: '2026-10-28T13:59:00-04:00', sender, snippet, score: 0 },
            conversation: { lastFromThem: '2026-10-28T13:59:00-04:00', recent: [] },
        });

    it('holds one message from someone else, and nothing more', () => {
        const ctx = context();
        const jen = message('imessage:1', 'Jen', 'Done at 2:30 today');
        expect(relayOnly([jen], undefined, now, ctx)).toBe(true);
        // The user's own messages don't count.
        const mine = item({
            ...jen.entry,
            item: { ...jen.entry.item, id: 'imessage:2', sender: 'Me', fromMe: true },
        });
        expect(relayOnly([jen, mine], undefined, now, ctx)).toBe(true);
        // Two threads, someone else's calendar change, something urgent, kept or folded:
        // the triage looks.
        const mail = message('mail:1', 'School', 'Party moved', 'mail');
        expect(relayOnly([jen, mail], undefined, now, ctx)).toBe(false);
        const event = (sender?: string) =>
            item({
                kind: 'changed',
                item: {
                    id: 'calendar:1',
                    source: 'calendar',
                    when: '',
                    sender,
                    snippet: 'Game',
                    score: 0,
                },
            });
        expect(relayOnly([event('Coach Dan')], undefined, now, ctx)).toBe(false);
        // The user's own change is held like a text.
        expect(relayOnly([event('Zubair Lawrence')], undefined, now, ctx)).toBe(true);
        expect(relayOnly([event()], undefined, now, ctx)).toBe(true);
        expect(relayOnly([{ ...jen, urgent: true }], undefined, now, ctx)).toBe(false);
        // The triage saw it and kept it: code never drops it after that.
        expect(relayOnly([{ ...jen, kept: true }], undefined, now, ctx)).toBe(false);
        expect(relayOnly([jen], { count: 1, sources: { mail: 1 }, oldestAt: now }, now, ctx)).toBe(
            false,
        );
        // Not a question: never overdue, however long it waits.
        expect(relayOnly([jen], undefined, at('2026-10-28T17:00:00'), ctx)).toBe(true);
        // A question unanswered past its delay: no longer held.
        const ask = message('imessage:3', 'Jen', 'Can you grab the cake?');
        expect(relayOnly([ask], undefined, at('2026-10-28T16:30:00'), ctx)).toBe(true);
        expect(relayOnly([ask], undefined, at('2026-10-28T17:00:00'), ctx)).toBe(false);
        // ...unless the user has answered since, as their stored messages show.
        const replied: PileContext = {
            ...ctx,
            repliedAt: new Map([['imessage:3', Date.parse('2026-10-28T14:10:00-04:00')]]),
        };
        expect(relayOnly([ask], undefined, at('2026-10-28T17:00:00'), replied)).toBe(true);
    });

    it('counts only questions and requests as awaiting a reply', () => {
        const said = (snippet: string) => message('imessage:1', 'Jen', snippet);
        for (const snippet of [
            'Dinner?',
            'Can you grab the cake',
            'pls send the form',
            'lmk when you land',
            'Are you coming tonight',
            'What time is pickup',
        ])
            expect(asks(said(snippet)), snippet).toBe(true);
        for (const snippet of ['lol', 'ok', 'Done at 2:30 today', 'Love you'])
            expect(asks(said(snippet)), snippet).toBe(false);
    });

    it('group banter is held; a plan or request in the group goes to the triage', () => {
        const ctx = context();
        const group = ['Ana', 'Ben', 'Cy'];
        const said = (n: number, sender: string, snippet: string) =>
            item({
                kind: 'added',
                item: {
                    id: `imessage:${n}`,
                    source: 'imessage',
                    when: '2026-10-28T13:59:00-04:00',
                    sender,
                    participants: group,
                    snippet,
                    score: 0,
                },
                conversation: { lastFromThem: '2026-10-28T13:59:00-04:00', recent: [] },
            });
        const banter = [said(1, 'Ana', 'haha'), said(2, 'Ben', 'lmao'), said(3, 'Cy', 'classic')];
        expect(relayOnly(banter, undefined, now, ctx)).toBe(true);
        expect(
            relayOnly(
                [...banter, said(4, 'Ana', 'Pizza at mine tomorrow at 6?')],
                undefined,
                now,
                ctx,
            ),
        ).toBe(false);
    });

    it('a lone email goes to the triage when it carries a request, deadline or alert', () => {
        const mail = (snippet: string) => message('mail:1', 'Someone', snippet, 'mail');
        for (const snippet of [
            'Your flight is cancelled',
            'Please sign the permission slip by Friday',
            'Confirm your appointment',
            'New sign-in to your account',
            'Your package delivery is delayed',
            'Booking for tomorrow at 7:30 pm',
            'Can you send the report by tomorrow',
        ])
            expect(mailAlert(mail(snippet)), snippet).toBe(true);
        for (const snippet of [
            'Weekly newsletter: 10 recipes',
            '20% off everything. Unsubscribe',
            'Your receipt from Coffee Co',
            'Thanks for your order! Free delivery on Tuesday',
            'Photos from the weekend',
        ])
            expect(mailAlert(mail(snippet)), snippet).toBe(false);
        // A security alert in a promotional mail still counts.
        expect(mailAlert(mail('Suspicious sign-in attempt. Unsubscribe'))).toBe(true);
        expect(relayOnly([mail('Your flight is cancelled')], undefined, now, context())).toBe(
            false,
        );
        expect(relayOnly([mail('Weekly newsletter')], undefined, now, context())).toBe(true);
    });

    it('trouble from a close person goes to the triage at once; from others it is held', () => {
        const car = message('imessage:1', 'Emma Lee', 'Car broke down on 87');
        expect(closeAlarm(car, context(['emma lee']))).toBe(true);
        expect(closeAlarm(car, context())).toBe(false);
        expect(
            closeAlarm(message('imessage:2', 'Emma Lee', 'see you soon'), context(['emma lee'])),
        ).toBe(false);
        expect(relayOnly([car], undefined, now, context(['emma lee']))).toBe(false);
        expect(relayOnly([car], undefined, now, context())).toBe(true);
    });

    it('finds close people in About me, in either direction, by exact name or alias', () => {
        const names = closePeopleNames(
            'me',
            [
                { id: 'me', kind: 'person', name: 'Zubair', aliases: [] },
                { id: 'e', kind: 'person', name: 'Emma Lee', aliases: ['Em'] },
                { id: 'm', kind: 'person', name: 'Mom', aliases: ['Sara'] },
                { id: 'c', kind: 'person', name: 'Coach Dan', aliases: [] },
                { id: 'd', kind: 'pet', name: 'Rex', aliases: [] },
            ],
            [
                { from: 'me', to: 'e', type: 'child' },
                { from: 'm', to: 'me', type: 'Mother' },
                { from: 'me', to: 'c', type: 'coach' },
                { from: 'me', to: 'd', type: 'family' },
            ],
        );
        expect(names).toEqual(['emma lee', 'em', 'mom', 'sara']);
        const isClose = closeMatcher(names);
        expect(isClose('Emma Lee')).toBe(true);
        expect(isClose('emma  lee')).toBe(true);
        // A first name only when an alias is exactly that name.
        expect(isClose('Sara')).toBe(true);
        expect(isClose('Em')).toBe(true);
        // Never by a shared first name or prefix, in either direction.
        expect(isClose('Sara Khan')).toBe(false);
        expect(isClose('Emma')).toBe(false);
        expect(isClose('Emma Stone')).toBe(false);
        expect(isClose('Coach Dan')).toBe(false);
        expect(isClose(undefined)).toBe(false);
        expect(closePeopleNames(undefined, [], [])).toEqual([]);
    });

    it("matches a timing message to one of the user's events by a distinctive word", () => {
        const events = [
            { id: 'calendar:party', title: 'Greyson pizza party', when: '3:00 PM' },
            {
                id: 'calendar:soccer',
                title: 'Soccer practice',
                location: 'Westside field',
                when: '4 PM',
            },
            { id: 'calendar:sync', title: 'Team meeting', when: '5 PM' },
        ];
        const said = (snippet: string) => message('imessage:1', 'Jen', snippet);
        expect(eventTouched(said('Practice moved to 5pm'), events)?.id).toBe('calendar:soccer');
        expect(eventTouched(said('Meet at Westside instead'), events)?.id).toBe('calendar:soccer');
        // The complaint's text: about her own meeting, not the user's events.
        expect(
            eventTouched(said("My last meeting was canceled, I'm done at 2:30 today"), events),
        ).toBeUndefined();
        // Mentions an event, but nothing about timing.
        expect(eventTouched(said('Pizza was great!'), events)).toBeUndefined();
    });

    it("matches a message from one of the event's people, without the event's words", () => {
        const events = [
            {
                id: 'calendar:coffee',
                title: 'Coffee',
                people: ['Jen Pelham', 'jen@example.com'],
                when: '3 PM',
            },
            { id: 'calendar:lunch', title: 'Lunch with Ana Ruiz', when: '1 PM' },
        ];
        const from = (sender: string, snippet: string) => message('imessage:1', sender, snippet);
        expect(eventTouched(from('Jen Pelham', 'Can we push to 3:30?'), events)?.id).toBe(
            'calendar:coffee',
        );
        expect(eventTouched(from('jen@example.com', 'Running late'), events)?.id).toBe(
            'calendar:coffee',
        );
        // Named in the event's title.
        expect(eventTouched(from('Ana Ruiz', 'Running late'), events)?.id).toBe('calendar:lunch');
        // A first name in the title counts too ("Coffee with Ana").
        expect(eventTouched(from('Ana', 'Running late'), events)?.id).toBe('calendar:lunch');
        // Someone else, or no timing at all.
        expect(eventTouched(from('Ben', 'Running late'), events)).toBeUndefined();
        expect(eventTouched(from('Rui', 'Running late'), events)).toBeUndefined();
        expect(eventTouched(from('Jen Pelham', 'Love that'), events)).toBeUndefined();
    });
});

describe('parseTriage', () => {
    it('reads the verdict and ignores drops outside the pile', () => {
        expect(
            parseTriage(
                '```json\n{"now":true,"urgency":7,"headline":" Practice  moved ","drop":[0,5,"x"]}\n```',
                2,
            ),
        ).toEqual({ now: true, urgency: 3, headline: 'Practice moved', drop: [0] });
        expect(parseTriage('{"now":false}', 1)).toEqual({ now: false, urgency: 1, drop: [] });
    });

    it('gives up on anything else', () => {
        expect(parseTriage('Sure! It can wait.', 1)).toBeNull();
        expect(parseTriage('{"urgency":2}', 1)).toBeNull();
        expect(parseTriage('{"now":', 1)).toBeNull();
    });
});
