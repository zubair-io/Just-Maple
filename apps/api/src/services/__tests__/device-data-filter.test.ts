import { describe, expect, it } from 'vitest';
import {
    describeDeviceFilter,
    deviceFilterIsEmpty,
    deviceItemMatchesFilter,
    deviceItemThreadKey,
    imessageHandleKey,
    imessageThreadKey,
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
        expect(deviceFilterIsEmpty('calendar', { calendars: [{ name: 'Family' }] })).toBe(false);
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
        expect(describeDeviceFilter('calendar', { calendars: [{ name: 'Family' }] })).toBe(
            'Only the Family calendar',
        );
        expect(describeDeviceFilter('imessage', { chats: [{ name: 'A' }, { name: 'B' }] })).toBe(
            'Only the A and B chats',
        );
        expect(describeDeviceFilter('mail', { mailboxes: ['Kids'] })).toBe('Only mail in Kids');
        expect(describeDeviceFilter('health', {})).toBe('Nothing yet');
        expect(describeDeviceFilter('contacts', undefined)).toBe('Everything');
    });

    it('treats one person over iMessage, SMS and RCS as one chat, but keeps groups apart', () => {
        expect(imessageThreadKey('iMessage;-;+15185550142')).toBe('dm:+15185550142');
        expect(imessageThreadKey('SMS;-;(518) 555-0142')).toBe('dm:+15185550142');
        expect(imessageThreadKey('RCS;-;+1 518-555-0142')).toBe('dm:+15185550142');
        expect(imessageThreadKey('SMS;-;1-518-555-0142')).toBe('dm:+15185550142');
        expect(imessageThreadKey('iMessage;-;Coach@Example.com')).toBe('dm:coach@example.com');
        expect(imessageThreadKey('iMessage;+;chat123')).toBe('group:chat123');
        expect(imessageThreadKey('SMS;+;chat456')).not.toBe(
            imessageThreadKey('iMessage;+;chat123'),
        );

        const message = (chatId: string, thread: string): MacDataItem => ({
            ...visit('2026-10-20T10:00:00Z'),
            source: 'imessage',
            thread,
            extra: { chatId },
        });
        // A page that shares the iMessage chat also shows replies that went over SMS.
        const filter = { chats: [{ id: 'iMessage;-;+15185550142', name: '+15185550142' }] };
        expect(deviceItemMatchesFilter(message('SMS;-;5185550142', 'x'), filter, utc)).toBe(true);
        expect(deviceItemMatchesFilter(message('SMS;-;5185550100', 'x'), filter, utc)).toBe(false);
        expect(
            deviceItemMatchesFilter(message('iMessage;+;chat1', '+15185550142'), filter, utc),
        ).toBe(false);
    });

    it('never merges different people whose numbers end the same way', () => {
        const key = (handle: string) => imessageHandleKey(handle);
        // Same last 10 digits, different countries.
        expect(key('+33 6 12 34 56 78')).not.toBe(key('+1 361-234-5678'));
        expect(key('+44 7911 123456')).not.toBe(key('+91 79111 23456'));
        // Without a country code, only a North American-shaped number is taken as +1.
        expect(key('3612345678')).toBe(key('+1 361-234-5678'));
        expect(key('0612345678')).toBe('raw:0612345678');
        expect(key('0612345678')).not.toBe(key('+33 6 12 34 56 78'));
        expect(key('07911 123456')).not.toBe(key('+44 7911 123456'));
        // A 10-digit number whose exchange starts with 0 or 1 isn't North American.
        expect(key('5181550142')).toBe('raw:5181550142');
        // Short codes match only themselves.
        expect(key('12345')).toBe('raw:12345');
        expect(key('12345')).not.toBe(key('+12345'));
        expect(key('262966')).not.toBe(key('62966'));

        const message = (chatId: string): MacDataItem => ({
            ...visit('2026-10-20T10:00:00Z'),
            source: 'imessage',
            extra: { chatId },
        });
        const french = { chats: [{ id: 'iMessage;-;+33612345678', name: 'Camille' }] };
        expect(deviceItemMatchesFilter(message('SMS;-;+13612345678'), french, utc)).toBe(false);
        expect(deviceItemMatchesFilter(message('SMS;-;+33 6 12 34 56 78'), french, utc)).toBe(true);
    });

    it('still matches chats saved by name after the number is written another way', () => {
        const message = (thread: string): MacDataItem => ({
            ...visit('2026-10-20T10:00:00Z'),
            source: 'imessage',
            thread,
        });
        const filter = { chats: [{ name: '(518) 555-0142' }, { name: 'Soccer parents' }] };
        expect(deviceItemMatchesFilter(message('+15185550142'), filter, utc)).toBe(true);
        expect(deviceItemMatchesFilter(message('Soccer parents'), filter, utc)).toBe(true);
        expect(deviceItemMatchesFilter(message('+15185550100'), filter, utc)).toBe(false);
        expect(deviceItemMatchesFilter(message('+33612345678'), filter, utc)).toBe(false);
    });

    it('gives only messages a thread key', () => {
        const base = { ...visit('2026-10-20T10:00:00Z'), thread: 'Family', extra: {} };
        expect(deviceItemThreadKey({ ...base, source: 'imessage' })).toBe('name:Family');
        expect(deviceItemThreadKey({ ...base, source: 'mail' })).toBeUndefined();
        expect(
            deviceItemThreadKey({ ...base, source: 'calendar', extra: { chatId: 'x;-;y' } }),
        ).toBeUndefined();
    });
});
