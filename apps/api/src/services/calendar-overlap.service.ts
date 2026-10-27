import type { MacDataItem, TravelEstimate } from '@maple/shared';
import { findDeviceItem, findDeviceItems } from '../repositories/device-item.repo';
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
 *    when the gap is shorter than the drive: the iPhone's estimate for the later event
 *    when there is one, otherwise 15 minutes.
 * 2. Only events a notebook's calendar pages share count (see device-data-access.service).
 * 3. A chat's proactive bot hears about an overlap when calendar changes create it or
 *    clear it, and its daily brief lists today's and tomorrow's. Each pair is flagged once
 *    per chat until one of its events moves (calendar-overlap.repo).
 * 4. Bots can ask with the find_overlaps tool.
 */

const DEFAULT_TRAVEL_MINUTES = 15;
const DAY_SECONDS = 24 * 60 * 60;
const MAX_EVENTS = 500;

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
            // The same meeting on two calendars (an invite copied to a shared one).
            if (sameEvent(first, second)) continue;
            const start = second.occurredAt;
            if (start < endOf(first) && first.occurredAt < endOf(second)) {
                const shared = Math.min(endOf(first), endOf(second)) - start;
                overlaps.push({ kind: 'overlap', first, second, overlapMinutes: shared / 60 });
                continue;
            }
            if (!needsTravel(first, second)) continue;
            const gap = (start - endOf(first)) / 60;
            if (gap < 0) continue;
            const travel = estimates.get(second.id)?.minutes ?? DEFAULT_TRAVEL_MINUTES;
            if (gap < travel)
                overlaps.push({
                    kind: 'tight',
                    first,
                    second,
                    gapMinutes: gap,
                    travelMinutes: travel,
                });
        }
    }
    return overlaps;
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
 * Overlaps among each person's shared events that touch [from, to): one list per
 * calendar owner, since one person's events never clash with another's.
 */
export async function overlapsInSlices(
    slices: DataPageSlice[],
    from: number,
    to: number,
): Promise<{ ownerId: string; ownerName: string; overlaps: CalendarOverlap[] }[]> {
    const calendars = slices.filter((slice) => slice.source === 'calendar');
    const owners = [...new Set(calendars.map((slice) => slice.ownerId))];
    const result = [];
    for (const ownerId of owners) {
        const mine = calendars.filter((slice) => slice.ownerId === ownerId);
        const { items } = await findDeviceItems(ownerId, {
            sources: ['calendar'],
            // A long event that started the day before still counts.
            from: from - DAY_SECONDS,
            to,
            order: 'asc',
            limit: MAX_EVENTS,
            match: (item) => mine.some((slice) => slice.match(item)),
        });
        const events = items.filter((e) => endOf(e) > from || e.occurredAt >= from);
        const estimates = await findTravelEstimates(
            ownerId,
            events.filter((e) => !!e.location).map((e) => e.id),
        );
        const overlaps = findCalendarOverlaps(events, estimates).filter(
            // At least one side falls in the window.
            (o) => Math.max(endOf(o.first), endOf(o.second)) > from && o.first.occurredAt < to,
        );
        result.push({ ownerId, ownerName: mine[0]!.ownerName, overlaps });
    }
    return result;
}

// MARK: - Proactive chats

/** What a proactive pass should say about overlaps, and how to undo the claims if it can't. */
export interface OverlapNews {
    /** New overlaps (or ones whose times changed), not flagged in this chat before. */
    flagged: OverlapNote[];
    /** Overlaps flagged before that these changes cleared. */
    cleared: OverlapNote[];
    /** The message didn't go out: let the next pass flag them again. */
    release: () => Promise<void>;
}

/**
 * Overlaps that changes to `changedIds` (the owner's calendar events) create or clear,
 * claimed for the chat `scope` so each is flagged once. Only events the notebook's
 * calendar pages of the owner share count.
 */
export async function overlapNewsFor(
    scope: string,
    ownerId: string,
    notebookId: string,
    changedIds: string[],
    timeZone: string,
    now = new Date(),
): Promise<OverlapNews> {
    const none: OverlapNews = { flagged: [], cleared: [], release: async () => {} };
    if (changedIds.length === 0) return none;
    const slices = (await dataPageSlicesFor(ownerId, notebookId)).filter(
        (slice) => slice.source === 'calendar' && slice.ownerId === ownerId,
    );
    const shares = (item: MacDataItem | null | undefined): item is MacDataItem =>
        !!item && slices.some((slice) => slice.match(item));
    const changed = (await Promise.all(changedIds.map((id) => findDeviceItem(ownerId, id)))).filter(
        shares,
    );
    const changedSet = new Set(changedIds);
    const current = new Map<string, CalendarOverlap>();
    if (changed.length && slices.length) {
        const from = Math.min(...changed.map((e) => e.occurredAt)) - DAY_SECONDS;
        const to = Math.max(...changed.map(endOf)) + DAY_SECONDS;
        const [mine] = await overlapsInSlices(slices, from, to);
        for (const overlap of mine?.overlaps ?? []) {
            if (changedSet.has(overlap.first.id) || changedSet.has(overlap.second.id))
                current.set(overlapPairKey(overlap), overlap);
        }
    }

    const flagged: OverlapNote[] = [];
    const claims: { pairKey: string; signature: string }[] = [];
    for (const [pairKey, overlap] of current) {
        const signature = overlapSignature(overlap);
        const ids = [overlap.first.id, overlap.second.id].sort() as [string, string];
        if (!(await claimOverlapFlag(scope, pairKey, ids, signature, now))) continue;
        claims.push({ pairKey, signature });
        flagged.push(describeOverlap(overlap, timeZone));
    }

    const cleared: OverlapNote[] = [];
    for (const flag of await findOverlapFlags(scope, changedIds)) {
        if (current.has(flag.pairKey)) continue;
        if (!(await releaseOverlapFlag(scope, flag.pairKey, flag.signature))) continue;
        const [a, b] = await Promise.all(flag.eventIds.map((id) => findDeviceItem(ownerId, id)));
        const events = [a, b].filter(shares).sort((x, y) => x.occurredAt - y.occurredAt);
        if (events.length === 0) continue;
        cleared.push({
            ...describeOverlap(
                { kind: 'overlap', first: events[0]!, second: events[1] ?? events[0]! },
                timeZone,
            ),
            summary:
                events.length === 2
                    ? `${events.map((e) => e.title?.trim() || 'Untitled event').join(' and ')} no longer overlap`
                    : `${events[0]!.title?.trim() || 'An event'} no longer overlaps another event`,
        });
    }

    return {
        flagged,
        cleared,
        release: async () => {
            for (const claim of claims)
                await releaseOverlapFlag(scope, claim.pairKey, claim.signature).catch(() => {});
        },
    };
}

/**
 * Today's and tomorrow's overlaps in the owner's time zone, for the chat's daily brief.
 * Listed whether or not they were flagged before; listing one counts as flagging it.
 */
export async function briefOverlapsFor(
    scope: string,
    ownerId: string,
    notebookId: string,
    timeZone: string,
    now = new Date(),
): Promise<OverlapNote[]> {
    const slices = (await dataPageSlicesFor(ownerId, notebookId)).filter(
        (slice) => slice.source === 'calendar' && slice.ownerId === ownerId,
    );
    if (slices.length === 0) return [];
    const today = formatInZone(now, timeZone).slice(0, 10);
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const from = toEpochSeconds(today, timeZone, 'start')!;
    const to = toEpochSeconds(tomorrow, timeZone, 'end')! + 1;
    const [mine] = await overlapsInSlices(slices, from, to);
    const overlaps = mine?.overlaps ?? [];
    for (const overlap of overlaps) {
        const ids = [overlap.first.id, overlap.second.id].sort() as [string, string];
        await claimOverlapFlag(
            scope,
            overlapPairKey(overlap),
            ids,
            overlapSignature(overlap),
            now,
        ).catch(() => false);
    }
    return overlaps.map((overlap) => describeOverlap(overlap, timeZone));
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
    for (const owner of await overlapsInSlices(slices, from, Math.min(to, from + 31 * DAY_SECONDS)))
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
