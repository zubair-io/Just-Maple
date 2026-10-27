import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacDataItem } from '@maple/shared';
import { mongoAvailable } from '../../__tests__/setup';

vi.mock('../device-data-access.service', () => ({ dataPageSlicesFor: vi.fn() }));

import {
    briefOverlapsFor,
    findCalendarOverlaps,
    findOverlapsForBot,
    overlapNewsFor,
} from '../calendar-overlap.service';
import { dataPageSlicesFor, type DataPageSlice } from '../device-data-access.service';
import { upsertDeviceItems } from '../../repositories/device-item.repo';
import { saveTravelEstimates } from '../../repositories/travel-estimate.repo';

const NY = 'America/New_York';
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function event(
    id: string,
    start: string,
    end: string,
    extra: Partial<MacDataItem> = {},
): MacDataItem {
    return {
        id: `calendar:${id}`,
        source: 'calendar',
        revision: `${start}-${end}`,
        occurredAt: at(start),
        endAt: at(end),
        title: id,
        participants: [],
        body: '',
        calendar: 'Family',
        ...extra,
    };
}

describe('findCalendarOverlaps', () => {
    it('finds events that share time, with how long', () => {
        const dental = event('Dental', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00');
        const pizza = event('Pizza', '2026-10-28T13:30:00-04:00', '2026-10-28T15:00:00-04:00');
        const later = event('Later', '2026-10-28T16:00:00-04:00', '2026-10-28T17:00:00-04:00');
        const overlaps = findCalendarOverlaps([pizza, later, dental]);
        expect(overlaps).toHaveLength(1);
        expect(overlaps[0]).toMatchObject({ kind: 'overlap', overlapMinutes: 30 });
        expect(overlaps[0]!.first.id).toBe('calendar:Dental');
    });

    it('ignores all-day events and touching events at the same place', () => {
        const allDay = event('Holiday', '2026-10-28T00:00:00-04:00', '2026-10-29T00:00:00-04:00', {
            allDay: true,
        });
        const a = event('A', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00', {
            location: 'School',
        });
        const b = event('B', '2026-10-28T14:00:00-04:00', '2026-10-28T15:00:00-04:00', {
            location: 'school',
        });
        expect(findCalendarOverlaps([allDay, a, b])).toEqual([]);
    });

    it('flags back-to-back events at different places as tight (15 min by default)', () => {
        const a = event('A', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00', {
            location: 'Dentist, 1 Main St',
        });
        const b = event('B', '2026-10-28T14:10:00-04:00', '2026-10-28T15:00:00-04:00', {
            location: 'Park',
        });
        const c = event('C', '2026-10-28T15:20:00-04:00', '2026-10-28T16:00:00-04:00', {
            location: 'Gym',
        });
        const overlaps = findCalendarOverlaps([a, b, c]);
        expect(overlaps).toHaveLength(1);
        expect(overlaps[0]).toMatchObject({ kind: 'tight', gapMinutes: 10, travelMinutes: 15 });
    });

    it('uses the iPhone travel estimate when there is one', () => {
        const a = event('A', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00', {
            location: 'Office',
        });
        const b = event('B', '2026-10-28T14:20:00-04:00', '2026-10-28T15:00:00-04:00', {
            location: 'Airport',
        });
        const estimates = new Map([
            [b.id, { eventId: b.id, minutes: 35, computedAt: '2026-10-28T12:00:00Z' }],
        ]);
        expect(findCalendarOverlaps([a, b])).toEqual([]);
        expect(findCalendarOverlaps([a, b], estimates)[0]).toMatchObject({
            kind: 'tight',
            travelMinutes: 35,
        });
        // A short drive makes a 10-minute gap fine.
        const near = new Map([[b.id, { ...estimates.get(b.id)!, minutes: 5 }]]);
        const b2 = { ...b, occurredAt: at('2026-10-28T14:10:00-04:00') };
        expect(findCalendarOverlaps([a, b2], near)).toEqual([]);
    });

    it('checks travel only from the previous event with a place, with estimates capped', () => {
        const a = event('A', '2026-10-28T09:00:00-04:00', '2026-10-28T10:00:00-04:00', {
            location: 'Office',
        });
        const b = event('B', '2026-10-28T10:05:00-04:00', '2026-10-28T10:30:00-04:00', {
            location: 'Gym',
        });
        const noPlace = event('Call', '2026-10-28T10:30:00-04:00', '2026-10-28T10:35:00-04:00');
        const c = event('C', '2026-10-28T10:40:00-04:00', '2026-10-28T11:00:00-04:00', {
            location: 'Park',
        });
        const estimates = new Map([
            [c.id, { eventId: c.id, minutes: 60, computedAt: '2026-10-28T12:00:00Z' }],
        ]);
        // From Gym to Park, not Office to Park.
        expect(
            findCalendarOverlaps([a, b, noPlace, c], estimates).map(
                (o) => `${o.first.title}-${o.second.title}`,
            ),
        ).toEqual(['A-B', 'B-C']);
        // A ten-hour drive is the phone being far away, not the trip between events.
        const far = new Map([[c.id, { ...estimates.get(c.id)!, minutes: 600 }]]);
        const later = { ...c, occurredAt: at('2026-10-28T13:00:00-04:00') };
        expect(findCalendarOverlaps([b, later], far)).toEqual([]);
        expect(findCalendarOverlaps([b, c], far)[0]).toMatchObject({ travelMinutes: 120 });
    });

    it('needs no travel to or from a video call, and skips one meeting on two calendars', () => {
        const a = event('Standup', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00', {
            location: 'https://zoom.us/j/123',
        });
        const b = event('Lunch', '2026-10-28T14:05:00-04:00', '2026-10-28T15:00:00-04:00', {
            location: 'Cafe',
        });
        const copy = { ...a, id: 'calendar:Standup-copy', calendar: 'Work' };
        expect(findCalendarOverlaps([a, b, copy])).toEqual([]);
    });
});

// MARK: - With the database

const user = 'overlap-user';
const familyOnly: DataPageSlice = {
    pageId: 'cal-page',
    source: 'calendar',
    ownerId: user,
    ownerName: 'Pat',
    title: 'Calendar',
    match: (item) => item.calendar === 'Family',
};

describe.runIf(mongoAvailable)('overlap flags and briefs', () => {
    beforeEach(() => {
        vi.mocked(dataPageSlicesFor).mockResolvedValue([familyOnly]);
    });

    const NOW = new Date('2026-10-27T08:00:00-04:00');
    const news = (ids: string[], scope = 'chat') => overlapNewsFor(scope, user, 'n1', ids, NY, NOW);
    const dental = event('Dental', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00');
    const pizza = event('Pizza party', '2026-10-28T13:30:00-04:00', '2026-10-28T16:00:00-04:00');

    it('flags a new overlap once, again when it moves, and reports clearing it once', async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        const first = await news([dental.id]);
        expect(first.flagged).toHaveLength(1);
        expect(first.flagged[0]!.summary).toBe(
            'Dental (Wed 1:00 PM–2:00 PM) overlaps Pizza party (Wed 1:30 PM–4:00 PM) by 30 min',
        );
        expect(first.cleared).toEqual([]);

        // The same overlap again (another upload, or the other event's notes changed).
        expect((await news([dental.id, pizza.id])).flagged).toEqual([]);
        // Another chat hasn't been told.
        expect((await news([pizza.id], 'other')).flagged).toHaveLength(1);

        // Dental moves but still overlaps: flagged again with the new times.
        await upsertDeviceItems(user, 'mac', [
            event('Dental', '2026-10-28T14:00:00-04:00', '2026-10-28T15:00:00-04:00'),
        ]);
        expect((await news([dental.id])).flagged[0]!.summary).toContain(
            'Dental (Wed 2:00 PM–3:00 PM)',
        );

        // Dental moves to the morning: the overlap clears.
        await upsertDeviceItems(user, 'mac', [
            event('Dental', '2026-10-28T09:00:00-04:00', '2026-10-28T10:00:00-04:00'),
        ]);
        const cleared = await news([dental.id]);
        expect(cleared.flagged).toEqual([]);
        expect(cleared.cleared.map((n) => n.summary)).toEqual([
            'Dental and Pizza party no longer overlap',
        ]);
        // Not posted yet: the next pass still has it. Once posted, it's said once.
        expect((await news([dental.id])).cleared).toHaveLength(1);
        await cleared.commit();
        expect((await news([dental.id])).cleared).toEqual([]);
    });

    it('lets a pass that posted nothing flag the overlap again', async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        const first = await news([dental.id]);
        expect(first.flagged).toHaveLength(1);
        await first.release();
        expect((await news([dental.id])).flagged).toHaveLength(1);
    });

    it("only uses events the notebook's calendar page shares", async () => {
        const work = event('Board', '2026-10-28T13:00:00-04:00', '2026-10-28T15:00:00-04:00', {
            calendar: 'Work',
        });
        await upsertDeviceItems(user, 'mac', [pizza, work]);
        expect((await news([work.id, pizza.id])).flagged).toEqual([]);
        // A shared notebook's page with nothing shared yields no slices at all.
        vi.mocked(dataPageSlicesFor).mockResolvedValue([]);
        await upsertDeviceItems(user, 'mac', [dental]);
        expect((await news([dental.id])).flagged).toEqual([]);
        expect((await briefOverlapsFor('chat', user, 'n1', NY, NOW)).notes).toEqual([]);
    });

    it("doesn't call an overlap cleared when an event moved to a calendar the page doesn't share", async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        expect((await news([dental.id])).flagged).toHaveLength(1);
        await upsertDeviceItems(user, 'mac', [
            { ...dental, calendar: 'Work', occurredAt: at('2026-10-28T09:00:00-04:00') },
        ]);
        const moved = await news([dental.id]);
        expect(moved).toMatchObject({ flagged: [], cleared: [] });
    });

    it('says an overlap cleared when an event moves weeks away', async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        expect((await news([dental.id])).flagged).toHaveLength(1);
        await upsertDeviceItems(user, 'mac', [
            event('Dental', '2026-11-18T13:00:00-05:00', '2026-11-18T14:00:00-05:00'),
        ]);
        expect((await news([dental.id])).cleared).toHaveLength(1);
    });

    it('keeps a flag when the cap cut its events off, and filters before the cap', async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        expect((await news([dental.id])).flagged).toHaveLength(1);
        // 600 unshared events and all-day ones don't count toward the cap...
        const unshared = Array.from({ length: 600 }, (_, n) => ({
            ...event(`w${n}`, '2026-10-28T11:00:00-04:00', '2026-10-28T11:01:00-04:00'),
            calendar: n % 2 ? 'Work' : 'Family',
            allDay: n % 2 === 0,
        }));
        await upsertDeviceItems(user, 'mac', unshared);
        const lunch = event('Lunch', '2026-10-28T12:00:00-04:00', '2026-10-28T13:30:00-04:00');
        await upsertDeviceItems(user, 'mac', [lunch]);
        expect((await news([lunch.id])).flagged.map((n) => n.events[1]!.title)).toEqual(['Dental']);
        // ...but 500 shared ones earlier in the window push Dental and Pizza out of it:
        // that's no reason to say their overlap cleared.
        const filler = Array.from({ length: 500 }, (_, n) =>
            event(
                `f${n}`,
                new Date(at('2026-10-27T00:00:00-04:00') * 1000 + n * 120_000).toISOString(),
                new Date(
                    at('2026-10-27T00:00:00-04:00') * 1000 + n * 120_000 + 60_000,
                ).toISOString(),
            ),
        );
        await upsertDeviceItems(user, 'mac', filler);
        await upsertDeviceItems(user, 'mac', [
            event('Dental', '2026-10-28T13:45:00-04:00', '2026-10-28T14:00:00-04:00'),
        ]);
        expect((await news([dental.id])).cleared).toEqual([]);
    });

    it('only checks changes from yesterday through the coming weeks', async () => {
        const far = event('Far', '2027-01-10T13:00:00-05:00', '2027-01-10T14:00:00-05:00');
        const farToo = event('Far too', '2027-01-10T13:30:00-05:00', '2027-01-10T15:00:00-05:00');
        await upsertDeviceItems(user, 'mac', [far, farToo, dental, pizza]);
        const result = await news([far.id, dental.id]);
        expect(result.flagged.map((n) => n.events[0]!.title)).toEqual(['Dental']);
    });

    it('finds a long multi-day timed event that started days before', async () => {
        const trip = event('Conference', '2026-10-20T09:00:00-04:00', '2026-10-30T17:00:00-04:00');
        await upsertDeviceItems(user, 'mac', [trip, dental]);
        expect((await news([dental.id])).flagged.map((n) => n.events[0]!.title)).toEqual([
            'Conference',
        ]);
    });

    it("lists today's and tomorrow's overlaps in the user's time zone", async () => {
        await upsertDeviceItems(user, 'mac', [
            // Yesterday: left out.
            event('Y1', '2026-10-26T10:00:00-04:00', '2026-10-26T11:00:00-04:00'),
            event('Y2', '2026-10-26T10:30:00-04:00', '2026-10-26T11:30:00-04:00'),
            // Across tonight's midnight.
            event('Late show', '2026-10-27T23:30:00-04:00', '2026-10-28T00:30:00-04:00'),
            event('Red-eye', '2026-10-28T00:00:00-04:00', '2026-10-28T02:00:00-04:00'),
            // Tomorrow evening in New York, already the next day in UTC.
            event('Dinner', '2026-10-28T21:00:00-04:00', '2026-10-28T22:30:00-04:00'),
            event('Call', '2026-10-28T22:00:00-04:00', '2026-10-28T23:00:00-04:00'),
            // The day after tomorrow: left out.
            event('D1', '2026-10-29T00:30:00-04:00', '2026-10-29T01:30:00-04:00'),
            event('D2', '2026-10-29T01:00:00-04:00', '2026-10-29T02:00:00-04:00'),
        ]);
        const { notes } = await briefOverlapsFor('chat', user, 'n1', NY, NOW);
        expect(notes.map((n) => n.events.map((e) => e.title))).toEqual([
            ['Late show', 'Red-eye'],
            ['Dinner', 'Call'],
        ]);
        expect(notes[0]!.summary).toBe(
            'Late show (Tue 11:30 PM–Wed 12:30 AM) overlaps Red-eye (Wed 12:00 AM–2:00 AM) by 30 min',
        );
        // Listed in the brief counts as flagged: a later upload doesn't repeat it.
        expect((await news(['calendar:Dinner'])).flagged).toEqual([]);
    });

    it("releases the brief's flags when it didn't go out", async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        const brief = await briefOverlapsFor('chat', user, 'n1', NY, NOW);
        expect(brief.notes).toHaveLength(1);
        await brief.release();
        expect((await news([dental.id])).flagged).toHaveLength(1);
    });

    it("answers find_overlaps without another member's travel estimates", async () => {
        const a = event('School pickup', '2026-10-28T15:00:00-04:00', '2026-10-28T15:30:00-04:00', {
            location: 'School',
        });
        const b = event('Practice', '2026-10-28T15:40:00-04:00', '2026-10-28T17:00:00-04:00', {
            location: 'Field',
        });
        await upsertDeviceItems('someone-else', 'mac', [a, b]);
        await saveTravelEstimates('someone-else', 'phone', [
            { eventId: b.id, minutes: 20, computedAt: '2026-10-28T12:00:00Z' },
        ]);
        const sams = { ...familyOnly, ownerId: 'someone-else', ownerName: 'Sam' };
        const range = { from: '2026-10-28', to: '2026-10-28' };
        const notes = await findOverlapsForBot(
            { userId: user, timeZone: NY, pages: [sams] },
            range,
        );
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ kind: 'tight', sharedBy: 'Sam' });
        // Their phone's estimate would hint at where they are: the default is used.
        expect(notes[0]!.summary).toContain('about 15 min to get there');
        // Their own bot uses it.
        const own = await findOverlapsForBot(
            { userId: 'someone-else', timeZone: NY, pages: [sams] },
            range,
        );
        expect(own[0]!.summary).toContain('about 20 min to get there');
    });
});
