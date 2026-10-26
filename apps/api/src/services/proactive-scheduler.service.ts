import type { Page } from '@maple/shared';
import { findAllProactivePages, findDeviceDataPages } from '../repositories/page.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import { findDeviceItems } from '../repositories/device-item.repo';
import { findTravelEstimates } from '../repositories/travel-estimate.repo';
import { claimScheduledSend } from '../repositories/scheduled-send.repo';
import { listFacts, findMe } from '../repositories/profile.repo';
import { runDailyBrief, sendLeaveReminder } from './proactive-bot.service';
import { formatInZone } from '../utils/time-zone';
import { isLive } from './about-me.service';

/**
 * Time-based proactive messages, checked every minute:
 *
 * 1. **Daily brief.** A proactive page with a brief time ("07:30") gets one brief per
 *    day, at that time in the owner's time zone, or within two hours if the server was
 *    down at the moment.
 * 2. **Leave-now reminders.** For an upcoming event with a location, the owner's iPhone
 *    estimates driving time. When it's time to leave (driving time plus a 10-minute
 *    buffer before the start), the owner's proactive bot says so, once per event.
 *
 * Each send is claimed in the database first, so several API instances never send it twice.
 */

const TICK_MS = 60_000;
const BRIEF_WINDOW_MINUTES = 120;
const LEAVE_BUFFER_SECONDS = 10 * 60;
/** Remind a few minutes before the leave-by time, not after it. */
const LEAVE_HEADS_UP_SECONDS = 5 * 60;
/** Estimates older than this (the phone hasn't updated) aren't trusted. */
const ESTIMATE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const LOOKAHEAD_SECONDS = 4 * 60 * 60;

export function startProactiveScheduler(intervalMs = TICK_MS): () => void {
    const timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

export async function tick(now = new Date()): Promise<void> {
    try {
        const pages = await findAllProactivePages();
        await sendDueBriefs(pages, now);
        await sendLeaveReminders(pages, now);
    } catch (error) {
        console.error('[Scheduler] Tick failed:', error);
    }
}

// MARK: - Daily briefs

export async function sendDueBriefs(pages: Page[], now: Date): Promise<number> {
    let sent = 0;
    for (const page of pages) {
        const owner = page.proactive?.ownerUserId;
        const briefTime = page.proactive?.briefTime;
        if (!owner || !briefTime) continue;
        const local = formatInZone(now, (await collectorTimeZone(owner)) ?? 'UTC');
        const minutesLate = minutesOf(local.slice(11, 16)) - minutesOf(briefTime);
        if (minutesLate < 0 || minutesLate > BRIEF_WINDOW_MINUTES) continue;
        if (!(await claimScheduledSend(`brief:${page.id}:${local.slice(0, 10)}`))) continue;
        void runDailyBrief(page, owner).catch((error) =>
            console.error(`[Scheduler] Brief failed for page ${page.id}:`, error),
        );
        sent++;
    }
    return sent;
}

// MARK: - Leave-now reminders

export async function sendLeaveReminders(pages: Page[], now: Date): Promise<number> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    // One reminder per owner and event, posted in their first proactive chat that can
    // see their calendar.
    const owners = new Map<string, Page[]>();
    for (const page of pages) {
        const owner = page.proactive?.ownerUserId;
        if (owner) owners.set(owner, [...(owners.get(owner) ?? []), page]);
    }
    let sent = 0;
    for (const [owner, ownerPages] of owners) {
        const page = await firstPageWithCalendar(owner, ownerPages);
        if (!page) continue;
        const { items } = await findDeviceItems(owner, {
            sources: ['calendar'],
            from: nowSeconds,
            to: nowSeconds + LOOKAHEAD_SECONDS,
            limit: 100,
            order: 'asc',
        });
        const events = items.filter((item) => !!item.location?.trim() && !item.allDay);
        if (events.length === 0) continue;
        const estimates = await findTravelEstimates(
            owner,
            events.map((event) => event.id),
        );
        const currentPlace = await currentPlaceOf(owner, now);
        const timeZone = (await collectorTimeZone(owner)) ?? 'UTC';
        for (const event of events) {
            const estimate = estimates.get(event.id);
            if (!estimate || now.getTime() - Date.parse(estimate.computedAt) > ESTIMATE_MAX_AGE_MS)
                continue;
            // Already there, or close enough that there's nothing to plan.
            if (estimate.minutes < 3) continue;
            if (currentPlace && sameSpot(currentPlace, event.location!, event.title)) continue;
            const leaveBy = event.occurredAt - estimate.minutes * 60 - LEAVE_BUFFER_SECONDS;
            if (nowSeconds < leaveBy - LEAVE_HEADS_UP_SECONDS || nowSeconds >= event.occurredAt)
                continue;
            if (!(await claimScheduledSend(`leave:${owner}:${event.id}:${event.occurredAt}`)))
                continue;
            void sendLeaveReminder(page, owner, {
                ...(event.title ? { title: event.title } : {}),
                when: formatInZone(new Date(event.occurredAt * 1000), timeZone),
                location: event.location!,
                leaveBy: formatInZone(new Date(leaveBy * 1000), timeZone),
                note: `about ${Math.round(estimate.minutes)} min drive${estimate.origin ? ` from ${estimate.origin}` : ''}`,
            }).catch((error) =>
                console.error(`[Scheduler] Leave reminder failed for ${event.id}:`, error),
            );
            sent++;
        }
    }
    return sent;
}

async function firstPageWithCalendar(owner: string, pages: Page[]): Promise<Page | null> {
    for (const page of pages) {
        if (!page.notebookId) continue;
        const devicePages = await findDeviceDataPages(owner, page.notebookId);
        if (devicePages.some((p) => p.deviceSource === 'calendar')) return page;
    }
    return null;
}

/** Where About me says the user is right now (from iPhone visits), if anywhere. */
async function currentPlaceOf(owner: string, now: Date): Promise<string | null> {
    const me = await findMe(owner);
    if (!me) return null;
    const fact = (await listFacts(owner)).find(
        (f) => f.about === me.id && f.key === 'location' && isLive(f, now.getTime()),
    );
    return fact?.value ?? null;
}

function sameSpot(place: string, location: string, title?: string): boolean {
    const a = place.toLowerCase().trim();
    const loc = location.toLowerCase();
    return (
        a.length > 2 && (loc.includes(a) || a.includes(loc) || !!title?.toLowerCase().includes(a))
    );
}

function minutesOf(hhmm: string): number {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
}
