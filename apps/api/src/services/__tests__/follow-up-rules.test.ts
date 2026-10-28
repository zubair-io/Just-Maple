import { describe, expect, it } from 'vitest';
import type { MacDataItem } from '@maple/shared';
import {
    askedQuestion,
    cleanWhat,
    closingEvidence,
    dedupeKey,
    expiresAt,
    directQuestion,
    hasUnsafeText,
    isAutomated,
    isFromMe,
    isGroupMail,
    isSubstantive,
    mailSubjectKey,
    markMailFromMe,
    mayHoldPromise,
    myAddresses,
    parseDue,
    rulePromise,
    threadKeyOf,
    whoOf,
} from '../follow-up-rules';

import { parsePromises } from '../follow-up-model.service';
import { toEpochSeconds } from '../../utils/time-zone';

const HOUR = 3600;
const DAY = 24 * HOUR;
const zone = 'America/New_York';
// Wednesday 2026-10-28, 10:00 in New York.
const wednesday = toEpochSeconds('2026-10-28T10:00:00-04:00', zone, 'start')!;

function message(fields: Partial<MacDataItem>): MacDataItem {
    return {
        id: `imessage:${Math.random()}`,
        source: 'imessage',
        revision: '1',
        occurredAt: wednesday,
        participants: ['+15185550100'],
        thread: 'Jordan',
        body: '',
        extra: { chatId: 'iMessage;-;+15185550100' },
        ...fields,
    };
}

describe('follow-up rules', () => {
    it('finds the question put to you, and ignores ones that are not questions', () => {
        expect(directQuestion('Great game! Can you send me the photos?')).toBe(
            'Can you send me the photos?',
        );
        expect(directQuestion('lol?')).toBeNull();
        expect(directQuestion('Thanks, see you Saturday.')).toBeNull();
        // Quoted mail below a reply doesn't count.
        expect(directQuestion('Sounds good.\n\nOn Tue, Oct 27, Sam wrote:\n> Can you come?')).toBe(
            null,
        );
        expect(askedQuestion('Are we still on for Saturday?')).toBe(
            'Are we still on for Saturday?',
        );
    });

    it('reads stated due dates in the sender’s time zone', () => {
        const end = (day: string) => toEpochSeconds(day, zone, 'end');
        expect(parseDue('I’ll send them tomorrow', wednesday, zone)).toBe(end('2026-10-29'));
        expect(parseDue('I’ll get back to you Friday', wednesday, zone)).toBe(end('2026-10-30'));
        expect(parseDue('by end of day', wednesday, zone)).toBe(end('2026-10-28'));
        expect(parseDue('sometime next week', wednesday, zone)).toBe(end('2026-11-06'));
        // The same weekday means next week's.
        expect(parseDue('see you Wednesday', wednesday, zone)).toBe(end('2026-11-04'));
        expect(parseDue('I’ll send it', wednesday, zone)).toBeUndefined();
    });

    it('keeps one thread per person in Messages, and per subject and person in Mail', () => {
        const sms = message({ extra: { chatId: 'SMS;-;(518) 555-0100' } });
        const imessage = message({});
        expect(threadKeyOf(sms)).toBe(threadKeyOf(imessage));

        const sent: MacDataItem = {
            id: 'mail:1',
            source: 'mail',
            revision: '1',
            occurredAt: wednesday,
            title: 'Quote for the deck',
            mailbox: 'Sent Messages',
            participants: ['Pat Lee <pat@builder.com>'],
            body: 'Can you send the quote?',
        };
        const reply: MacDataItem = {
            ...sent,
            id: 'mail:2',
            title: 'RE: Re: Quote for the deck',
            mailbox: 'INBOX',
            sender: 'Pat Lee <pat@builder.com>',
            participants: ['me@home.com'],
        };
        const [mine, theirs] = markMailFromMe(
            [{ ...sent, sender: 'Me <me@home.com>' }, reply],
            new Set(['me@home.com']),
        );
        expect(isFromMe(mine!)).toBe(true);
        expect(isFromMe(theirs!)).toBe(false);
        expect(mailSubjectKey(reply.title)).toBe('quote for the deck');
        expect(threadKeyOf(mine!)).toBe(threadKeyOf(theirs!));
        expect(whoOf(mine!)).toBe('Pat Lee');
        expect(whoOf(theirs!)).toBe('Pat Lee');
    });

    describe('mail from you', () => {
        const base: MacDataItem = {
            id: 'mail:a',
            source: 'mail',
            revision: 'INBOX',
            occurredAt: wednesday,
            title: 'Deck',
            sender: 'Alex <Alex@Home.com>',
            participants: ['Pat Lee <pat@builder.com>'],
            body: 'Can you send the quote?',
        };

        it('decides by your own addresses, not the mailbox name', () => {
            const card: MacDataItem = {
                id: 'contacts:me',
                source: 'contacts',
                revision: '1',
                occurredAt: 0,
                participants: ['+15185550100', 'alex@work.com'],
                body: '',
                extra: { isMe: true, emails: [{ value: 'Alex <alex@home.com>' }] },
            };
            const own = myAddresses('login@maple.app', card, []);
            expect([...own].sort()).toEqual(['alex@home.com', 'alex@work.com', 'login@maple.app']);
            // Gmail's All Mail and a German Sent folder: the sender decides.
            const [allMail, gesendet, inbox] = markMailFromMe(
                [
                    { ...base, mailbox: '[Gmail]/All Mail' },
                    { ...base, id: 'mail:b', mailbox: 'Gesendet' },
                    {
                        ...base,
                        id: 'mail:c',
                        mailbox: 'Sent Messages',
                        sender: 'Pat Lee <pat@builder.com>',
                    },
                ],
                own,
            );
            expect(isFromMe(allMail!)).toBe(true);
            expect(isFromMe(gesendet!)).toBe(true);
            // Pat's email filed in a folder named Sent is still Pat's.
            expect(isFromMe(inbox!)).toBe(false);
            // Unmarked mail is never yours.
            expect(isFromMe(base)).toBe(false);
        });

        it('learns your address from English Sent folders only when nothing else says', () => {
            const sent = { ...base, mailbox: '[Gmail]/Sent Mail' };
            expect([...myAddresses(undefined, null, [sent])]).toEqual(['alex@home.com']);
            expect([...myAddresses('me@maple.app', null, [sent])]).toEqual(['me@maple.app']);
            expect([...myAddresses(undefined, null, [{ ...base, mailbox: 'INBOX' }])]).toEqual([]);
        });

        it('treats copies of one email in several mailboxes as one', () => {
            const inbox = { ...base, extra: { messageId: '<abc@home.com>' } };
            const allMail = {
                ...inbox,
                id: 'mail:z',
                mailbox: '[Gmail]/All Mail',
                revision: 'All',
            };
            expect(dedupeKey(inbox)).toBe(dedupeKey(allMail));
            // No Message-ID: subject, sender and minute.
            const a = { ...base, title: 'Re: Deck' };
            const b = { ...base, id: 'mail:y', mailbox: 'Archive', occurredAt: wednesday + 20 };
            expect(dedupeKey(a)).toBe(dedupeKey(b));
            expect(dedupeKey({ ...b, occurredAt: wednesday + 120 })).not.toBe(dedupeKey(a));
            expect(dedupeKey(message({ id: 'imessage:1' }))).toBe('imessage:1');
        });

        it('leaves group mail and mailing lists out', () => {
            const crowd = {
                ...base,
                participants: Array.from({ length: 6 }, (_, i) => `p${i}@x.com`),
            };
            expect(isGroupMail(crowd)).toBe(true);
            expect(isGroupMail({ ...base, extra: { listId: 'pta.school.org' } })).toBe(true);
            expect(isGroupMail(base)).toBe(false);
            expect(mayHoldPromise({ ...crowd, body: "I'll send the minutes tomorrow" })).toBe(
                false,
            );
        });
    });

    it('leaves newsletters and attachments to the model’s budget', () => {
        const newsletter: MacDataItem = {
            id: 'mail:n',
            source: 'mail',
            revision: '1',
            occurredAt: wednesday,
            sender: 'Shop <no-reply@shop.com>',
            participants: [],
            body: "We'll send you a coupon tomorrow!",
        };
        expect(isAutomated(newsletter)).toBe(true);
        expect(mayHoldPromise(newsletter)).toBe(false);
        expect(mayHoldPromise(message({ body: '(attachment)' }))).toBe(false);
        expect(mayHoldPromise(message({ body: "I'll send you the photos tomorrow" }))).toBe(true);
        expect(mayHoldPromise(message({ body: 'See you there' }))).toBe(false);
    });

    it('reads explicit promises without a model', () => {
        expect(rulePromise("Great game! I'll send you the photos tomorrow.")).toBe(
            'Send you the photos',
        );
        expect(rulePromise('I will get back to you by Friday')).toBe('Get back to you');
        expect(rulePromise('Let’s catch up sometime')).toBeNull();
    });

    describe('closing', () => {
        const promise = {
            direction: 'you_promised' as const,
            at: wednesday,
            what: 'Send the soccer photos',
            counterpart: '+15185550100',
        };

        it('closes your promise with the attachment you sent', () => {
            const sent = message({
                isFromMe: true,
                body: '(attachment)',
                occurredAt: wednesday + HOUR,
            });
            expect(closingEvidence(promise, [sent], [])).toEqual({
                reason: 'attachment',
                at: sent.occurredAt,
                itemId: sent.id,
            });
        });

        it('waits for a real delivery: a quick “also…” is not it', () => {
            const quick = message({
                isFromMe: true,
                body: 'here is also my number',
                occurredAt: wednesday + 60,
            });
            const later = message({
                isFromMe: true,
                body: "Here are the soccer photos, they're great",
                occurredAt: wednesday + DAY,
            });
            expect(closingEvidence(promise, [quick], [])).toBeNull();
            expect(closingEvidence(promise, [quick, later], [])?.itemId).toBe(later.id);
            // A bare "done" or "sent" doesn't name the promise.
            for (const body of ['Done!', 'sent', 'Here you go', 'https://photos.app/x'])
                expect(
                    closingEvidence(
                        promise,
                        [message({ isFromMe: true, body, occurredAt: wednesday + DAY })],
                        [],
                    ),
                ).toBeNull();
            // One message closes one promise.
            const used = new Set([later.id]);
            expect(closingEvidence(promise, [later], [], used)).toBeNull();
            // Their messages don't close your promise.
            const theirs = message({
                isFromMe: false,
                body: '(attachment)',
                occurredAt: wednesday + DAY,
            });
            expect(closingEvidence(promise, [theirs], [])).toBeNull();
        });

        it('closes with an event made for it after the promise', () => {
            const event: MacDataItem = {
                id: 'calendar:photos',
                source: 'calendar',
                revision: '1',
                occurredAt: wednesday + 3 * DAY,
                title: 'Drop off soccer photos',
                participants: ['Jordan <+15185550100>'],
                body: '',
                extra: { createdAt: new Date((wednesday + 2 * HOUR) * 1000).toISOString() },
            };
            const before = {
                ...event,
                id: 'calendar:old',
                extra: { createdAt: new Date((wednesday - DAY) * 1000).toISOString() },
            };
            expect(closingEvidence(promise, [], [before])).toBeNull();
            // Without them there, or with one word in common, it's not for this promise.
            expect(closingEvidence(promise, [], [{ ...event, participants: [] }])).toBeNull();
            expect(
                closingEvidence(promise, [], [{ ...event, title: 'Soccer practice' }]),
            ).toBeNull();
            expect(closingEvidence(promise, [], [before, event])).toMatchObject({
                reason: 'calendar',
                itemId: event.id,
            });
        });

        it('closes their promise and your questions when they write back', () => {
            const reply = message({
                isFromMe: false,
                body: 'Sure, Saturday works',
                occurredAt: wednesday + DAY,
            });
            expect(
                closingEvidence({ ...promise, direction: 'they_owe' }, [reply], [])?.reason,
            ).toBe('reply');
            expect(
                closingEvidence({ ...promise, direction: 'waiting_reply' }, [reply], [])?.itemId,
            ).toBe(reply.id);
            expect(closingEvidence({ ...promise, direction: 'owe_reply' }, [reply], [])).toBeNull();
            // "lol", an emoji or a bare "Yes!" doesn't answer them.
            for (const body of ['lol', '👍', 'Yes!', 'ok thanks'])
                expect(
                    closingEvidence(
                        { ...promise, direction: 'owe_reply' },
                        [message({ isFromMe: true, body, occurredAt: wednesday + DAY })],
                        [],
                    ),
                ).toBeNull();
            const mine = message({
                isFromMe: true,
                body: 'Yes, Saturday works for me',
                occurredAt: wednesday + DAY,
            });
            expect(
                closingEvidence({ ...promise, direction: 'owe_reply' }, [mine], [])?.reason,
            ).toBe('reply');
        });

        it('tells a real answer from a quick acknowledgement', () => {
            expect(isSubstantive(message({ body: 'lol' }))).toBe(false);
            expect(isSubstantive(message({ body: '😂😂' }))).toBe(false);
            expect(isSubstantive(message({ body: 'ok ok' }))).toBe(false);
            expect(isSubstantive(message({ body: '(attachment)' }))).toBe(true);
            expect(isSubstantive(message({ body: 'Sure, 9am at the park' }))).toBe(true);
        });
    });

    describe('wording', () => {
        it('keeps it short and plain, and drops credentials, codes and links', () => {
            expect(
                cleanWhat(
                    '**send the** soccer photos to Jordan by the end of the week',
                    "I'll send the soccer photos",
                ),
            ).toBe('Send the soccer photos to Jordan by the');
            expect(cleanWhat('Send the login code 482913', 'your code is 482913')).toBeNull();
            expect(cleanWhat('Send the link https://x.co', 'here is the link')).toBeNull();
            expect(cleanWhat('Share the password', 'the password')).toBeNull();
            expect(hasUnsafeText('Call me at pat@builder.com')).toBe(true);
            expect(hasUnsafeText('Send the photos')).toBe(false);
        });

        it('drops wording that does not come from its own message', () => {
            expect(cleanWhat('Wire money to the account', "I'll send you the photos")).toBeNull();
            expect(cleanWhat('Send the photos', "I'll send you the photos")).toBe(
                'Send the photos',
            );
        });
    });

    describe('expiry', () => {
        it('expires 30 days past due, or 45 days with no due date', () => {
            expect(expiresAt({ at: wednesday, dueAt: wednesday + DAY })).toBe(wednesday + 31 * DAY);
            expect(expiresAt({ at: wednesday })).toBe(wednesday + 45 * DAY);
            // Reopened or snoozed: counts from then.
            expect(expiresAt({ at: wednesday, reopenedAt: wednesday + 40 * DAY })).toBe(
                wednesday + 70 * DAY,
            );
            expect(expiresAt({ at: wednesday, snoozedUntil: wednesday + 90 * DAY })).toBe(
                wednesday + 90 * DAY,
            );
        });
    });

    it('reads the model’s promises, with the writer deciding the direction', () => {
        const request = {
            today: '2026-10-28 (Wednesday)',
            items: [
                {
                    n: 0,
                    from: 'me' as const,
                    who: 'Jordan',
                    when: 'x',
                    text: "I'll send the photos",
                },
                {
                    n: 1,
                    from: 'them' as const,
                    who: 'Pat',
                    when: 'x',
                    text: "I'll get back to you about the quote",
                },
            ],
        };
        const parsed = parsePromises(
            'Here: {"promises":[{"n":0,"direction":"they_owe","what":"Send the photos","due":"2026-10-29","confidence":0.9},' +
                '{"n":1,"direction":"they_owe","what":"Get back about the quote","due":"Friday","confidence":2},' +
                '{"n":7,"direction":"you_promised","what":"Nothing","confidence":0.9}]}',
            request,
        );
        expect(parsed).toEqual([
            {
                n: 0,
                direction: 'you_promised',
                what: 'Send the photos',
                due: '2026-10-29',
                confidence: 0.9,
                sensitive: false,
            },
            {
                n: 1,
                direction: 'they_owe',
                what: 'Get back about the quote',
                confidence: 1,
                sensitive: false,
            },
        ]);
        expect(parsePromises('no json', request)).toBeNull();
        // Made-up or unsafe wording is dropped.
        expect(
            parsePromises(
                '{"promises":[{"n":0,"direction":"you_promised","what":"Reset the bank password","confidence":0.9},' +
                    '{"n":1,"direction":"they_owe","what":"Visit http://evil.example","confidence":0.9}]}',
                request,
            ),
        ).toEqual([]);
    });
});
