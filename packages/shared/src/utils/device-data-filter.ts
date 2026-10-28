import type {
    DeviceDataChoice,
    DeviceDataFilter,
    DeviceDataTimeWindow,
} from '../schemas/device-data-filter';
import type { MacDataItem, MacDataSource } from '../schemas/mac-data';
import { HOME_PRESENCE_DOMAINS } from '../schemas/home';
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
 * prefix is dropped, so texts with one person over iMessage, SMS and RCS are one thread.
 * Group chats keep their own id. A one-to-one handle goes through `imessageHandleKey`,
 * which merges two handles only when they are surely the same number or email.
 */
export function imessageThreadKey(chatId: string): string {
    const match = /^[^;]*;([-+]);(.+)$/.exec(chatId);
    if (!match) return chatId;
    return match[1] === '+' ? `group:${match[2]}` : `dm:${imessageHandleKey(match[2]!)}`;
}

/**
 * A handle in one form, failing closed: merging two people would share one person's
 * texts as another's.
 * - Emails: lowercased.
 * - Numbers with a country code: "+" and every digit, so "+33 6 12 34 56 78" and
 *   "+1 361-234-5678" stay apart.
 * - Numbers without one are North American only when they look it: "(518) 555-0100" and
 *   "1-518-555-0100" are "+15185550100" (area code and exchange start with 2–9).
 * - Anything else (short codes, local numbers abroad) matches only itself, digit for digit.
 */
export function imessageHandleKey(handle: string): string {
    const value = handle
        .trim()
        .toLowerCase()
        .replace(/^(mailto|tel):/, '');
    if (value.includes('@')) return value;
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7) return `raw:${value}`;
    if (value.startsWith('+')) return `+${digits}`;
    const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return `+1${national}`;
    return `raw:${digits}`;
}

/** A thread name that is just a phone number ("(518) 555-0100", "+15185550100"). */
function isPhoneName(name: string): boolean {
    return /^[+\d\s().-]+$/.test(name) && name.replace(/\D/g, '').length >= 7;
}

/** A chat's name for matching: a number by its handle key, so a reformatted name still matches. */
function chatNameKey(name: string): string {
    return isPhoneName(name) ? imessageHandleKey(name) : name;
}

/** The thread an iMessage item belongs to: by chat id, else by its thread name (older items). */
export function deviceItemThreadKey(item: MacDataItem): string | undefined {
    if (item.source !== 'imessage') return undefined;
    const id = deviceItemChoiceId(item);
    if (id) return imessageThreadKey(id);
    return item.thread ? `name:${chatNameKey(item.thread)}` : undefined;
}

/**
 * What makes two choices the same calendar or chat, for pickers: a chat by its thread
 * key, so a person's iMessage and SMS chats are one row.
 */
export function deviceChoiceKey(source: MacDataSource, choice: DeviceDataChoice): string {
    if (source !== 'imessage') return choice.id ?? `name:${choice.name}`;
    return choice.id ? imessageThreadKey(choice.id) : `name:${chatNameKey(choice.name)}`;
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
        case 'home':
            return homeItemMatches(item, filter);
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
    if (source === 'home') return !filter.homeEntities?.length && !filter.homeAreas?.length;
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
        case 'home': {
            const presence = filter.includePresence ? " and who's home" : '';
            if (filter.includeAll) return `All exposed devices${presence}`;
            const parts: string[] = [];
            if (filter.homeAreas?.length)
                parts.push(`Devices in ${joinNames(filter.homeAreas)}${presence}`);
            const count = filter.homeEntities?.length ?? 0;
            if (count) parts.push(count === 1 ? '1 chosen device' : `${count} chosen devices`);
            return parts.join(', and ');
        }
        default:
            return 'Everything';
    }
}

// MARK: - Home

/** The Home Assistant entity a Home item is about (`light.kitchen`). */
export function homeEntityId(item: MacDataItem): string | undefined {
    if (item.source !== 'home') return undefined;
    const value = item.extra?.['entityId'];
    return typeof value === 'string' && value ? value : undefined;
}

/** People and device trackers: where someone is. */
export function isHomePresenceEntity(entityId: string): boolean {
    const domain = entityId.split('.')[0] ?? '';
    return (HOME_PRESENCE_DOMAINS as readonly string[]).includes(domain);
}

/**
 * An entity picked by id always passes. Who's home passes with "everything" or an area
 * only when the creator turned it on. Otherwise: everything, or the entity's area.
 */
function homeItemMatches(item: MacDataItem, filter: DeviceDataFilter): boolean {
    const id = homeEntityId(item);
    if (!id) return false;
    if (filter.homeEntities?.includes(id)) return true;
    if (isHomePresenceEntity(id) && !filter.includePresence) return false;
    if (filter.includeAll) return true;
    const area = item.extra?.['area'];
    return typeof area === 'string' && !!filter.homeAreas?.includes(area);
}

/**
 * Bots never see who's home unless the page's filter picks it: a page without a filter
 * shows its creator everything, but not their bots.
 */
export function homeItemVisibleToBots(
    item: MacDataItem,
    filter: DeviceDataFilter | undefined,
): boolean {
    const id = homeEntityId(item);
    if (!id) return item.source !== 'home';
    if (!isHomePresenceEntity(id)) return true;
    return !!filter && (!!filter.includePresence || !!filter.homeEntities?.includes(id));
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
    // A chat is the conversation, whichever service a message went over; a chat saved by
    // name still matches after its number is written another way.
    const chat = item.source === 'imessage';
    const sameId = (a: string, b: string) =>
        chat ? imessageThreadKey(a) === imessageThreadKey(b) : a === b;
    const sameName = (a: string, b: string) => (chat ? chatNameKey(a) === chatNameKey(b) : a === b);
    return !!choices?.some((choice) =>
        choice.id && id ? sameId(choice.id, id) : !!name && sameName(choice.name, name),
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
