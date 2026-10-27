import type {
    DeviceDataChoice,
    DeviceDataFilter,
    DeviceDataTimeWindow,
} from '../schemas/device-data-filter';
import type { MacDataItem, MacDataSource } from '../schemas/mac-data';
import type { Notebook } from '../schemas/notebook';

/** The notebook has members besides its owner, or is public. The owner is listed too. */
export function isNotebookShared(notebook: Pick<Notebook, 'sharing'> | null | undefined): boolean {
    return (
        !!notebook?.sharing?.isPublic ||
        !!notebook?.sharing?.sharedWith?.some((entry) => entry.accessLevel !== 'owner')
    );
}

/** The person is listed in the notebook's members (owner included). */
export function isNotebookMember(
    notebook: Pick<Notebook, 'sharing'> | null | undefined,
    userId: string,
): boolean {
    return !!notebook?.sharing?.sharedWith?.some((entry) => entry.userId === userId);
}

/** A calendar's or chat's id as the device uploaded it (absent on older items). */
export function deviceItemChoiceId(item: MacDataItem): string | undefined {
    const key =
        item.source === 'calendar' ? 'calendarId' : item.source === 'imessage' ? 'chatId' : '';
    const value = key ? item.extra?.[key] : undefined;
    return typeof value === 'string' && value ? value : undefined;
}

/**
 * One key per conversation, from a chat's GUID ("iMessage;-;+15185550100"). The service
 * prefix is dropped, so texts with one person over iMessage, SMS and RCS are one thread,
 * and a one-to-one handle compares like contacts do: phones by their last 10 digits,
 * emails lowercased. Group chats keep their own id.
 */
export function imessageThreadKey(chatId: string): string {
    const match = /^[^;]*;([-+]);(.+)$/.exec(chatId);
    if (!match) return chatId;
    return match[1] === '+' ? `group:${match[2]}` : `dm:${imessageHandleKey(match[2]!)}`;
}

/** "+1 (518) 555-0100", "5185550100" and "tel:+15185550100" are all "5185550100". */
export function imessageHandleKey(handle: string): string {
    const value = handle
        .trim()
        .toLowerCase()
        .replace(/^(mailto|tel):/, '');
    if (value.includes('@')) return value;
    const digits = value.replace(/\D/g, '');
    // Short codes and stray numbers keep their own form.
    return digits.length >= 7 ? digits.slice(-10) : value;
}

/** The thread an iMessage item belongs to: by chat id, else by its thread name (older items). */
export function deviceItemThreadKey(item: MacDataItem): string | undefined {
    const id = deviceItemChoiceId(item);
    if (id) return imessageThreadKey(id);
    return item.thread ? `name:${item.thread}` : undefined;
}

/** A named place to leave out of a Places page: matched by id, name or distance. */
export interface FilterPlace {
    id: string;
    name: string;
    lat?: number;
    lon?: number;
    /** Meters. */
    radius?: number;
}

export interface DeviceFilterContext {
    /** The creator's time zone, for Places time windows. */
    timeZone: string;
    /** The creator's named places, for Places exclusions. */
    places?: FilterPlace[];
}

/** Whether an item from a page's source passes the page's filter. No filter lets everything through. */
export function deviceItemMatchesFilter(
    item: MacDataItem,
    filter: DeviceDataFilter | undefined,
    context: DeviceFilterContext,
): boolean {
    if (!filter) return true;
    const all = filter.includeAll === true;
    switch (item.source) {
        case 'calendar':
            return all || inChoices(filter.calendars, item, item.calendar);
        case 'mail':
            return all || inList(filter.mailboxes, item.mailbox);
        case 'imessage':
            return all || inChoices(filter.chats, item, item.thread);
        case 'location':
            return (
                all &&
                inWindows(filter.timeWindows, item.occurredAt, context.timeZone) &&
                !atExcludedPlace(item, filter.excludePlaceIds, context.places ?? [])
            );
        default:
            return all;
    }
}

/** True when the filter can't let anything through, so there's nothing to look up. */
export function deviceFilterIsEmpty(
    source: MacDataSource,
    filter: DeviceDataFilter | undefined,
): boolean {
    if (!filter || filter.includeAll) return false;
    if (source === 'calendar') return !filter.calendars?.length;
    if (source === 'mail') return !filter.mailboxes?.length;
    if (source === 'imessage') return !filter.chats?.length;
    return true;
}

/** "Only the Family calendar", "Visits 9:00–17:00, not at Work", "Nothing yet". */
export function describeDeviceFilter(
    source: MacDataSource,
    filter: DeviceDataFilter | undefined,
    placeNames: Record<string, string> = {},
): string {
    if (!filter) return 'Everything';
    if (deviceFilterIsEmpty(source, filter)) return 'Nothing yet';
    const list = (names: string[], one: string, many: string) =>
        names.length === 1 ? `${names[0]} ${one}` : `${joinNames(names)} ${many}`;
    switch (source) {
        case 'calendar':
            return filter.includeAll
                ? 'All calendars'
                : `Only the ${list(choiceNames(filter.calendars!), 'calendar', 'calendars')}`;
        case 'mail':
            return filter.includeAll ? 'All mail' : `Only mail in ${joinNames(filter.mailboxes!)}`;
        case 'imessage':
            return filter.includeAll
                ? 'All chats'
                : `Only the ${list(choiceNames(filter.chats!), 'chat', 'chats')}`;
        case 'location': {
            const parts: string[] = [];
            const windows = filter.timeWindows ?? [];
            parts.push(
                windows.length
                    ? `Visits starting ${joinNames(windows.map((w) => `${w.start}–${w.end}`))}`
                    : 'All visits',
            );
            const excluded = (filter.excludePlaceIds ?? []).map(
                (id) => placeNames[id] ?? 'a place',
            );
            if (excluded.length) parts.push(`not at ${joinNames(excluded)}`);
            return parts.join(', ');
        }
        default:
            return 'Everything';
    }
}

function joinNames(names: string[]): string {
    return names.length <= 1
        ? (names[0] ?? '')
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function choiceNames(choices: DeviceDataChoice[]): string[] {
    return [...new Set(choices.map((choice) => choice.name))];
}

/**
 * By id when both the choice and the item have one; otherwise by name (items uploaded
 * before devices sent ids, or a choice saved without one).
 */
function inChoices(
    choices: DeviceDataChoice[] | undefined,
    item: MacDataItem,
    name: string | undefined,
): boolean {
    const id = deviceItemChoiceId(item);
    // A chat is the conversation, whichever service a message went over.
    const same = (a: string, b: string) =>
        item.source === 'imessage' ? imessageThreadKey(a) === imessageThreadKey(b) : a === b;
    return !!choices?.some((choice) =>
        choice.id && id ? same(choice.id, id) : !!name && choice.name === name,
    );
}

function inList(list: string[] | undefined, value: string | undefined): boolean {
    return !!value && !!list?.includes(value);
}

/** Minutes after midnight in the time zone. */
export function minutesInZone(epochSeconds: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(epochSeconds * 1000));
    const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return value('hour') * 60 + value('minute');
}

function toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
}

function inWindows(
    windows: DeviceDataTimeWindow[] | undefined,
    epochSeconds: number,
    timeZone: string,
): boolean {
    if (!windows?.length) return true;
    const minute = minutesInZone(epochSeconds, timeZone);
    return windows.some((window) => {
        const start = toMinutes(window.start);
        const end = toMinutes(window.end);
        // A window like 22:00–06:00 runs past midnight.
        return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
    });
}

function atExcludedPlace(
    item: MacDataItem,
    excludeIds: string[] | undefined,
    places: FilterPlace[],
): boolean {
    if (!excludeIds?.length) return false;
    const extra = item.extra ?? {};
    const placeId = typeof extra['placeId'] === 'string' ? extra['placeId'] : undefined;
    const placeName = typeof extra['place'] === 'string' ? extra['place'] : undefined;
    const lat = typeof extra['lat'] === 'number' ? extra['lat'] : undefined;
    const lon = typeof extra['lon'] === 'number' ? extra['lon'] : undefined;
    if (placeId && excludeIds.includes(placeId)) return true;
    return places
        .filter((place) => excludeIds.includes(place.id))
        .some((place) => {
            if (placeName && placeName.toLowerCase() === place.name.toLowerCase()) return true;
            if (
                lat === undefined ||
                lon === undefined ||
                place.lat === undefined ||
                place.lon === undefined
            )
                return false;
            return distanceMeters(lat, lon, place.lat, place.lon) <= (place.radius ?? 150);
        });
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
