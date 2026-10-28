import { describe, expect, it } from 'vitest';
import type { MacDataItem } from '@maple/shared';
import {
    askedQuestion,
    closingEvidence,
    directQuestion,
    isAutomated,
    isFromMe,
    mailSubjectKey,
    mayHoldPromise,
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
        expect(isFromMe(sent)).toBe(true);
        expect(isFromMe(reply)).toBe(false);
        expect(mailSubjectKey(reply.title)).toBe('quote for the deck');
        expect(threadKeyOf(sent)).toBe(threadKeyOf(reply));
        expect(whoOf(sent)).toBe('Pat Lee');
        expect(whoOf(reply)).toBe('Pat Lee');
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
                body: "Here you go, they're great",
                occurredAt: wednesday + DAY,
            });
            expect(closingEvidence(promise, [quick], [])).toBeNull();
            expect(closingEvidence(promise, [quick, later], [])?.itemId).toBe(later.id);
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
                participants: [],
                body: '',
                extra: { createdAt: new Date((wednesday + 2 * HOUR) * 1000).toISOString() },
            };
            const before = {
                ...event,
                id: 'calendar:old',
                extra: { createdAt: new Date((wednesday - DAY) * 1000).toISOString() },
            };
            expect(closingEvidence(promise, [], [before])).toBeNull();
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
            const mine = message({ isFromMe: true, body: 'Yes!', occurredAt: wednesday + DAY });
            expect(
                closingEvidence({ ...promise, direction: 'owe_reply' }, [mine], [])?.reason,
            ).toBe('reply');
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
                    text: "I'll get back to you",
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
    });
});
