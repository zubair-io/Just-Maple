import { isNotebookShared, type MacDataItem, type Page } from '@maple/shared';
import { findAboutMePage, findAllProactivePages } from '../repositories/page.repo';
import { dataPageSlicesFor } from './device-data-access.service';
import { collectorTimeZone } from '../repositories/collector.repo';
import { findDeviceItems } from '../repositories/device-item.repo';
import { findTravelEstimates } from '../repositories/travel-estimate.repo';
import {
    claimScheduledSend,
    failScheduledSend,
    purgeOldScheduledSends,
} from '../repositories/scheduled-send.repo';
import { purgeOldTravelEstimates } from '../repositories/travel-estimate.repo';
import { purgeOldOverlapFlags } from '../repositories/calendar-overlap.repo';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import { askAboutMeQuestion, runDailyBrief, sendLeaveReminder } from './proactive-bot.service';
import { formatInZone } from '../utils/time-zone';
import { currentPlace } from './about-me.service';

/**
 * Time-based proactive messages, checked every minute:
 *
 * 1. **Daily brief.** A proactive page with a brief time ("07:30") gets one brief per
 *    day, at that time in the owner's time zone, or within two hours if the server was
 *    down at the moment.
 * 2. **Leave-now reminders.** For an upcoming event with a location, the owner's iPhone
 *    estimates driving time. When it's time to leave (driving time plus a 10-minute
 *    buffer before the start), the owner's proactive bot says so, once per event, in a
 *    chat whose notebook's calendar page shares that event (see `reminderChatsFor`).
 * 3. **About me questions.** Once a day at most, in the early evening, the owner's
 *    proactive bot may ask one question to fill a gap in their About me, in a notebook
 *    with an About me page that nobody else can see. The bot skips it (NO_UPDATE) when
 *    it asked recently or has nothing worth asking.
 *
 * Each send is claimed in the database first, so several API instances never send it twice.
 * A send that fails (the bot couldn't run, or the model errored) is retried a few times.
 */

const TICK_MS = 60_000;
const BRIEF_WINDOW_MINUTES = 120;
const LEAVE_BUFFER_SECONDS = 10 * 60;
/** Remind a few minutes before the leave-by time, not after it. */
const LEAVE_HEADS_UP_SECONDS = 5 * 60;
/** Estimates older than this (the phone hasn't updated) aren't trusted. */
const ESTIMATE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const LOOKAHEAD_SECONDS = 4 * 60 * 60;
/** A phone clock this far ahead of the server makes an estimate untrustworthy. */
const ESTIMATE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const CLEANUP_MS = 60 * 60 * 1000;
/** When About me questions may be asked, owner's local time (within the brief window). */
const QUESTION_TIME = '17:30';

export function startProactiveScheduler(intervalMs = TICK_MS): () => void {
    const timer = setInterval(() => void tick(), intervalMs);
    const cleanup = setInterval(() => void purgeOldRecords(), CLEANUP_MS);
    timer.unref?.();
    cleanup.unref?.();
    return () => {
        clearInterval(timer);
        clearInterval(cleanup);
    };
}

async function purgeOldRecords(): Promise<void> {
    try {
        await purgeOldScheduledSends();
        await purgeOldTravelEstimates();
        await purgeOldOverlapFlags();
    } catch (error) {
        console.error('[Scheduler] Cleanup failed:', error);
    }
}

/** Sends in the background; if it doesn't go out, the claim is released for a retry. */
function deliver(key: string, now: Date, send: () => Promise<boolean>, what: string): void {
    void send()
        .catch((error) => {
            console.error(`[Scheduler] ${what} failed:`, error);
            return false;
        })
        .then((sent) => (sent ? undefined : failScheduledSend(key, now)))
        .catch((error) => console.error(`[Scheduler] Couldn't record failed ${what}:`, error));
}

export async function tick(now = new Date()): Promise<void> {
    try {
        const pages = await findAllProactivePages();
        await sendDueBriefs(pages, now);
        await sendLeaveReminders(pages, now);
        await sendAboutMeQuestions(pages, now);
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
        // Without a device's time zone there's no telling when 07:30 is for this user.
        const timeZone = await collectorTimeZone(owner);
        if (!timeZone) continue;
        const briefDay = dayOfSlot(now, timeZone, briefTime);
        if (!briefDay) continue;
        const key = `brief:${page.id}:${briefDay}`;
        if (!(await claimScheduledSend(key, now))) continue;
        deliver(key, now, () => runDailyBrief(page, owner), `brief for page ${page.id}`);
        sent++;
    }
    return sent;
}

/**
 * The local day a time slot ("07:30") belongs to, if now is within the window after it.
 * Counts across midnight: a 23:30 slot caught up at 00:15 is 45 minutes late, and
 * belongs to the day before.
 */
function dayOfSlot(now: Date, timeZone: string, slot: string): string | null {
    const local = formatInZone(now, timeZone);
    const minutesLate = (minutesOf(local.slice(11, 16)) - minutesOf(slot) + 1440) % 1440;
    if (minutesLate > BRIEF_WINDOW_MINUTES) return null;
    return formatInZone(new Date(now.getTime() - minutesLate * 60_000), timeZone).slice(0, 10);
}

// MARK: - Leave-now reminders

export async function sendLeaveReminders(pages: Page[], now: Date): Promise<number> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    // One reminder per owner and event, posted in their first proactive chat whose
    // notebook's calendar page shares the event.
    const owners = new Map<string, Page[]>();
    for (const page of pages) {
        const owner = page.proactive?.ownerUserId;
        if (owner) owners.set(owner, [...(owners.get(owner) ?? []), page]);
    }
    let sent = 0;
    for (const [owner, ownerPages] of owners) {
        const chats = await reminderChatsFor(owner, ownerPages);
        if (chats.length === 0) continue;
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
        const here = await currentPlace(owner, now.getTime());
        const timeZone = (await collectorTimeZone(owner)) ?? 'UTC';
        for (const event of events) {
            const page = chats.find((chat) => chat.shares(event))?.page;
            if (!page) continue;
            const estimate = estimates.get(event.id);
            if (!estimate || !isFresh(estimate.computedAt, now)) continue;
            // Already there, or close enough that there's nothing to plan.
            if (estimate.minutes < 3) continue;
            if (here && sameSpot(here, event.location!)) continue;
            const leaveBy = event.occurredAt - estimate.minutes * 60 - LEAVE_BUFFER_SECONDS;
            if (nowSeconds < leaveBy - LEAVE_HEADS_UP_SECONDS || nowSeconds >= event.occurredAt)
                continue;
            const key = `leave:${owner}:${event.id}:${event.occurredAt}`;
            if (!(await claimScheduledSend(key, now))) continue;
            const details = {
                ...(event.title ? { title: event.title } : {}),
                when: formatInZone(new Date(event.occurredAt * 1000), timeZone),
                location: event.location!,
                leaveBy: formatInZone(new Date(leaveBy * 1000), timeZone),
                note: `about ${Math.round(estimate.minutes)} min drive${estimate.origin ? ` from ${estimate.origin}` : ''}`,
            };
            deliver(
                key,
                now,
                () => sendLeaveReminder(page, owner, details),
                `leave reminder for ${event.id}`,
            );
            sent++;
        }
    }
    return sent;
}

interface ReminderChat {
    page: Page;
    shares: (event: MacDataItem) => boolean;
}

/**
 * The chats that can get the owner's leave reminders, best first: ones whose notebook has
 * the owner's calendar page, each with what that page shares. A notebook nobody else can
 * see comes first (a reminder says where the user is going and from where); in a shared
 * notebook only events the page's filter shares count, and a page without a filter
 * shares none (see device-data-access.service). Ties go to the oldest chat, so the
 * choice doesn't change from day to day.
 */
async function reminderChatsFor(owner: string, pages: Page[]): Promise<ReminderChat[]> {
    const ordered = [...pages].sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || a.id.localeCompare(b.id),
    );
    const privateChats: ReminderChat[] = [];
    const sharedChats: ReminderChat[] = [];
    for (const page of ordered) {
        if (!page.notebookId) continue;
        const calendars = (await dataPageSlicesFor(owner, page.notebookId)).filter(
            (slice) => slice.ownerId === owner && slice.source === 'calendar',
        );
        if (calendars.length === 0) continue;
        const chat = {
            page,
            shares: (event: MacDataItem) => calendars.some((slice) => slice.match(event)),
        };
        const notebook = await findNotebookByIdUnsafe(page.notebookId);
        (isNotebookShared(notebook) ? sharedChats : privateChats).push(chat);
    }
    return [...privateChats, ...sharedChats];
}

// MARK: - About me questions

/**
 * At most one About me question per owner per day, in their first chat (oldest) whose
 * notebook has an About me page and nobody else can see it.
 */
export async function sendAboutMeQuestions(pages: Page[], now: Date): Promise<number> {
    const owners = new Map<string, Page[]>();
    for (const page of pages) {
        const owner = page.proactive?.ownerUserId;
        if (owner && page.notebookId) owners.set(owner, [...(owners.get(owner) ?? []), page]);
    }
    let sent = 0;
    for (const [owner, ownerPages] of owners) {
        const timeZone = await collectorTimeZone(owner);
        if (!timeZone) continue;
        const day = dayOfSlot(now, timeZone, QUESTION_TIME);
        if (!day) continue;
        const page = await questionPageFor(ownerPages);
        if (!page) continue;
        const key = `aboutme-question:${owner}:${day}`;
        if (!(await claimScheduledSend(key, now))) continue;
        deliver(key, now, () => askAboutMeQuestion(page, owner), `About me question for ${owner}`);
        sent++;
    }
    return sent;
}

async function questionPageFor(pages: Page[]): Promise<Page | null> {
    const ordered = [...pages].sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const page of ordered) {
        if (!(await findAboutMePage(page.notebookId!))) continue;
        const notebook = await findNotebookByIdUnsafe(page.notebookId!);
        if (notebook && !isNotebookShared(notebook)) return page;
    }
    return null;
}

/** The phone's estimate is recent, and not from a clock running ahead. */
function isFresh(computedAt: string, now: Date): boolean {
    const age = now.getTime() - Date.parse(computedAt);
    return Number.isFinite(age) && age <= ESTIMATE_MAX_AGE_MS && age >= -ESTIMATE_CLOCK_SKEW_MS;
}

/**
 * Whether the user's current place is the event's location ("Home" for an event at
 * "Home", or the same address). Only locations are compared: an event titled
 * "Homecoming game" is not at Home.
 */
function sameSpot(place: string, location: string): boolean {
    const a = place.toLowerCase().trim();
    const loc = location.toLowerCase().trim();
    return (
        a.length > 2 &&
        loc.length > 2 &&
        (loc === a || loc.startsWith(`${a},`) || a.startsWith(`${loc},`))
    );
}

function minutesOf(hhmm: string): number {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
}
