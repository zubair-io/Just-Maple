import { describe, expect, it } from 'vitest';
import {
    clashMarks,
    closeMatcher,
    closePeopleNames,
    compactItem,
    deterministicSignals,
    eventTouched,
    nobodyClose,
    relayOnly,
    fallbackVerdict,
    holdNews,
    inQuietHours,
    parseTriage,
} from '../proactive-triage.service';

const settings: any = { userBotId: 'b', instructions: '', enabled: true, ownerUserId: 'u' };
const NY = 'America/New_York';
const at = (local: string) => new Date(`${local}-04:00`);

const item = (entry: any) => ({ key: entry.item.id, entry, addedAt: new Date(), rev: 0 });

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
        expect(deterministicSignals([changed, waiting, answered], now).notes).toEqual([
            'Calendar event changed, starts within a day: calendar:1',
        ]);
        const notes = deterministicSignals(
            [changed, waiting, answered],
            at('2026-10-28T14:05:00'),
        ).notes;
        expect(notes).toEqual([
            'Calendar event changed, starts within a day: calendar:1',
            'Unanswered for over 3 h: imessage:1',
        ]);
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
            closeMatcher(['emma']),
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
        const jen = message('imessage:1', 'Jen', 'Done at 2:30 today');
        expect(relayOnly([jen], undefined, now, nobodyClose)).toBe(true);
        // The user's own messages don't count.
        const mine = item({
            ...jen.entry,
            item: { ...jen.entry.item, id: 'imessage:2', sender: 'Me', fromMe: true },
        });
        expect(relayOnly([jen, mine], undefined, now, nobodyClose)).toBe(true);
        // Two messages, a calendar item, something urgent or folded: the triage looks.
        const mail = message('mail:1', 'School', 'Party moved', 'mail');
        expect(relayOnly([jen, mail], undefined, now, nobodyClose)).toBe(false);
        const event = item({
            kind: 'changed',
            item: { id: 'calendar:1', source: 'calendar', when: '', snippet: 'Game', score: 0 },
        });
        expect(relayOnly([event], undefined, now, nobodyClose)).toBe(false);
        expect(relayOnly([{ ...jen, urgent: true }], undefined, now, nobodyClose)).toBe(false);
        expect(
            relayOnly([jen], { count: 1, sources: { mail: 1 }, oldestAt: now }, now, nobodyClose),
        ).toBe(false);
        // Unanswered past its delay: no longer held.
        expect(relayOnly([jen], undefined, at('2026-10-28T17:00:00'), nobodyClose)).toBe(false);
    });

    it('finds close people in About me, in either direction, by name or first name', () => {
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
        expect(isClose('Sara Khan')).toBe(true);
        expect(isClose('Emma')).toBe(true);
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
