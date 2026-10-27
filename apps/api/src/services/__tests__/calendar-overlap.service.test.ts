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

    const dental = event('Dental', '2026-10-28T13:00:00-04:00', '2026-10-28T14:00:00-04:00');
    const pizza = event('Pizza party', '2026-10-28T13:30:00-04:00', '2026-10-28T16:00:00-04:00');

    it('flags a new overlap once, again when it moves, and reports clearing it once', async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        const first = await overlapNewsFor('chat', user, 'n1', [dental.id], NY);
        expect(first.flagged).toHaveLength(1);
        expect(first.flagged[0]!.summary).toBe(
            'Dental (Wed 1:00 PM–2:00 PM) overlaps Pizza party (Wed 1:30 PM–4:00 PM) by 30 min',
        );
        expect(first.cleared).toEqual([]);

        // The same overlap again (another upload, or the other event's notes changed).
        expect(
            (await overlapNewsFor('chat', user, 'n1', [dental.id, pizza.id], NY)).flagged,
        ).toEqual([]);
        // Another chat hasn't been told.
        expect((await overlapNewsFor('other', user, 'n1', [pizza.id], NY)).flagged).toHaveLength(1);

        // Dental moves but still overlaps: flagged again with the new times.
        const moved = event('Dental', '2026-10-28T14:00:00-04:00', '2026-10-28T15:00:00-04:00');
        await upsertDeviceItems(user, 'mac', [moved]);
        const again = await overlapNewsFor('chat', user, 'n1', [dental.id], NY);
        expect(again.flagged[0]!.summary).toContain('Dental (Wed 2:00 PM–3:00 PM)');

        // Dental moves to the morning: the overlap clears, said once.
        await upsertDeviceItems(user, 'mac', [
            event('Dental', '2026-10-28T09:00:00-04:00', '2026-10-28T10:00:00-04:00'),
        ]);
        const cleared = await overlapNewsFor('chat', user, 'n1', [dental.id], NY);
        expect(cleared.flagged).toEqual([]);
        expect(cleared.cleared).toHaveLength(1);
        expect(cleared.cleared[0]!.summary).toBe('Dental and Pizza party no longer overlap');
        expect((await overlapNewsFor('chat', user, 'n1', [dental.id], NY)).cleared).toEqual([]);
    });

    it('lets a pass that failed flag the overlap again', async () => {
        await upsertDeviceItems(user, 'mac', [dental, pizza]);
        const news = await overlapNewsFor('chat', user, 'n1', [dental.id], NY);
        expect(news.flagged).toHaveLength(1);
        await news.release();
        expect((await overlapNewsFor('chat', user, 'n1', [dental.id], NY)).flagged).toHaveLength(1);
    });

    it("only uses events the notebook's calendar page shares", async () => {
        const work = event(
            'Board meeting',
            '2026-10-28T13:00:00-04:00',
            '2026-10-28T15:00:00-04:00',
            {
                calendar: 'Work',
            },
        );
        await upsertDeviceItems(user, 'mac', [pizza, work]);
        expect((await overlapNewsFor('chat', user, 'n1', [work.id, pizza.id], NY)).flagged).toEqual(
            [],
        );
        // A shared notebook's page with nothing shared yields no slices at all.
        vi.mocked(dataPageSlicesFor).mockResolvedValue([]);
        await upsertDeviceItems(user, 'mac', [dental]);
        expect((await overlapNewsFor('chat', user, 'n1', [dental.id], NY)).flagged).toEqual([]);
        expect(await briefOverlapsFor('chat', user, 'n1', NY)).toEqual([]);
    });

    it("lists today's and tomorrow's overlaps in the user's time zone", async () => {
        const now = new Date('2026-10-27T08:00:00-04:00');
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
        const notes = await briefOverlapsFor('chat', user, 'n1', NY, now);
        expect(notes.map((n) => n.events.map((e) => e.title))).toEqual([
            ['Late show', 'Red-eye'],
            ['Dinner', 'Call'],
        ]);
        expect(notes[0]!.summary).toBe(
            'Late show (Tue 11:30 PM–Wed 12:30 AM) overlaps Red-eye (Wed 12:00 AM–2:00 AM) by 30 min',
        );
        // Listed in the brief counts as flagged: a later upload doesn't repeat it.
        const news = await overlapNewsFor('chat', user, 'n1', ['calendar:Dinner'], NY, now);
        expect(news.flagged).toEqual([]);
    });

    it('answers find_overlaps with travel estimates and whose calendar it is', async () => {
        const a = event('School pickup', '2026-10-28T15:00:00-04:00', '2026-10-28T15:30:00-04:00', {
            location: 'School',
        });
        const b = event('Practice', '2026-10-28T15:45:00-04:00', '2026-10-28T17:00:00-04:00', {
            location: 'Field',
        });
        await upsertDeviceItems('someone-else', 'mac', [a, b]);
        await saveTravelEstimates('someone-else', 'phone', [
            { eventId: b.id, minutes: 20, computedAt: '2026-10-28T12:00:00Z' },
        ]);
        const notes = await findOverlapsForBot(
            {
                userId: user,
                timeZone: NY,
                pages: [{ ...familyOnly, ownerId: 'someone-else', ownerName: 'Sam' }],
            },
            { from: '2026-10-28', to: '2026-10-28' },
        );
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ kind: 'tight', sharedBy: 'Sam' });
        expect(notes[0]!.summary).toContain('about 20 min to get there');
    });
});
