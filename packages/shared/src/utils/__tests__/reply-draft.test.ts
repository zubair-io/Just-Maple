import { describe, it, expect } from 'vitest';
import { replyChannelName, replyComposeUrl } from '../reply-draft';
import { emailAddressOf, isMailFromMe, ownEmailAddresses } from '../own-addresses';
import type { MacDataItem } from '../../schemas/mac-data';

describe('replyComposeUrl', () => {
    const jen = { address: '+15185550100' };

    it('opens Messages for one person with the body', () => {
        expect(replyComposeUrl({ channel: 'messages', recipients: [jen] }, 'see u at 4!')).toBe(
            'sms:+15185550100&body=see%20u%20at%204!',
        );
        expect(
            replyComposeUrl(
                { channel: 'messages', recipients: [{ address: 'jen@icloud.com' }] },
                'hi',
            ),
        ).toBe('sms:jen@icloud.com&body=hi');
    });

    it('encodes "+" in group addresses, where it would read as a space', () => {
        expect(
            replyComposeUrl(
                {
                    channel: 'messages',
                    recipients: [jen, { address: '+15185550199' }, { address: 'sam@icloud.com' }],
                },
                'on my way',
            ),
        ).toBe(
            'sms:/open?addresses=%2B15185550100,%2B15185550199,sam%40icloud.com&body=on%20my%20way',
        );
    });

    it('keeps the body from adding recipients or parameters', () => {
        const url = replyComposeUrl(
            { channel: 'messages', recipients: [jen] },
            'hi&addresses=+1999?body=x#y',
        );
        expect(url).toBe('sms:+15185550100&body=hi%26addresses%3D%2B1999%3Fbody%3Dx%23y');
        expect(
            replyComposeUrl(
                { channel: 'messages', recipients: [{ address: 'a&body=evil' }] },
                'hi',
            ),
        ).toBe('sms:a%26body%3Devil&body=hi');
    });

    it('opens Mail with the subject and CRLF line breaks', () => {
        expect(
            replyComposeUrl(
                {
                    channel: 'mail',
                    recipients: [{ address: 'jen@example.com' }],
                    subject: 'Re: Dinner & drinks',
                },
                'Hi Jen,\nThursday works.\r\nAlex',
            ),
        ).toBe(
            'mailto:jen@example.com?subject=Re%3A%20Dinner%20%26%20drinks&body=Hi%20Jen%2C%0D%0AThursday%20works.%0D%0AAlex',
        );
        expect(
            replyComposeUrl({ channel: 'mail', recipients: [{ address: 'jen@example.com' }] }, 'x'),
        ).toBe('mailto:jen@example.com?body=x');
    });

    it('names the app', () => {
        expect(replyChannelName('messages')).toBe('Messages');
        expect(replyChannelName('mail')).toBe('Mail');
    });
});

describe('own email addresses', () => {
    const meCard = {
        extra: { isMe: true, emails: [{ label: 'home', value: 'Alex@Home.example' }, 'x'] },
    } as unknown as MacDataItem;

    it('reads the account email and the "me" card, lowercased', () => {
        expect(ownEmailAddresses({ accountEmail: 'alex@work.example', meCard })).toEqual([
            'alex@work.example',
            'alex@home.example',
        ]);
        expect(ownEmailAddresses({})).toEqual([]);
    });

    it('decides "from me" by sender address, not mailbox', () => {
        const own = ['alex@home.example'];
        expect(isMailFromMe({ sender: 'Alex <ALEX@home.example>', mailbox: 'INBOX' }, own)).toBe(
            true,
        );
        expect(isMailFromMe({ sender: 'Jen <jen@example.com>', mailbox: 'Sent' }, own)).toBe(false);
        // Unknown addresses: the mailbox is the last resort.
        expect(isMailFromMe({ sender: 'a@b.c', mailbox: 'Sent Messages' }, [])).toBe(true);
        expect(isMailFromMe({ sender: 'a@b.c', mailbox: 'INBOX' }, [])).toBe(false);
    });

    it('parses addresses', () => {
        expect(emailAddressOf('"Park, Jen" <jen@example.com>')).toBe('jen@example.com');
        expect(emailAddressOf('mailto:Jen@Example.com')).toBe('jen@example.com');
        expect(emailAddressOf('Jen')).toBeNull();
        expect(emailAddressOf(undefined)).toBeNull();
    });
});
