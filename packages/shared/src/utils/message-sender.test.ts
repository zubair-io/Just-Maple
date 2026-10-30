import { describe, expect, it } from 'vitest';
import {
    contactIdentityIndex,
    normalizePersonHandle,
    resolveMessageSender,
    withMessageSenderNames,
} from './message-sender';
import type { MacDataItem } from '../schemas/mac-data';
const item = (overrides: Partial<MacDataItem> = {}): MacDataItem => ({
    id: 'imessage:1',
    source: 'imessage',
    revision: '1',
    occurredAt: 1,
    participants: [],
    body: 'Hello',
    ...overrides,
});
const alice = item({
    id: 'contacts:alice',
    source: 'contacts',
    title: 'Alice Green',
    extra: { phones: [{ value: '(518) 555-0123' }], emails: [{ value: 'Alice@Example.com' }] },
});
const bob = item({
    id: 'contacts:bob',
    source: 'contacts',
    title: 'Bob Brown',
    extra: { phones: [{ value: '+15185550456' }] },
});
describe('message sender contact identity', () => {
    it('matches normalized phones and email addresses without merging unrelated country codes or names', () => {
        expect(normalizePersonHandle('Alice <ALICE@EXAMPLE.COM>')).toBe('alice@example.com');
        expect(normalizePersonHandle('(518) 555-0123')).toBe('+15185550123');
        expect(normalizePersonHandle('+44 20 7946 0958')).not.toBe(
            normalizePersonHandle('+1 207 946 0958'),
        );
        expect(normalizePersonHandle('Room 12345678')).toBeNull();
        const index = contactIdentityIndex([alice]);
        expect(resolveMessageSender(item({ sender: '+15185550123' }), index)).toMatchObject({
            name: 'Alice Green',
            contactId: alice.id,
        });
        expect(
            resolveMessageSender(
                item({ source: 'mail', sender: 'Old Name <alice@example.com>' }),
                index,
            ),
        ).toMatchObject({ name: 'Alice Green', contactId: alice.id });
    });
    it('uses the actual group author, never the first participant', () => {
        const index = contactIdentityIndex([alice, bob]);
        expect(
            resolveMessageSender(
                item({
                    sender: 'Alice',
                    participants: ['+15185550456', '+15185550123'],
                    extra: { senderHandle: '+15185550123' },
                }),
                index,
            ),
        ).toMatchObject({ name: 'Alice Green', contactId: alice.id });
        expect(
            resolveMessageSender(
                item({ sender: 'Unknown', participants: ['+15185550456', '+15185550123'] }),
                index,
            )?.contactId,
        ).toBeUndefined();
    });
    it('supports legacy direct messages and uniquely named group senders, without guessing ambiguous names', () => {
        const index = contactIdentityIndex([alice, bob]);
        expect(
            resolveMessageSender(
                item({ sender: 'Old name', participants: ['+15185550123'] }),
                index,
            )?.contactId,
        ).toBe(alice.id);
        expect(
            resolveMessageSender(
                item({ sender: 'Alice Green', participants: ['+15185550456', '+15185550123'] }),
                index,
            )?.contactId,
        ).toBe(alice.id);
        const ambiguous = contactIdentityIndex([alice, { ...bob, title: 'Alice Green' }]);
        expect(
            resolveMessageSender(
                item({ sender: 'Alice Green', participants: ['+15185550456', '+15185550123'] }),
                ambiguous,
            )?.contactId,
        ).toBeUndefined();
    });
    it('keeps shared phone numbers ambiguous instead of picking a contact or graph person', () => {
        const index = contactIdentityIndex([alice, { ...bob, extra: alice.extra }]);
        expect(resolveMessageSender(item({ sender: '+15185550123' }), index)).toMatchObject({
            ambiguous: true,
        });
        expect(
            resolveMessageSender(item({ sender: '+15185550123' }), index)?.contactId,
        ).toBeUndefined();
    });
    it('does not associate outgoing messages with the recipient', () => {
        expect(
            resolveMessageSender(
                item({ isFromMe: true, sender: 'Me', participants: ['+15185550123'] }),
                contactIdentityIndex([alice]),
            ),
        ).toEqual({ name: 'Me' });
    });
    it('preserves raw message data and falls back to mail header names or addresses when no contact matches', () => {
        const original = item({ source: 'mail', sender: 'Someone <unknown@example.com>' });
        expect(withMessageSenderNames([original], [alice])[0]).toMatchObject({
            sender: original.sender,
            senderName: 'Someone',
        });
        expect(original.senderName).toBeUndefined();
        expect(
            resolveMessageSender(
                item({ sender: 'unknown@example.com' }),
                contactIdentityIndex([alice]),
            ),
        ).toEqual({ name: 'unknown@example.com', handle: 'unknown@example.com' });
    });
});
