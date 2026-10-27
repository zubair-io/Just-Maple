import type { MacDataItem, TravelEstimate } from '@maple/shared';
import { findDeviceItems, findDeviceItemsByIds } from '../repositories/device-item.repo';
import { findTravelEstimates } from '../repositories/travel-estimate.repo';
import {
    claimOverlapFlag,
    findOverlapFlags,
    releaseOverlapFlag,
} from '../repositories/calendar-overlap.repo';
import { dataPageSlicesFor, type DataPageSlice } from './device-data-access.service';
import { formatInZone, toEpochSeconds } from '../utils/time-zone';

/**
 * Calendar overlaps, found in code so the bot never has to notice them by chance.
 *
 * 1. Two timed events (not all-day) of the same person overlap when one starts before the
 *    other ends. Back-to-back events at different places are a "tight" (soft) conflict
 *    when the gap after the previous event with a place is shorter than the drive: the
 *    iPhone's estimate for the later event when there is one (capped: it's measured from
 *    wherever the phone is now), otherwise 15 minutes. Only the reader's own estimates
 *    are used; they hint at where the phone is.
 * 2. Only events a notebook's calendar pages share count (see device-data-access.service).
 * 3. A chat's proactive bot hears about an overlap when calendar changes create it or
 *    clear it, and its daily brief lists today's and tomorrow's. Each pair is flagged once
 *    per chat until one of its events moves (calendar-overlap.repo). Claims are kept only
 *    when the bot actually posts, and "cleared" is said only when both events were looked
 *    at again and still shared.
 * 4. Bots can ask with the find_overlaps tool.
 */

const DEFAULT_TRAVEL_MINUTES = 15;
const DAY_SECONDS = 24 * 60 * 60;
const MAX_EVENTS = 500;
/** Estimates longer than this are from far away (the phone travels), not the trip between events. */
const MAX_TRAVEL_MINUTES = 120;
/** Around each changed event, the span checked for clashes. */
const WINDOW_PADDING_SECONDS = 2 * DAY_SECONDS;
/** Changes are checked from yesterday through the coming four weeks. */
const LOOKBACK_SECONDS = DAY_SECONDS;
const LOOKAHEAD_SECONDS = 28 * DAY_SECONDS;
/** Timed events longer than this (a month-long "trip" block) aren't looked for. */
const LONGEST_EVENT_SECONDS = 31 * DAY_SECONDS;

export interface CalendarOverlap {
    /** "overlap": the events share time. "tight": not enough time to get between them. */
    kind: 'overlap' | 'tight';
    /** The one that starts first. */
    first: MacDataItem;
    second: MacDataItem;
    /** For "overlap": how long they share. */
    overlapMinutes?: number;
    /** For "tight": the gap, and the drive it's shorter than. */
    gapMinutes?: number;
    travelMinutes?: number;
}

/** One overlap as a bot reads it: a plain sentence plus the events, times in the user's zone. */
export interface OverlapNote {
    kind: CalendarOverlap['kind'];
    summary: string;
    events: {
        id: string;
        title?: string;
        when: string;
        end?: string;
        location?: string;
        calendar?: string;
    }[];
    sharedBy?: string;
}

const endOf = (event: MacDataItem) => Math.max(event.endAt ?? event.occurredAt, event.occurredAt);

/** Overlapping and too-tight pairs among one person's events, earliest first. */
export function findCalendarOverlaps(
    events: MacDataItem[],
    estimates: Map<string, TravelEstimate> = new Map(),
): CalendarOverlap[] {
    const seen = new Set<string>();
    const timed = events
        .filter((e) => e.source === 'calendar' && !e.allDay && !seen.has(e.id) && !!seen.add(e.id))
        .sort((a, b) => a.occurredAt - b.occurredAt || endOf(a) - endOf(b));
    const overlaps: CalendarOverlap[] = [];
    for (let i = 0; i < timed.length; i++) {
        const first = timed[i]!;
        for (let j = i + 1; j < timed.length; j++) {
            const second = timed[j]!;
            // Sorted by start: nothing later can overlap `first` either.
            if (second.occurredAt >= endOf(first)) break;
            // The same meeting on two calendars (an invite copied to a shared one).
            if (sameEvent(first, second)) continue;
            const shared = Math.min(endOf(first), endOf(second)) - second.occurredAt;
            overlaps.push({ kind: 'overlap', first, second, overlapMinutes: shared / 60 });
        }
    }
    // Travel: each event at a place against the one the user comes from, the latest-ending
    // earlier event with a place (events without one, and video calls, are skipped).
    let previous: MacDataItem | null = null;
    for (const event of timed) {
        if (!placeOf(event)) continue;
        if (
            previous &&
            endOf(previous) <= event.occurredAt &&
            needsTravel(previous, event) &&
            !sameEvent(previous, event)
        ) {
            const gap = (event.occurredAt - endOf(previous)) / 60;
            const travel = travelMinutes(estimates.get(event.id));
            if (gap < travel)
                overlaps.push({
                    kind: 'tight',
                    first: previous,
                    second: event,
                    gapMinutes: gap,
                    travelMinutes: travel,
                });
        }
        if (!previous || endOf(event) >= endOf(previous)) previous = event;
    }
    return overlaps.sort(
        (a, b) =>
            a.first.occurredAt - b.first.occurredAt || a.second.occurredAt - b.second.occurredAt,
    );
}

function travelMinutes(estimate: TravelEstimate | undefined): number {
    return Math.min(estimate?.minutes ?? DEFAULT_TRAVEL_MINUTES, MAX_TRAVEL_MINUTES);
}

/** Time between two events, negative when they overlap. */
function gapBetween(a: MacDataItem, b: MacDataItem): number {
    return Math.max(a.occurredAt, b.occurredAt) - Math.min(endOf(a), endOf(b));
}

function sameEvent(a: MacDataItem, b: MacDataItem): boolean {
    return (
        a.occurredAt === b.occurredAt &&
        endOf(a) === endOf(b) &&
        (a.title ?? '').trim().toLowerCase() === (b.title ?? '').trim().toLowerCase()
    );
}

/** Both events are at real places, and not the same one. */
function needsTravel(a: MacDataItem, b: MacDataItem): boolean {
    const here = placeOf(a);
    const there = placeOf(b);
    if (!here || !there) return false;
    return here !== there && !here.startsWith(`${there},`) && !there.startsWith(`${here},`);
}

function placeOf(event: MacDataItem): string | null {
    const place = event.location?.trim().toLowerCase();
    if (!place) return null;
    // Video calls happen wherever the user is.
    if (/^https?:\/\/|zoom\.us|meet\.google|teams\.microsoft|webex|facetime/.test(place))
        return null;
    return place;
}

/** Stable per pair of events, whatever their times. */
export function overlapPairKey(overlap: CalendarOverlap): string {
    return [overlap.first.id, overlap.second.id].sort().join('|');
}

/** Changes when either event moves or the conflict changes kind. */
export function overlapSignature(overlap: CalendarOverlap): string {
    const times = [overlap.first, overlap.second]
        .map((e) => `${e.id}@${e.occurredAt}-${endOf(e)}`)
        .sort();
    return `${overlap.kind}:${times.join('|')}`;
}

/** "Tue 1:00 PM", in the user's time zone. */
function clock(seconds: number, timeZone: string): string {
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
    };
    try {
        return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(seconds * 1000);
    } catch {
        return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
            seconds * 1000,
        );
    }
}

function span(event: MacDataItem, timeZone: string): string {
    const start = clock(event.occurredAt, timeZone);
    if (endOf(event) === event.occurredAt) return start;
    const end = clock(endOf(event), timeZone);
    // "Tue 1:00 PM–2:00 PM", the day only once when it doesn't change.
    const day = start.split(' ')[0]!;
    return `${start}–${end.startsWith(`${day} `) ? end.slice(day.length + 1) : end}`;
}

export function describeOverlap(
    overlap: CalendarOverlap,
    timeZone: string,
    sharedBy?: string,
): OverlapNote {
    const name = (e: MacDataItem) => e.title?.trim() || 'Untitled event';
    const a = `${name(overlap.first)} (${span(overlap.first, timeZone)})`;
    const b = `${name(overlap.second)} (${span(overlap.second, timeZone)})`;
    const summary =
        overlap.kind === 'overlap'
            ? `${a} overlaps ${b} by ${Math.round(overlap.overlapMinutes ?? 0)} min`
            : `${a} ends ${Math.round(overlap.gapMinutes ?? 0)} min before ${b}, at a different place (about ${Math.round(overlap.travelMinutes ?? 0)} min to get there)`;
    return {
        kind: overlap.kind,
        summary,
        events: [overlap.first, overlap.second].map((e) => ({
            id: e.id,
            ...(e.title ? { title: e.title } : {}),
            when: formatInZone(new Date(e.occurredAt * 1000), timeZone),
            ...(e.endAt ? { end: formatInZone(new Date(e.endAt * 1000), timeZone) } : {}),
            ...(e.location ? { location: e.location } : {}),
            ...(e.calendar ? { calendar: e.calendar } : {}),
        })),
        ...(sharedBy ? { sharedBy } : {}),
    };
}

/**
 * One person's timed events that the slices share and that touch [from, to). Filtered
 * before the cap; `complete` is false when the cap cut some off.
 */
async function sharedEventsIn(
    ownerId: string,
    slices: DataPageSlice[],
    from: number,
    to: number,
): Promise<{ events: MacDataItem[]; complete: boolean }> {
    const { items, total } = await findDeviceItems(ownerId, {
        sources: ['calendar'],
        // Started before the window but still going (bounded, so the query stays small).
        from: from - LONGEST_EVENT_SECONDS,
        to: to - 1,
        // Checked in code with `match`, so the database never sorts this `$or` (Cosmos).
        conditions: { $or: [{ endAt: { $gt: from } }, { occurredAt: { $gte: from } }] },
        order: 'asc',
        limit: MAX_EVENTS,
        match: (item) => !item.allDay && slices.some((slice) => slice.match(item)),
    });
    return { events: items, complete: items.length >= total };
}

/**
 * Overlaps among each person's shared events that touch [from, to): one list per
 * calendar owner, since one person's events never clash with another's. Travel estimates
 * only for `readerId`'s own events.
 */
export async function overlapsInSlices(
    slices: DataPageSlice[],
    from: number,
    to: number,
    readerId: string,
): Promise<
    {
        ownerId: string;
        ownerName: string;
        overlaps: CalendarOverlap[];
        events: MacDataItem[];
        complete: boolean;
    }[]
> {
    const calendars = slices.filter((slice) => slice.source === 'calendar');
    const owners = [...new Set(calendars.map((slice) => slice.ownerId))];
    const result = [];
    for (const ownerId of owners) {
        const mine = calendars.filter((slice) => slice.ownerId === ownerId);
        const { events, complete } = await sharedEventsIn(ownerId, mine, from, to);
        const estimates =
            ownerId === readerId
                ? await findTravelEstimates(
                      ownerId,
                      events.filter((e) => !!e.location).map((e) => e.id),
                  )
                : new Map<string, TravelEstimate>();
        const overlaps = findCalendarOverlaps(events, estimates).filter(
            // At least one side falls in the window.
            (o) => Math.max(endOf(o.first), endOf(o.second)) > from && o.first.occurredAt < to,
        );
        result.push({ ownerId, ownerName: mine[0]!.ownerName, overlaps, events, complete });
    }
    return result;
}

async function ownCalendarSlices(ownerId: string, notebookId: string): Promise<DataPageSlice[]> {
    return (await dataPageSlicesFor(ownerId, notebookId)).filter(
        (slice) => slice.source === 'calendar' && slice.ownerId === ownerId,
    );
}

/** Claims each overlap for `scope`; returns the ones newly claimed. */
async function claimAll(
    scope: string,
    overlaps: CalendarOverlap[],
    now: Date,
): Promise<{ overlap: CalendarOverlap; pairKey: string; signature: string }[]> {
    const claimed = [];
    for (const overlap of overlaps) {
        const pairKey = overlapPairKey(overlap);
        const signature = overlapSignature(overlap);
        const ids = [overlap.first.id, overlap.second.id].sort() as [string, string];
        if (await claimOverlapFlag(scope, pairKey, ids, signature, now))
            claimed.push({ overlap, pairKey, signature });
    }
    return claimed;
}

async function releaseAll(
    scope: string,
    claims: { pairKey: string; signature: string }[],
): Promise<void> {
    for (const claim of claims)
        await releaseOverlapFlag(scope, claim.pairKey, claim.signature).catch(() => {});
}

// MARK: - Proactive chats

/** What a proactive pass should say about overlaps, and what to do once it ran. */
export interface OverlapNews {
    /** New overlaps (or ones whose times changed), not flagged in this chat before. */
    flagged: OverlapNote[];
    /** Overlaps flagged before that these changes cleared. */
    cleared: OverlapNote[];
    /** The message went out: forget the cleared flags. */
    commit: () => Promise<void>;
    /** Nothing was posted: let the next pass flag (and clear) them again. */
    release: () => Promise<void>;
}

/**
 * Overlaps that changes to `changedIds` (the owner's calendar events) create or clear,
 * claimed for the chat `scope` so each is flagged once. Only events the notebook's
 * calendar pages of the owner share count, from yesterday through the coming weeks.
 */
export async function overlapNewsFor(
    scope: string,
    ownerId: string,
    notebookId: string,
    changedIds: string[],
    timeZone: string,
    now = new Date(),
): Promise<OverlapNews> {
    const noop = async () => {};
    const none: OverlapNews = { flagged: [], cleared: [], commit: noop, release: noop };
    if (changedIds.length === 0) return none;
    const slices = await ownCalendarSlices(ownerId, notebookId);
    if (slices.length === 0) return none;
    const flags = await findOverlapFlags(scope, changedIds);
    // The changed events and the other side of every earlier flag, in one query.
    const items = new Map(
        (
            await findDeviceItemsByIds(ownerId, [
                ...changedIds,
                ...flags.flatMap((flag) => flag.eventIds),
            ])
        ).map((item) => [item.id, item]),
    );
    // Still a timed event the page shares: a move to an unshared calendar isn't news.
    const shared = (id: string): MacDataItem | null => {
        const item = items.get(id);
        return item && !item.allDay && slices.some((slice) => slice.match(item)) ? item : null;
    };

    const nowSeconds = Math.floor(now.getTime() / 1000);
    const lo = nowSeconds - LOOKBACK_SECONDS;
    const hi = nowSeconds + LOOKAHEAD_SECONDS;
    const windows = changedIds
        .map(shared)
        .filter((e): e is MacDataItem => !!e)
        .map((e) => [
            Math.max(lo, e.occurredAt - WINDOW_PADDING_SECONDS),
            Math.min(hi, endOf(e) + WINDOW_PADDING_SECONDS),
        ])
        .filter(([from, to]) => from! < to!) as [number, number][];

    const changedSet = new Set(changedIds);
    const current = new Map<string, CalendarOverlap>();
    // Events the window check looked at, all of them (none when the cap cut some off).
    const evaluated = new Set<string>();
    if (windows.length) {
        const from = Math.min(...windows.map((w) => w[0]));
        const to = Math.max(...windows.map((w) => w[1]));
        const [mine] = await overlapsInSlices(slices, from, to, ownerId);
        for (const overlap of mine?.overlaps ?? []) {
            if (changedSet.has(overlap.first.id) || changedSet.has(overlap.second.id))
                current.set(overlapPairKey(overlap), overlap);
        }
        if (mine?.complete) for (const event of mine.events) evaluated.add(event.id);
    }

    const claims = await claimAll(scope, [...current.values()], now);
    const flagged = claims.map((claim) => describeOverlap(claim.overlap, timeZone));

    const clearedFlags: { pairKey: string; signature: string }[] = [];
    const cleared: OverlapNote[] = [];
    for (const flag of flags) {
        if (current.has(flag.pairKey)) continue;
        const [a, b] = flag.eventIds.map(shared);
        if (!a || !b) continue;
        // Cleared only when both were checked again, or they're now too far apart to clash.
        const checked = evaluated.has(a.id) && evaluated.has(b.id);
        if (!checked && gapBetween(a, b) < MAX_TRAVEL_MINUTES * 60) continue;
        const [first, second] = [a, b].sort((x, y) => x.occurredAt - y.occurredAt) as [
            MacDataItem,
            MacDataItem,
        ];
        clearedFlags.push(flag);
        cleared.push({
            ...describeOverlap({ kind: 'overlap', first, second }, timeZone),
            summary: `${[first, second].map((e) => e.title?.trim() || 'Untitled event').join(' and ')} no longer overlap`,
        });
    }

    return {
        flagged,
        cleared,
        commit: () => releaseAll(scope, clearedFlags),
        release: () => releaseAll(scope, claims),
    };
}

/**
 * Today's and tomorrow's overlaps in the owner's time zone, for the chat's daily brief.
 * Listed whether or not they were flagged before; listing one counts as flagging it, once
 * the brief went out (`release` otherwise).
 */
export async function briefOverlapsFor(
    scope: string,
    ownerId: string,
    notebookId: string,
    timeZone: string,
    now = new Date(),
): Promise<{ notes: OverlapNote[]; release: () => Promise<void> }> {
    const slices = await ownCalendarSlices(ownerId, notebookId);
    if (slices.length === 0) return { notes: [], release: async () => {} };
    const today = formatInZone(now, timeZone).slice(0, 10);
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const from = toEpochSeconds(today, timeZone, 'start')!;
    const to = toEpochSeconds(tomorrow, timeZone, 'end')! + 1;
    const [mine] = await overlapsInSlices(slices, from, to, ownerId);
    const overlaps = mine?.overlaps ?? [];
    const claims = await claimAll(scope, overlaps, now).catch(() => []);
    return {
        notes: overlaps.map((overlap) => describeOverlap(overlap, timeZone)),
        release: () => releaseAll(scope, claims),
    };
}

// MARK: - Bot tool

/** find_overlaps: clashes in a date range across the calendars the notebook shares. */
export async function findOverlapsForBot(
    ctx: { userId: string; timeZone: string; pages?: DataPageSlice[] },
    input: Record<string, unknown>,
    now = new Date(),
): Promise<OverlapNote[]> {
    const from =
        toEpochSeconds(input.from, ctx.timeZone, 'start') ?? Math.floor(now.getTime() / 1000);
    const to = toEpochSeconds(input.to, ctx.timeZone, 'end') ?? from + 7 * DAY_SECONDS;
    // Without page slices (older contexts), the user's own calendar, unfiltered.
    const slices: DataPageSlice[] = ctx.pages ?? [
        {
            pageId: '',
            source: 'calendar',
            ownerId: ctx.userId,
            ownerName: '',
            title: '',
            match: () => true,
        },
    ];
    const notes: OverlapNote[] = [];
    const end = Math.min(to + 1, from + 31 * DAY_SECONDS);
    for (const owner of await overlapsInSlices(slices, from, end, ctx.userId))
        for (const overlap of owner.overlaps)
            notes.push(
                describeOverlap(
                    overlap,
                    ctx.timeZone,
                    owner.ownerId !== ctx.userId ? owner.ownerName : undefined,
                ),
            );
    return notes;
}
