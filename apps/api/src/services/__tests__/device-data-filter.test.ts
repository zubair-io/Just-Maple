import { describe, expect, it } from 'vitest';
import {
    describeDeviceFilter,
    deviceFilterIsEmpty,
    deviceItemMatchesFilter,
    type MacDataItem,
} from '@maple/shared';

const visit = (iso: string, extra: Record<string, unknown> = {}): MacDataItem => ({
    id: `location:${iso}`,
    source: 'location',
    revision: '',
    occurredAt: Date.parse(iso) / 1000,
    participants: [],
    body: '',
    extra,
});
const utc = { timeZone: 'UTC' };

describe('device data page filters', () => {
    it('lets everything through without a filter, and nothing through an empty one', () => {
        const event: MacDataItem = { ...visit('2026-10-20T10:00:00Z'), source: 'calendar' };
        expect(deviceItemMatchesFilter(event, undefined, utc)).toBe(true);
        expect(deviceItemMatchesFilter(event, {}, utc)).toBe(false);
        expect(deviceFilterIsEmpty('calendar', {})).toBe(true);
        expect(deviceFilterIsEmpty('calendar', { calendars: ['Family'] })).toBe(false);
        expect(deviceFilterIsEmpty('health', { includeAll: true })).toBe(false);
    });

    it('reads Places windows in the time zone, including ones past midnight', () => {
        const night = { includeAll: true, timeWindows: [{ start: '22:00', end: '06:00' }] };
        expect(deviceItemMatchesFilter(visit('2026-10-20T23:30:00Z'), night, utc)).toBe(true);
        expect(deviceItemMatchesFilter(visit('2026-10-20T05:59:00Z'), night, utc)).toBe(true);
        expect(deviceItemMatchesFilter(visit('2026-10-20T12:00:00Z'), night, utc)).toBe(false);
        // 03:00 UTC is 23:00 the evening before in New York.
        const ny = { timeZone: 'America/New_York' };
        const evening = { includeAll: true, timeWindows: [{ start: '18:00', end: '23:30' }] };
        expect(deviceItemMatchesFilter(visit('2026-10-21T03:00:00Z'), evening, ny)).toBe(true);
    });

    it('leaves out named places by id, by name or by distance', () => {
        const filter = { includeAll: true, excludePlaceIds: ['p1'] };
        const places = [{ id: 'p1', name: 'Work', lat: 40.7, lon: -74, radius: 150 }];
        const at = (extra: Record<string, unknown>) =>
            deviceItemMatchesFilter(visit('2026-10-20T10:00:00Z', extra), filter, {
                ...utc,
                places,
            });
        expect(at({ placeId: 'p1' })).toBe(false);
        expect(at({ place: 'work' })).toBe(false);
        expect(at({ lat: 40.7005, lon: -74.0005 })).toBe(false); // about 70 m away
        expect(at({ lat: 40.71, lon: -74 })).toBe(true); // about 1.1 km away
    });

    it('describes what a page shares', () => {
        expect(describeDeviceFilter('calendar', { calendars: ['Family'] })).toBe(
            'Only the Family calendar',
        );
        expect(describeDeviceFilter('imessage', { chats: ['A', 'B'] })).toBe(
            'Only the A and B chats',
        );
        expect(describeDeviceFilter('mail', { mailboxes: ['Kids'] })).toBe('Only mail in Kids');
        expect(describeDeviceFilter('health', {})).toBe('Nothing yet');
        expect(describeDeviceFilter('contacts', undefined)).toBe('Everything');
    });
});
