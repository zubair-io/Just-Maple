import { deviceItemThreadKey, type FollowUpCloseReason, type MacDataItem } from '@maple/shared';
import { formatInZone, toEpochSeconds } from '../utils/time-zone';

/**
 * The deterministic half of Follow-ups: threads, who wrote what, questions left
 * unanswered, stated due dates, and the evidence that closes a follow-up. No model, no
 * database: everything here is a pure function of the items.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A reply this soon after a promise is still the same breath ("also, …"), not the delivery. */
const DELIVERY_GAP_SECONDS = 30 * MINUTE;
/** They answered: any message from them at least this long after their promise. */
const THEIR_REPLY_GAP_SECONDS = 10 * MINUTE;

// MARK: - Who wrote it

/** English Sent folders: only a hint for learning the person's addresses, never the answer. */
const SENT_MAILBOX = /^(\[gmail\]\/)?(sent|sent messages|sent items|sent mail)$/i;

/**
 * Who wrote it. Messages say so; mail doesn't, so the service marks each email by
 * comparing its sender with the person's own addresses (`markMailFromMe`) first. An
 * unmarked email counts as someone else's.
 */
export function isFromMe(item: MacDataItem): boolean {
    return item.isFromMe === true;
}

/**
 * The person's own email addresses: their account email and their "me" contact card,
 * which are reliable, plus senders in English Sent folders only when those give nothing.
 */
export function myAddresses(
    accountEmail: string | undefined,
    card: MacDataItem | null,
    mail: MacDataItem[],
): Set<string> {
    const own = new Set<string>();
    const add = (value: unknown) => {
        const address = typeof value === 'string' ? addressOf(value) : undefined;
        if (address?.includes('@')) own.add(address);
    };
    add(accountEmail);
    for (const value of card?.participants ?? []) add(value);
    const emails = card?.extra?.emails;
    if (Array.isArray(emails))
        for (const entry of emails) add((entry as { value?: unknown } | null)?.value);
    if (own.size === 0)
        for (const item of mail) if (SENT_MAILBOX.test(item.mailbox ?? '')) add(item.sender);
    return own;
}

/** Marks who wrote each email: the person, when the sender is one of their addresses. */
export function markMailFromMe(items: MacDataItem[], own: Set<string>): MacDataItem[] {
    return items.map((item) =>
        item.source === 'mail'
            ? { ...item, isFromMe: own.has(addressOf(item.sender) ?? '') }
            : item,
    );
}

/**
 * One key per message: an email copied into several mailboxes (Inbox and All Mail) is
 * one email, by its Message-ID when collected, else by subject, sender and minute.
 */
export function dedupeKey(item: MacDataItem): string {
    if (item.source !== 'mail') return item.id;
    const id = item.extra?.messageId;
    if (typeof id === 'string' && id) return `mail:${id}`;
    return `mail:${mailSubjectKey(item.title)}|${addressOf(item.sender) ?? ''}|${Math.floor(item.occurredAt / 60)}`;
}

export function addressOf(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const angled = /<([^>]+)>/.exec(value);
    return (angled?.[1] ?? value).trim().toLowerCase() || undefined;
}

function nameOf(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const name = value
        .replace(/<[^>]+>/, '')
        .replace(/"/g, '')
        .trim();
    return name || value.trim() || undefined;
}

/** The other person's handle or address, lowercased. */
export function counterpartOf(item: MacDataItem): string | undefined {
    if (isFromMe(item))
        return item.source === 'mail'
            ? addressOf(item.participants[0])
            : (item.participants[0] ?? item.thread)?.trim().toLowerCase();
    return addressOf(item.sender);
}

/** The other person, as the page shows them. */
export function whoOf(item: MacDataItem): string {
    if (item.source === 'imessage') {
        if (!isFromMe(item)) return nameOf(item.sender) ?? item.thread ?? 'Someone';
        return item.thread?.trim() || nameOf(item.participants[0]) || 'Someone';
    }
    if (isFromMe(item)) return nameOf(item.participants[0]) ?? 'Someone';
    return nameOf(item.sender) ?? 'Someone';
}

/** "Re: Re: Fwd: Photos" → "photos". */
export function mailSubjectKey(subject: string | undefined): string {
    let text = (subject ?? '').trim();
    for (;;) {
        const next = text.replace(/^(re|fwd?|aw|sv|wg)\s*(\[\d+\])?\s*:\s*/i, '');
        if (next === text) break;
        text = next;
    }
    return text.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Where a reply would land. A person's iMessage, SMS and RCS chats are one thread; an
 * email thread is its subject with the other person.
 */
export function threadKeyOf(item: MacDataItem): string | undefined {
    if (item.source === 'imessage') return deviceItemThreadKey(item);
    if (item.source !== 'mail') return undefined;
    const counterpart = counterpartOf(item);
    return counterpart ? `mail:${mailSubjectKey(item.title)}|${counterpart}` : undefined;
}

/** A group chat: questions there aren't necessarily for the person. */
export function isGroupChat(item: MacDataItem): boolean {
    return item.source === 'imessage' && item.participants.length > 1;
}

/** More recipients than this (to and cc) is a group email or a list. */
export const MAX_MAIL_RECIPIENTS = 5;

/** Mail to a crowd, or from a mailing list: nothing in it is owed to one person. */
export function isGroupMail(item: MacDataItem): boolean {
    if (item.source !== 'mail') return false;
    if (item.participants.length > MAX_MAIL_RECIPIENTS) return true;
    const extra = item.extra ?? {};
    return !!(extra.listId || extra.listUnsubscribe || extra.mailingList);
}

const AUTOMATED_SENDER =
    /\b(no-?reply|do-?not-?reply|donotreply|notifications?|newsletters?|mailer-daemon|marketing|updates|alerts?|news|info|support|billing|receipts?|orders?|hello|team)@/i;

/** Newsletters, receipts and notifications: nobody owes them anything. */
export function isAutomated(item: MacDataItem): boolean {
    if (item.source !== 'mail' || isFromMe(item)) return false;
    return AUTOMATED_SENDER.test(item.sender ?? '') || /\bunsubscribe\b/i.test(item.body);
}

export function isAttachment(item: MacDataItem): boolean {
    if (item.source === 'imessage') return item.body.trim() === '(attachment)';
    return /\b(attached|attachments?|enclosed)\b/i.test(`${item.title ?? ''} ${item.body}`);
}

// MARK: - Questions

const QUESTION_START =
    /^(can|could|would|will|do|did|does|are|is|was|were|have|has|should|shall|what|when|where|which|who|whom|whose|why|how|any chance|is there|are there)\b/i;
const ADDRESSED = /\b(you|your|u|ya)\b/i;

/** The text's questions, newest last. Quoted mail below the reply is left out. */
function questionsIn(text: string): string[] {
    const own = text.split(/\n\s*(>|on .{5,80} wrote:|-----original message-----)/i)[0] ?? '';
    return (own.match(/[^.!?\n]*\?/g) ?? [])
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 8);
}

/**
 * The question someone asked the person directly ("Can you send the form?"), or null.
 * It has to be put to them: about "you", or a real question word, not just a "?".
 */
export function directQuestion(text: string): string | null {
    const questions = questionsIn(text).filter((q) => ADDRESSED.test(q) || QUESTION_START.test(q));
    return questions.at(-1) ?? null;
}

/** A question the person asked ("Are we still on for Saturday?"), or null. */
export function askedQuestion(text: string): string | null {
    const questions = questionsIn(text).filter(
        (q) => QUESTION_START.test(q) || ADDRESSED.test(q) || q.split(/\s+/).length >= 3,
    );
    return questions.at(-1) ?? null;
}

// MARK: - Promises

const PROMISE_WORDS =
    /\b(i'll|i will|i'm going to|im going to|i am going to|i'm gonna|let me|we'll|we will|will send|will get back|get back to you|let you know|i can send|i'll have|i owe you|follow up|circle back)\b/i;

/** Worth the model's look: someone may have promised something. Cheap, and errs on yes. */
export function mayHoldPromise(item: MacDataItem): boolean {
    if (item.source !== 'imessage' && item.source !== 'mail') return false;
    if (isAttachment(item) && item.source === 'imessage') return false;
    if (isAutomated(item) || isGroupMail(item)) return false;
    return PROMISE_WORDS.test(`${item.title ?? ''}\n${item.body.slice(0, 2_000)}`);
}

const PROMISE =
    /\b(?:i'll|i will|i'm going to|i am going to|let me)\s+((?:send|get back to|call|email|text|check|look into|forward|share|pay|book|follow up|reply|confirm|drop off|bring)\b[^.!?\n]{0,60})/i;

/** Without a model: an explicit "I'll send…" promise, and what it is. */
export function rulePromise(text: string): string | null {
    const match = PROMISE.exec(text);
    if (!match) return null;
    const words = match[1]!
        .replace(/\b(tomorrow|tonight|today|later|soon|asap)\b.*$/i, '')
        .replace(/\bby\s+\w+day\b.*$/i, '')
        .trim()
        .split(/\s+/)
        .slice(0, 8)
        .join(' ');
    if (!words) return null;
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// MARK: - Wording

/** Links, addresses, codes and credentials never go in a follow-up's wording. */
const UNSAFE_TEXT =
    /(https?:|www\.|\S+@\S+|\d{4,}|\b(password|passcode|passwords|pin|otp|code|codes|verification|verify|login|log in|sign in|token|ssn|social security|account number|routing number|card number|cvv|iban)\b)/i;

export function hasUnsafeText(text: string): boolean {
    return UNSAFE_TEXT.test(text);
}

/** Words that carry meaning, for checking that wording fits its message. */
function contentWords(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
    );
}

/**
 * A model's wording, short and plain, or null when it can't be used: it mentions links,
 * codes or credentials, or shares no meaningful word with the message it's about (so it
 * wasn't read from that message).
 */
export function cleanWhat(what: string, itemText: string): string | null {
    const plain = what
        .replace(/[`*_#>\[\]{}<>"“”]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 8)
        .join(' ')
        .slice(0, 60)
        .trim();
    if (!plain || hasUnsafeText(plain)) return null;
    const source = contentWords(itemText);
    const words = [...contentWords(plain)];
    if (words.length === 0 || !words.some((word) => source.has(word))) return null;
    return plain.charAt(0).toUpperCase() + plain.slice(1);
}

// MARK: - Due dates

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function addDays(day: string, days: number): string {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * A due date the text states ("tomorrow", "by Friday", "end of the week"), counted from
 * when it was sent, as the end of that day in the person's time zone. Undefined when it
 * names none.
 */
export function parseDue(text: string, sentAt: number, timeZone: string): number | undefined {
    const day = formatInZone(new Date(sentAt * 1000), timeZone).slice(0, 10);
    const lower = text.toLowerCase();
    let target: string | undefined;
    if (/\b(today|tonight|this evening|end of (the )?day|eod)\b/.test(lower)) target = day;
    else if (/\btomorrow\b/.test(lower)) target = addDays(day, 1);
    else if (/\b(end of (the )?week|eow)\b/.test(lower))
        target = addDays(day, (5 - weekdayOf(day) + 7) % 7); // Friday
    else if (/\bthis weekend\b/.test(lower))
        target = addDays(day, (7 - weekdayOf(day)) % 7); // Sunday
    else if (/\bnext week\b/.test(lower))
        target = addDays(day, ((8 - weekdayOf(day)) % 7 || 7) + 4);
    else {
        const named =
            /\b(?:by|on|this|next|until|before)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(
                lower,
            );
        if (named) {
            const wanted = WEEKDAYS.indexOf(named[1]!);
            target = addDays(day, (wanted - weekdayOf(day) + 7) % 7 || 7);
        }
    }
    return target ? toEpochSeconds(target, timeZone, 'end') : undefined;
}

/** A model's YYYY-MM-DD, as the end of that day; ignored when it's before the message. */
export function dueFromDate(
    date: string | undefined,
    sentAt: number,
    timeZone: string,
): number | undefined {
    const due = date ? toEpochSeconds(date, timeZone, 'end') : undefined;
    return due !== undefined && due >= sentAt ? due : undefined;
}

// MARK: - Closing

export interface ClosingFollowUp {
    direction: 'you_promised' | 'they_owe' | 'waiting_reply' | 'owe_reply';
    at: number;
    what: string;
    who?: string;
    counterpart?: string;
}

/** A promise to send something: the attachment you send later delivers it. */
const SENDING =
    /\b(send|share|forward|email|text|attach|upload|photos?|pictures?|pics|videos?|files?|docs?|documents?|forms?|slides|list|link|invoice|receipt|quote)\b/i;
/** Words that say "this is the thing I promised". */
const DELIVERY_CUE =
    /\b(here('s| is| are| you go| it is)|attached|as promised|(just )?(sent|sending|emailed|texted) (you|it|them|over))\b/i;
const ACKS = new Set(
    'ok okay k kk lol lmao haha hahaha ha yes yep yeah no nope sure thanks thank thx ty cool nice great'.split(
        ' ',
    ),
);
const STOP_WORDS = new Set(
    [
        'the a an and for with your you about back from that this then them they their there',
        'send call book check get make take have pick could would should will what when where',
        'which there here just know thanks please today tomorrow week next can are was were did',
        'monday tuesday wednesday thursday friday saturday sunday',
    ]
        .join(' ')
        .split(' '),
);

function keywords(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
    );
}

function overlap(a: Set<string>, b: Set<string>): number {
    return [...a].filter((word) => b.has(word)).length;
}

/**
 * A real answer: an attachment, or words beyond "lol", "ok" or an emoji. Very short
 * replies ("Yes!") don't count as answering.
 */
export function isSubstantive(item: MacDataItem): boolean {
    if (isAttachment(item)) return true;
    const words = item.body
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length < 2) return false;
    return words.some((word) => !ACKS.has(word));
}

/**
 * An event made after the follow-up, with the other person among its attendees and at
 * least two meaningful title words in common with what's owed.
 */
function calendarFor(followUp: ClosingFollowUp, events: MacDataItem[]): MacDataItem | undefined {
    const wanted = keywords(followUp.what);
    const people = [followUp.counterpart, followUp.who]
        .filter((value): value is string => !!value && value.length >= 3)
        .map((value) => value.toLowerCase());
    if (people.length === 0 || wanted.size < 2) return undefined;
    return events.find((event) => {
        const created = Date.parse(String(event.extra?.createdAt ?? '')) / 1000;
        if (!Number.isFinite(created) || created <= followUp.at) return false;
        const attends = event.participants.some((person) =>
            people.some((who) => person.toLowerCase().includes(who)),
        );
        return attends && overlap(wanted, keywords(event.title ?? '')) >= 2;
    });
}

/**
 * Your later message delivers the promise: the attachment for a promise to send
 * something, or "here are the photos" naming what was promised. Not a bare "done".
 */
function delivers(followUp: ClosingFollowUp, item: MacDataItem): 'attachment' | 'reply' | null {
    if (item.occurredAt - followUp.at < DELIVERY_GAP_SECONDS) return null;
    if (isAttachment(item)) return SENDING.test(followUp.what) ? 'attachment' : null;
    const wanted = keywords(followUp.what);
    if (wanted.size === 0 || !DELIVERY_CUE.test(item.body)) return null;
    return overlap(wanted, keywords(item.body)) >= Math.min(2, wanted.size) ? 'reply' : null;
}

/**
 * What closes the follow-up, from the thread's later messages and the person's calendar,
 * or null while it's still open. `used` holds messages that already closed one: a
 * message closes one promise.
 * - your promise: a later message of yours that delivers it, or an event made for it;
 * - theirs: a later message from them;
 * - waiting on their reply: any message from them;
 * - owing a reply: a real answer from you (not "lol"), or an event made for it.
 */
export function closingEvidence(
    followUp: ClosingFollowUp,
    thread: MacDataItem[],
    events: MacDataItem[],
    used: Set<string> = new Set(),
): { reason: FollowUpCloseReason; at: number; itemId: string } | null {
    const later = thread
        .filter((item) => item.occurredAt > followUp.at && !used.has(item.id))
        .sort((a, b) => a.occurredAt - b.occurredAt);
    const close = (reason: FollowUpCloseReason, item: MacDataItem) => ({
        reason,
        at: item.occurredAt,
        itemId: item.id,
    });
    const event = (): ReturnType<typeof closingEvidence> => {
        const found = calendarFor(
            followUp,
            events.filter((e) => !used.has(e.id)),
        );
        if (!found) return null;
        const created = Date.parse(String(found.extra?.createdAt)) / 1000;
        return { reason: 'calendar', at: Math.floor(created), itemId: found.id };
    };
    switch (followUp.direction) {
        case 'you_promised': {
            for (const item of later.filter(isFromMe)) {
                const reason = delivers(followUp, item);
                if (reason) return close(reason, item);
            }
            return event();
        }
        case 'they_owe': {
            const reply = later.find(
                (item) =>
                    !isFromMe(item) && item.occurredAt - followUp.at >= THEIR_REPLY_GAP_SECONDS,
            );
            if (!reply) return null;
            return close(isAttachment(reply) ? 'attachment' : 'reply', reply);
        }
        case 'waiting_reply': {
            const reply = later.find((item) => !isFromMe(item));
            return reply ? close('reply', reply) : null;
        }
        case 'owe_reply': {
            const reply = later.find((item) => isFromMe(item) && isSubstantive(item));
            return reply ? close('reply', reply) : event();
        }
    }
}

// MARK: - Expiry

/** Open follow-ups expire this long past their due date… */
export const EXPIRE_PAST_DUE_DAYS = 30;
/** …or this long after they were said, with no due date. */
export const EXPIRE_NO_DUE_DAYS = 45;

/**
 * When an open follow-up expires (seconds): 30 days past due, or 45 days after it was
 * said; counted again from a reopen, and never before a snooze ends.
 */
export function expiresAt(doc: {
    at: number;
    dueAt?: number;
    reopenedAt?: number;
    snoozedUntil?: number;
}): number {
    const base =
        doc.dueAt !== undefined
            ? doc.dueAt + EXPIRE_PAST_DUE_DAYS * DAY
            : doc.at + EXPIRE_NO_DUE_DAYS * DAY;
    return Math.max(
        base,
        doc.reopenedAt !== undefined ? doc.reopenedAt + EXPIRE_PAST_DUE_DAYS * DAY : 0,
        doc.snoozedUntil ?? 0,
    );
}

export { DAY, HOUR };
