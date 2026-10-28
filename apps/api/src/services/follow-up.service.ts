import {
    isNotebookShared,
    type FollowUp,
    type FollowUpAction,
    type FollowUpList,
    type MacDataItem,
} from '@maple/shared';
import {
    autoCloseFollowUp,
    claimFollowUpPass,
    findFollowUp,
    findFollowUpState,
    findFollowUpsByUser,
    findScannedItems,
    finishFollowUpPass,
    followUpId,
    insertFollowUps,
    markItemsScanned,
    pruneFollowUpUsage,
    pruneScannedItems,
    releaseFollowUpCall,
    releaseFollowUpPass,
    reserveFollowUpCall,
    setFollowUpStatus,
    type FollowUpDocument,
    type NewFollowUp,
} from '../repositories/follow-up.repo';
import { findDeviceItemsByIds, findDeviceItemsForGraph } from '../repositories/device-item.repo';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import { findFollowUpsNotebookIds } from '../repositories/page.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import {
    dataPageSlicesFor,
    notebookDataSlices,
    type DataPageSlice,
} from './device-data-access.service';
import { sharedRefusal } from './about-me.service';
import {
    askedQuestion,
    closingEvidence,
    counterpartOf,
    DAY,
    directQuestion,
    dueFromDate,
    HOUR,
    isAutomated,
    isFromMe,
    isGroupChat,
    mayHoldPromise,
    parseDue,
    rulePromise,
    threadKeyOf,
    whoOf,
} from './follow-up-rules';
import {
    followUpModelAvailable,
    judgePromises,
    type PromiseJudgeItem,
} from './follow-up-model.service';
import { formatInZone } from '../utils/time-zone';

/**
 * Follow-ups: promises and replies owed, in both directions.
 *
 * 1. A notebook opts in by adding its Follow-ups page. From then on, a background pass
 *    reads the messages and mail its data pages share (each through its filter) over
 *    the last two weeks, for each person whose data they are.
 * 2. Rules find questions left hanging: one you asked with no answer for 3 days
 *    ("waiting on reply"), one put to you directly with no answer for a day ("you owe a
 *    reply"). A batched model pass on the server's key, capped per person per day, finds
 *    promises: yours ("I'll send you the photos tomorrow") and theirs ("I'll get back to
 *    you Friday"). Without a model key, explicit "I'll send…" promises are found by rule.
 * 3. A follow-up belongs to the person whose data it was found in. It closes by itself
 *    when the thread shows it's done (a later reply, the promised attachment, or an
 *    event made for it), and records why.
 * 4. Reading in a notebook shows each person only their own, and only while the
 *    notebook's pages share every item it's based on, checked on every read. In a shared
 *    notebook, ones about health, money, legal matters or relationships are hidden
 *    (the About me check).
 * 5. Done, snooze and dismiss are the person's (and their own bots', for done and
 *    snooze), and every one can be undone. Dismissed ones are never found again.
 */

const WINDOW_DAYS = 14;
/** Your question with no answer this long is "waiting on reply". */
export const WAITING_DAYS = 3;
/** Their direct question with no answer this long is "you owe a reply". */
export const OWE_REPLY_HOURS = 24;
const MAX_ITEMS_PER_SOURCE = 3_000;
const BODY_CHARS = 1_000;
const ITEMS_PER_CALL = 25;
/** Model calls per pass, and per person per day. */
const CALLS_PER_PASS = 3;
export const USER_DAILY_CALLS = 12;
/** Model promises below this aren't kept. */
export const MIN_CONFIDENCE = 0.6;
const LEASE_MS = 10 * 60 * 1000;
/** Passes for one person are at least this far apart. */
const PASS_GAP_MS = 10 * 60 * 1000;
const MAX_SNOOZE_DAYS = 180;

export interface FollowUpPassResult {
    found: number;
    closed: number;
    modelCalls: number;
    /** Messages that may hold a promise and still wait for the model. */
    pending: number;
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const nowSeconds = (now: Date) => Math.floor(now.getTime() / 1000);

/** Health, money, legal or relationship matters: the About me rule for shared notebooks. */
function isPrivateMatter(text: string): boolean {
    return !!sharedRefusal({ key: '', value: text, kind: 'lasting' });
}

function clipQuestion(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

// MARK: - Finding

/** What the person's items in the window need to be scanned and closed. */
interface OwnerItems {
    /** Messages and mail, oldest first, by thread. */
    threads: Map<string, MacDataItem[]>;
    /** Items some Follow-ups notebook shares: only these start a follow-up. */
    shared: MacDataItem[];
}

async function loadOwnerItems(
    userId: string,
    slices: DataPageSlice[],
    now: Date,
): Promise<OwnerItems> {
    const from = nowSeconds(now) - WINDOW_DAYS * DAY;
    const threads = new Map<string, MacDataItem[]>();
    const shared: MacDataItem[] = [];
    for (const source of ['imessage', 'mail'] as const) {
        const mine = slices.filter((slice) => slice.source === source);
        if (mine.length === 0) continue;
        // Every message in the window, to see who answered; only shared ones start one.
        const items = await findDeviceItemsForGraph(userId, source, {
            from,
            to: nowSeconds(now) + HOUR,
            limit: MAX_ITEMS_PER_SOURCE,
            bodyChars: BODY_CHARS,
        });
        for (const item of items) {
            const key = threadKeyOf(item);
            if (key) threads.set(key, [...(threads.get(key) ?? []), item]);
            if (mine.some((slice) => slice.match(item))) shared.push(item);
        }
    }
    for (const list of threads.values()) list.sort((a, b) => a.occurredAt - b.occurredAt);
    return { threads, shared };
}

function newFollowUp(
    userId: string,
    item: MacDataItem,
    fields: Pick<NewFollowUp, 'direction' | 'what' | 'confidence' | 'madeBy'> & {
        dueAt?: number;
        sensitive?: boolean;
    },
): NewFollowUp {
    const counterpart = counterpartOf(item);
    return {
        _id: followUpId(userId, fields.direction, item.id),
        userId,
        direction: fields.direction,
        who: whoOf(item).slice(0, 80),
        what: fields.what,
        at: item.occurredAt,
        ...(fields.dueAt !== undefined ? { dueAt: fields.dueAt } : {}),
        confidence: fields.confidence,
        madeBy: fields.madeBy,
        evidence: [
            {
                itemId: item.id,
                source: item.source,
                at: item.occurredAt,
                ...(item.title || item.thread
                    ? { title: (item.title || item.thread)!.slice(0, 120) }
                    : {}),
            },
        ],
        threadKey: threadKeyOf(item) ?? `item:${item.id}`,
        ...(counterpart ? { counterpart } : {}),
        sensitive:
            !!fields.sensitive ||
            isPrivateMatter(fields.what) ||
            isPrivateMatter(`${item.title ?? ''} ${item.body.slice(0, 600)}`),
    };
}

/**
 * Questions left hanging, from the threads: in each thread, the latest question you
 * asked that they haven't answered in 3 days, and the latest one they put to you that
 * you haven't answered in a day. Group chats are left out (a question there may be for
 * anyone).
 */
export function questionFollowUps(
    userId: string,
    items: OwnerItems,
    now: Date,
    timeZone: string,
): NewFollowUp[] {
    const shared = new Set(items.shared.map((item) => item.id));
    const out: NewFollowUp[] = [];
    const current = nowSeconds(now);
    for (const thread of items.threads.values()) {
        const last = thread.at(-1);
        if (!last || isGroupChat(last) || isAutomated(last)) continue;
        // The newest run of messages from one side: the other side hasn't answered it.
        const run: MacDataItem[] = [];
        for (let i = thread.length - 1; i >= 0 && isFromMe(thread[i]!) === isFromMe(last); i--)
            run.push(thread[i]!);
        for (const item of run) {
            if (!shared.has(item.id)) continue;
            if (isFromMe(item)) {
                const question = askedQuestion(item.body);
                if (!question || current - item.occurredAt < WAITING_DAYS * DAY) continue;
                out.push(
                    newFollowUp(userId, item, {
                        direction: 'waiting_reply',
                        what: clipQuestion(question),
                        dueAt: item.occurredAt + WAITING_DAYS * DAY,
                        confidence: 0.7,
                        madeBy: 'rule',
                    }),
                );
            } else {
                const question = directQuestion(item.body);
                if (!question || current - item.occurredAt < OWE_REPLY_HOURS * HOUR) continue;
                out.push(
                    newFollowUp(userId, item, {
                        direction: 'owe_reply',
                        what: clipQuestion(question),
                        dueAt: parseDue(question, item.occurredAt, timeZone),
                        confidence: 0.7,
                        madeBy: 'rule',
                    }),
                );
            }
            break; // The latest question in the run is the one owed.
        }
    }
    return out;
}

/** Explicit "I'll send…" promises, when there's no model to read wording. */
function rulePromises(userId: string, candidates: MacDataItem[], timeZone: string): NewFollowUp[] {
    const out: NewFollowUp[] = [];
    for (const item of candidates) {
        const what = rulePromise(item.body);
        if (!what) continue;
        out.push(
            newFollowUp(userId, item, {
                direction: isFromMe(item) ? 'you_promised' : 'they_owe',
                what,
                dueAt: parseDue(item.body, item.occurredAt, timeZone),
                confidence: 0.6,
                madeBy: 'rule',
            }),
        );
    }
    return out;
}

/** Takes one call from the person's daily budget. */
async function reserveCall(userId: string, now: Date): Promise<boolean> {
    return reserveFollowUpCall(userId, dayOf(now), USER_DAILY_CALLS);
}

/**
 * Asks the model about messages it hasn't read that may hold a promise, newest first, a
 * batch per call, within the pass and daily budgets. Items are noted as read only once
 * their call succeeded, so a failed or capped batch is read in a later pass.
 */
async function modelPromises(
    userId: string,
    candidates: MacDataItem[],
    now: Date,
    timeZone: string,
): Promise<{ found: NewFollowUp[]; calls: number; pending: number }> {
    const seen = await findScannedItems(userId, candidates);
    const todo = candidates
        .filter((item) => !seen.has(item.id))
        .sort((a, b) => b.occurredAt - a.occurredAt);
    const found: NewFollowUp[] = [];
    let calls = 0;
    let done = 0;
    const local = formatInZone(now, timeZone).slice(0, 10);
    const today = `${local} (${new Date(`${local}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`;
    while (done < todo.length && calls < CALLS_PER_PASS) {
        const batch = todo.slice(done, done + ITEMS_PER_CALL);
        if (!(await reserveCall(userId, now))) break;
        calls++;
        const items: PromiseJudgeItem[] = batch.map((item, n) => ({
            n,
            from: isFromMe(item) ? 'me' : 'them',
            who: whoOf(item).slice(0, 60),
            when: formatInZone(new Date(item.occurredAt * 1000), timeZone),
            ...(item.source === 'mail' && item.title ? { subject: item.title.slice(0, 150) } : {}),
            text: item.body.slice(0, 600),
        }));
        let judged: Awaited<ReturnType<typeof judgePromises>>;
        try {
            judged = await judgePromises({ items, today });
        } catch (error) {
            console.error('[FollowUps] Model call failed:', error);
            judged = null;
        }
        if (!judged) {
            // Nothing was learned: give the call back and try again next pass.
            await releaseFollowUpCall(userId, dayOf(now)).catch(() => {});
            break;
        }
        for (const promise of judged) {
            if (promise.confidence < MIN_CONFIDENCE) continue;
            const item = batch[promise.n]!;
            found.push(
                newFollowUp(userId, item, {
                    direction: promise.direction,
                    what: promise.what,
                    dueAt:
                        dueFromDate(promise.due, item.occurredAt, timeZone) ??
                        parseDue(item.body, item.occurredAt, timeZone),
                    confidence: promise.confidence,
                    madeBy: 'model',
                    sensitive: promise.sensitive,
                }),
            );
        }
        await markItemsScanned(userId, batch, now);
        done += batch.length;
    }
    return { found, calls, pending: todo.length - done };
}

/** Closes the person's open follow-ups the thread or calendar shows are done. */
async function autoClose(userId: string, items: OwnerItems, now: Date): Promise<number> {
    const open = (await findFollowUpsByUser(userId, ['open', 'snoozed'])).filter(
        (doc) => !doc.keepOpen,
    );
    if (open.length === 0) return 0;
    const needsCalendar = open.some(
        (doc) => doc.direction === 'you_promised' || doc.direction === 'owe_reply',
    );
    const events = needsCalendar
        ? await findDeviceItemsForGraph(userId, 'calendar', {
              from: nowSeconds(now) - WINDOW_DAYS * DAY,
              to: nowSeconds(now) + 120 * DAY,
              limit: 2_000,
              bodyChars: 0,
          })
        : [];
    let closed = 0;
    for (const doc of open) {
        const evidence = closingEvidence(doc, items.threads.get(doc.threadKey) ?? [], events);
        if (evidence && (await autoCloseFollowUp(doc._id, evidence, now))) closed++;
    }
    return closed;
}

/**
 * One pass for one person, over the messages and mail their pages share in notebooks
 * with a Follow-ups page (`slices`: those pages). Null when another pass holds the person.
 */
export async function runFollowUpPass(
    userId: string,
    slices: DataPageSlice[],
    now = new Date(),
): Promise<FollowUpPassResult | null> {
    if (!(await claimFollowUpPass(userId, now, LEASE_MS))) return null;
    try {
        const timeZone = (await collectorTimeZone(userId).catch(() => undefined)) ?? 'UTC';
        const items = await loadOwnerItems(userId, slices, now);
        const candidates = items.shared.filter(mayHoldPromise);
        const questions = questionFollowUps(userId, items, now, timeZone);
        const promises = followUpModelAvailable()
            ? await modelPromises(userId, candidates, now, timeZone)
            : { found: rulePromises(userId, candidates, timeZone), calls: 0, pending: 0 };
        const found = await insertFollowUps([...questions, ...promises.found], now);
        const closed = await autoClose(userId, items, now);
        await finishFollowUpPass(userId, now);
        return { found, closed, modelCalls: promises.calls, pending: promises.pending };
    } catch (error) {
        await releaseFollowUpPass(userId).catch(() => {});
        throw error;
    }
}

/** Each person's slices of messages and mail in notebooks that have a Follow-ups page. */
async function followUpSlicesByOwner(
    notebookIds?: string[],
): Promise<Map<string, DataPageSlice[]>> {
    const byOwner = new Map<string, DataPageSlice[]>();
    for (const notebookId of notebookIds ?? (await findFollowUpsNotebookIds())) {
        for (const slice of await notebookDataSlices(notebookId)) {
            if (slice.source !== 'imessage' && slice.source !== 'mail') continue;
            byOwner.set(slice.ownerId, [...(byOwner.get(slice.ownerId) ?? []), slice]);
        }
    }
    return byOwner;
}

// MARK: - Background job

let running = false;

/** Runs a pass for each person whose data a Follow-ups notebook shares, at most every 10 minutes. */
export async function followUpTick(now = new Date()): Promise<void> {
    if (running) return;
    running = true;
    try {
        await pruneFollowUpUsage(dayOf(new Date(now.getTime() - 7 * DAY * 1000))).catch(() => {});
        await pruneScannedItems(new Date(now.getTime() - 2 * WINDOW_DAYS * DAY * 1000)).catch(
            () => {},
        );
        for (const [userId, slices] of await followUpSlicesByOwner()) {
            try {
                const state = await findFollowUpState(userId);
                if (state?.lastRunAt && now.getTime() - state.lastRunAt.getTime() < PASS_GAP_MS)
                    continue;
                await runFollowUpPass(userId, slices, now);
            } catch (error) {
                console.error(`[FollowUps] Pass for ${userId} failed:`, error);
            }
        }
    } finally {
        running = false;
    }
}

export function startFollowUpScanning(intervalMs = 10 * 60 * 1000): () => void {
    const timer = setInterval(() => void followUpTick(), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

/** A Follow-ups page was added: scan what the notebook shares now, not in 10 minutes. */
export async function runFollowUpsForNotebook(notebookId: string, now = new Date()): Promise<void> {
    for (const [userId, slices] of await followUpSlicesByOwner([notebookId])) {
        // Their other Follow-ups notebooks count too: one pass covers them all.
        const all = (await followUpSlicesByOwner()).get(userId) ?? slices;
        await runFollowUpPass(userId, all, now).catch((error) =>
            console.error(`[FollowUps] Pass for ${userId} failed:`, error),
        );
    }
}

// MARK: - Reading

interface ReadContext {
    viewerId: string;
    /** The viewer's own data pages in the notebook, as the notebook shares them. */
    slices: DataPageSlice[];
    shared: boolean;
}

async function readContext(notebookId: string, viewerId: string): Promise<ReadContext> {
    const [slices, notebook] = await Promise.all([
        dataPageSlicesFor(viewerId, notebookId),
        findNotebookByIdUnsafe(notebookId).catch(() => null),
    ]);
    return {
        viewerId,
        // Each person sees only their own follow-ups, from their own pages.
        slices: slices.filter((slice) => slice.ownerId === viewerId),
        shared: isNotebookShared(notebook),
    };
}

/**
 * The follow-ups the notebook may show, as the API returns them: every evidence item
 * still shared by one of the viewer's pages there, and nothing private in a shared
 * notebook. Nothing is changed or deleted on read.
 */
async function visibleFollowUps(
    docs: FollowUpDocument[],
    context: ReadContext,
    now: Date,
): Promise<FollowUp[]> {
    if (context.slices.length === 0 || docs.length === 0) return [];
    const ids = [...new Set(docs.flatMap((doc) => doc.evidence.map((e) => e.itemId)))];
    const items = new Map(
        (await findDeviceItemsByIds(context.viewerId, ids, 2_000)).map((item) => [item.id, item]),
    );
    const out: FollowUp[] = [];
    for (const doc of docs) {
        if (doc.userId !== context.viewerId) continue;
        if (context.shared && (doc.sensitive || isPrivateMatter(doc.what))) continue;
        const evidence = doc.evidence.map((entry) => {
            const item = items.get(entry.itemId);
            const slice =
                item && context.slices.find((s) => s.source === item.source && s.match(item));
            return slice ? { ...entry, pageId: slice.pageId } : null;
        });
        if (evidence.some((entry) => !entry)) continue;
        // A snooze that has run out is open again.
        const wokeUp = doc.status === 'snoozed' && (doc.snoozedUntil ?? 0) <= nowSeconds(now);
        out.push({
            id: doc._id,
            direction: doc.direction,
            who: doc.who,
            what: doc.what,
            at: doc.at,
            ...(doc.dueAt !== undefined ? { dueAt: doc.dueAt } : {}),
            status: wokeUp ? 'open' : doc.status,
            ...(doc.status === 'snoozed' && !wokeUp && doc.snoozedUntil !== undefined
                ? { snoozedUntil: doc.snoozedUntil }
                : {}),
            confidence: doc.confidence,
            evidence: evidence.map((entry) => ({
                itemId: entry!.itemId,
                source: entry!.source,
                at: entry!.at,
                ...(entry!.title ? { title: entry!.title } : {}),
                pageId: entry!.pageId,
            })),
            madeBy: doc.madeBy,
            ...(doc.closed ? { closed: doc.closed } : {}),
        });
    }
    return out;
}

/** When it's due: the stated date, or for unanswered questions, when they were found. */
export function dueTime(followUp: Pick<FollowUp, 'dueAt' | 'at'>): number {
    return followUp.dueAt ?? followUp.at;
}

/** Overdue and due first, then by age. */
function byDue(a: FollowUp, b: FollowUp): number {
    return dueTime(a) - dueTime(b) || a.at - b.at;
}

/** The viewer's open and snoozed follow-ups in this notebook, due first. */
export async function listFollowUps(
    notebookId: string,
    viewerId: string,
    now = new Date(),
): Promise<FollowUp[]> {
    const context = await readContext(notebookId, viewerId);
    if (context.slices.length === 0) return [];
    const docs = await findFollowUpsByUser(viewerId, ['open', 'snoozed']);
    return (await visibleFollowUps(docs, context, now)).sort(byDue);
}

/** The Follow-ups page: the list, and how the scan is doing. */
export async function getFollowUpList(
    notebookId: string,
    viewerId: string,
    now = new Date(),
): Promise<FollowUpList> {
    const [followUps, state] = await Promise.all([
        listFollowUps(notebookId, viewerId, now),
        findFollowUpState(viewerId),
    ]);
    return {
        followUps,
        status: {
            ...(state?.lastRunAt ? { lastRunAt: state.lastRunAt.toISOString() } : {}),
            modelAvailable: followUpModelAvailable(),
        },
    };
}

/**
 * Open follow-ups due by the end of the next day or overdue, for the proactive brief
 * and triage. Same rules as the page: the person's own, through the notebook's pages,
 * nothing private in a shared notebook.
 */
export async function dueFollowUps(
    userId: string,
    notebookId: string,
    now = new Date(),
): Promise<FollowUp[]> {
    const horizon = nowSeconds(now) + DAY;
    return (await listFollowUps(notebookId, userId, now)).filter(
        (followUp) => followUp.status === 'open' && dueTime(followUp) <= horizon,
    );
}

// MARK: - Changing

export class FollowUpError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/**
 * Done, snooze, dismiss or reopen one of the person's follow-ups, as this notebook shows
 * it. Every change remembers what it was before; reopen undoes any of them, and a
 * reopened follow-up doesn't close by itself again.
 */
export async function changeFollowUp(
    notebookId: string,
    userId: string,
    id: string,
    action: FollowUpAction,
    options: { until?: number; by: { type: 'user' | 'bot'; id?: string } },
    now = new Date(),
): Promise<FollowUp> {
    const doc = await findFollowUp(userId, id);
    const context = await readContext(notebookId, userId);
    const visible = doc ? (await visibleFollowUps([doc], context, now))[0] : undefined;
    if (!doc || !visible) throw new FollowUpError('That follow-up is not in this notebook', 404);
    let updated: FollowUpDocument | null;
    switch (action) {
        case 'done':
            updated = await setFollowUpStatus(doc, { status: 'done', by: options.by }, now);
            break;
        case 'dismiss':
            updated = await setFollowUpStatus(doc, { status: 'dismissed', by: options.by }, now);
            break;
        case 'snooze': {
            const until = options.until ?? nowSeconds(now) + DAY;
            if (!Number.isFinite(until) || until <= nowSeconds(now))
                throw new FollowUpError('Snooze until a time in the future', 400);
            if (until > nowSeconds(now) + MAX_SNOOZE_DAYS * DAY)
                throw new FollowUpError(`Snooze for at most ${MAX_SNOOZE_DAYS} days`, 400);
            updated = await setFollowUpStatus(
                doc,
                { status: 'snoozed', snoozedUntil: Math.floor(until), by: options.by },
                now,
            );
            break;
        }
        case 'reopen':
            updated = await setFollowUpStatus(
                doc,
                { status: 'open', keepOpen: doc.status === 'done', by: options.by },
                now,
            );
            break;
    }
    const result = updated ? (await visibleFollowUps([updated], context, now))[0] : undefined;
    if (!result) throw new FollowUpError('That follow-up is not in this notebook', 404);
    return result;
}

// MARK: - Bots

/** What a bot's tools need: the person, their notebook, and that it has a Follow-ups page. */
export interface FollowUpToolContext {
    userId: string;
    notebookId: string;
    timeZone: string;
    botId?: string;
    /** The notebook has a Follow-ups page (the opt-in). */
    followUps?: boolean;
}

export function followUpToolDefinitions(ctx: FollowUpToolContext) {
    if (!ctx.followUps) return [];
    return [
        {
            name: 'list_follow_ups',
            description:
                'List the user\'s open follow-ups from their messages and mail: promises they made, promises made to them, questions they\'re waiting on, and questions they owe a reply to. Due and overdue first. Use for "what do I owe people?" or "who hasn\'t gotten back to me?".',
            parameters: {
                type: 'object',
                properties: {
                    owed_by: {
                        type: 'string',
                        enum: ['you', 'them'],
                        description:
                            '"you" for what the user owes, "them" for what is owed to the user.',
                    },
                    due_only: {
                        type: 'boolean',
                        description: 'Only ones due by tomorrow or overdue.',
                    },
                },
                additionalProperties: false,
            },
        },
        {
            name: 'update_follow_up',
            description:
                "Mark one of the user's follow-ups done, snooze it, or reopen it (undoing done or snooze), by the id list_follow_ups returned. Only when the user asks, or the data clearly shows it was done.",
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    action: { type: 'string', enum: ['done', 'snooze', 'reopen'] },
                    until: {
                        type: 'string',
                        description: 'For snooze: until when, ISO 8601. Defaults to one day.',
                    },
                },
                required: ['id', 'action'],
                additionalProperties: false,
            },
        },
    ];
}

const DIRECTION_LABEL: Record<FollowUp['direction'], string> = {
    you_promised: 'you promised',
    they_owe: 'they promised you',
    waiting_reply: 'waiting on their reply',
    owe_reply: 'you owe a reply',
};

/** Runs a follow-up tool; null when the name isn't one of these tools. */
export async function executeFollowUpTool(
    ctx: FollowUpToolContext,
    name: string,
    input: Record<string, unknown>,
    toEpoch: (value: unknown) => number | undefined,
): Promise<string | null> {
    if (name !== 'list_follow_ups' && name !== 'update_follow_up') return null;
    if (!ctx.followUps) return `Unknown tool: ${name}`;
    const when = (seconds: number) => formatInZone(new Date(seconds * 1000), ctx.timeZone);
    if (name === 'list_follow_ups') {
        const all =
            input.due_only === true
                ? await dueFollowUps(ctx.userId, ctx.notebookId)
                : await listFollowUps(ctx.notebookId, ctx.userId);
        const owedBy = input.owed_by === 'you' || input.owed_by === 'them' ? input.owed_by : null;
        const list = all
            .filter((f) => f.status === 'open')
            .filter(
                (f) =>
                    !owedBy ||
                    (owedBy === 'you') ===
                        (f.direction === 'you_promised' || f.direction === 'owe_reply'),
            )
            .slice(0, 30);
        return JSON.stringify({
            followUps: list.map((f) => ({
                id: f.id,
                kind: DIRECTION_LABEL[f.direction],
                who: f.who,
                what: f.what,
                said: when(f.at),
                ...(f.dueAt !== undefined ? { due: when(f.dueAt) } : {}),
                evidence: f.evidence.map((e) => e.itemId),
            })),
        });
    }
    const action = input.action;
    if (action !== 'done' && action !== 'snooze' && action !== 'reopen')
        return 'Choose done, snooze or reopen.';
    try {
        const updated = await changeFollowUp(
            ctx.notebookId,
            ctx.userId,
            String(input.id ?? ''),
            action,
            {
                ...(action === 'snooze' && input.until !== undefined
                    ? { until: toEpoch(input.until) ?? NaN }
                    : {}),
                by: { type: 'bot', ...(ctx.botId ? { id: ctx.botId } : {}) },
            },
        );
        if (action === 'done') return `Marked done: ${updated.what}. It can be reopened.`;
        if (action === 'snooze')
            return `Snoozed until ${when(updated.snoozedUntil ?? 0)}: ${updated.what}.`;
        return `Reopened: ${updated.what}.`;
    } catch (error) {
        return error instanceof FollowUpError ? error.message : 'Could not change that follow-up.';
    }
}
