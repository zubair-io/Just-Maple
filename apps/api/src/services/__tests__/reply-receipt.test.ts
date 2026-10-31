import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { BotActionDocument } from '../../repositories/bot-action.repo';
import { testDb } from '../../__tests__/setup';
import { createUserFixture } from '../../__tests__/helpers/fixtures';
import { upsertDeviceItems } from '../../repositories/device-item.repo';
import { reconcileReplyReceipts } from '../reply-receipt.service';
import type { MacDataItem } from '@maple/shared';
vi.mock('../realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));
const now = Date.now(),
    text = 'Saturday at four works for me!';
let userId: string, id: string;
const original: MacDataItem = {
    id: 'imessage:source',
    source: 'imessage',
    revision: '1',
    occurredAt: now / 1000 - 100,
    sender: '+15185550100',
    participants: ['+15185550100'],
    thread: 'iMessage;-;+15185550100',
    body: 'Saturday at four?',
    isFromMe: false,
};
const outgoing = (overrides: Partial<MacDataItem> = {}): MacDataItem => ({
    ...original,
    id: 'imessage:sent',
    occurredAt: now / 1000,
    isFromMe: true,
    body: text,
    ...overrides,
});
beforeEach(async () => {
    userId = (await createUserFixture())._id.toString();
    id = randomUUID();
    await upsertDeviceItems(userId, 'device', [original]);
    await testDb.collection<BotActionDocument>('bot_actions').insertOne({
        _id: id,
        ownerId: userId,
        botId: 'bot',
        notebookId: 'notebook',
        kind: 'send_reply',
        summary: 'Drafted a reply',
        status: 'opened',
        params: {
            itemId: original.id,
            channel: 'messages',
            body: text,
            recipients: [{ address: '+15185550100' }],
        },
        result: { openedAt: new Date(now - 1000).toISOString(), openCount: 1 },
        createdAt: new Date(now - 5000),
        updatedAt: new Date(now - 1000),
    });
});
describe('observed reply outcomes', () => {
    it('records an exact outgoing draft in its original thread after handoff', async () => {
        await reconcileReplyReceipts(userId, [outgoing()], now);
        const row = await testDb.collection<BotActionDocument>('bot_actions').findOne({ _id: id });
        expect(row?.status).toBe('done');
        expect(row?.result?.observedItemId).toBe('imessage:sent');
    });
    it.each([
        { isFromMe: false },
        { body: 'A different answer' },
        { thread: 'iMessage;-;+15185550200' },
        { occurredAt: now / 1000 - 60 },
        { extra: { historyBackfill: true } },
    ])('keeps unverified handoffs open: %j', async (overrides) => {
        await reconcileReplyReceipts(userId, [outgoing(overrides)], now);
        expect(
            (await testDb.collection<BotActionDocument>('bot_actions').findOne({ _id: id }))
                ?.status,
        ).toBe('opened');
    });
    it('does not use someone else’s imported messages', async () => {
        const other = (await createUserFixture())._id.toString();
        await reconcileReplyReceipts(other, [outgoing()], now);
        expect(
            (await testDb.collection<BotActionDocument>('bot_actions').findOne({ _id: id }))
                ?.status,
        ).toBe('opened');
    });
});
