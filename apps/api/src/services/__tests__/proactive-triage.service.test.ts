import { describe, expect, it } from 'vitest';
import {
    clashMarks,
    compactItem,
    deterministicSignals,
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
        const notes = deterministicSignals([changed, waiting, answered], now).notes;
        expect(notes).toEqual([
            'Calendar event changed, starts within a day: calendar:1',
            'Someone is waiting on a reply: imessage:1',
        ]);
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
