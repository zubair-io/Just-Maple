import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createAuthToken,
    createNotebookFixture,
    createMessageFixture,
    createPageFixture,
} from '../../__tests__/helpers/fixtures';
import { getTestDb } from '../../__tests__/helpers/db';
import { mongoAvailable } from '../../__tests__/setup';

vi.mock('../../services/realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));

/** Insert a notification straight into the collection, as the notification service would. */
async function insertNotification(
    userId: string,
    data: Record<string, unknown>,
    options: { type?: string; read?: boolean; expiresAt?: Date } = {},
) {
    const doc = {
        _id: new ObjectId(),
        userId,
        type: options.type ?? 'message_received',
        data,
        read: options.read ?? false,
        createdAt: new Date(),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    await getTestDb().collection('notifications').insertOne(doc);
    return doc._id.toString();
}

async function isRead(id: string): Promise<boolean> {
    const doc = await getTestDb()
        .collection('notifications')
        .findOne({ _id: new ObjectId(id) });
    return !!doc?.['read'];
}

describe.runIf(mongoAvailable)('Notifications and unread counts', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    /** A user, their notebook and its chat page. */
    async function setup() {
        const user = await createUserFixture();
        const userId = user._id.toString();
        const notebook = await createNotebookFixture({ createdBy: userId });
        const notebookId = notebook._id.toString();
        const chat = await createPageFixture({ type: 'message', userId, notebookId });
        const token = await createAuthToken(userId, user.email);
        return { userId, notebookId, pageId: chat.id, token };
    }

    function request(token: string, path: string, method = 'GET') {
        return app.handle(
            new Request(`http://localhost${path}`, {
                method,
                headers: { Authorization: `Bearer ${token}` },
            }),
        );
    }

    describe('reading a chat', () => {
        it('clears that chat’s message notifications and returns the new badge count', async () => {
            const { userId, notebookId, pageId, token } = await setup();
            const forChat = await insertNotification(userId, { notebookId, pageId });
            const legacy = await insertNotification(userId, { notebookId }); // no pageId
            const otherChat = await insertNotification(userId, {
                notebookId,
                pageId: 'another-chat',
            });
            const share = await insertNotification(
                userId,
                { notebookId },
                { type: 'share_received' },
            );

            const response = await request(token, `/api/pages/${pageId}/read`, 'POST');

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(await isRead(forChat)).toBe(true);
            expect(await isRead(legacy)).toBe(true);
            expect(await isRead(otherChat)).toBe(false);
            expect(await isRead(share)).toBe(false);
            expect(data.unreadNotificationCount).toBe(2);
        });

        it('clears notifications when read through the notebook endpoint', async () => {
            const { userId, notebookId, token } = await setup();
            const message = await createMessageFixture({ notebookId });
            const id = await insertNotification(userId, { notebookId, pageId: message.pageId });

            const response = await request(token, `/api/notebooks/${notebookId}/read`, 'POST');

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(await isRead(id)).toBe(true);
            expect(data.unreadNotificationCount).toBe(0);
        });
    });

    describe('read markers', () => {
        it('saves a read for every chat even under the old unique (userId, notebookId) rule', async () => {
            // Cosmos DB still enforces this on unread_tracking and can't drop it: every
            // marker without a notebookId collided, so only one chat per user ever saved.
            const legacy = getTestDb().collection('unread_tracking');
            await legacy.createIndex({ userId: 1, notebookId: 1 }, { unique: true });
            try {
                const { userId, notebookId, pageId, token } = await setup();
                await legacy.insertOne({
                    userId: new ObjectId(userId),
                    pageId: 'older-chat',
                    lastReadAt: new Date(),
                });
                await createMessageFixture({ notebookId, pageId });
                await new Promise((resolve) => setTimeout(resolve, 5));

                const read = await request(token, `/api/pages/${pageId}/read`, 'POST');
                const unread: any = await (
                    await request(token, `/api/pages/${pageId}/unread`)
                ).json();

                expect(read.status).toBe(200);
                expect(unread.count).toBe(0);
            } finally {
                // Other tests insert several notebook-less markers per user.
                await legacy.dropIndex('userId_1_notebookId_1');
            }
        });

        it('still honours a read marker saved in the old collection', async () => {
            const { userId, notebookId, pageId, token } = await setup();
            await createMessageFixture({ notebookId, pageId });
            await new Promise((resolve) => setTimeout(resolve, 5));
            await getTestDb()
                .collection('unread_tracking')
                .insertOne({ userId: new ObjectId(userId), pageId, lastReadAt: new Date() });

            const unread: any = await (await request(token, `/api/pages/${pageId}/unread`)).json();

            expect(unread.count).toBe(0);
        });
    });

    describe('unread message counts', () => {
        it('leaves out your own messages but counts bot posts', async () => {
            const { userId, notebookId, pageId, token } = await setup();
            await createMessageFixture({ notebookId, pageId, userId }); // you
            await createMessageFixture({ notebookId, pageId, userId, senderType: 'bot' }); // your bot
            await createMessageFixture({ notebookId, pageId }); // someone else

            const response = await request(token, `/api/pages/${pageId}/unread`);

            const data: any = await response.json();
            expect(data.count).toBe(2);
        });

        it('drops to zero once the chat is read', async () => {
            const { notebookId, pageId, token } = await setup();
            await createMessageFixture({ notebookId, pageId });
            await new Promise((resolve) => setTimeout(resolve, 5));

            await request(token, `/api/pages/${pageId}/read`, 'POST');
            const response = await request(token, `/api/pages/${pageId}/unread`);

            const data: any = await response.json();
            expect(data.count).toBe(0);
        });
    });

    describe('PATCH /api/notifications/:id/read', () => {
        it('reads the chat a message notification points at', async () => {
            const { userId, notebookId, pageId, token } = await setup();
            await createMessageFixture({ notebookId, pageId });
            await new Promise((resolve) => setTimeout(resolve, 5));
            const first = await insertNotification(userId, { notebookId, pageId });
            const second = await insertNotification(userId, { notebookId, pageId });

            const response = await request(token, `/api/notifications/${first}/read`, 'PATCH');

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.unreadNotificationCount).toBe(0);
            expect(await isRead(second)).toBe(true);
            const unread: any = await (await request(token, `/api/pages/${pageId}/unread`)).json();
            expect(unread.count).toBe(0);
        });

        it('succeeds for a notification that is already read', async () => {
            const { userId, token } = await setup();
            const id = await insertNotification(userId, {}, { type: 'reminder', read: true });

            const response = await request(token, `/api/notifications/${id}/read`, 'PATCH');

            expect(response.status).toBe(200);
        });

        it('returns 404 for another user’s notification', async () => {
            const { token } = await setup();
            const id = await insertNotification(
                new ObjectId().toString(),
                {},
                { type: 'reminder' },
            );

            const response = await request(token, `/api/notifications/${id}/read`, 'PATCH');

            expect(response.status).toBe(404);
            expect(await isRead(id)).toBe(false);
        });
    });

    describe('PATCH /api/notifications/read-all', () => {
        it('marks every notification read, including ones not loaded in the panel', async () => {
            const { userId, notebookId, pageId, token } = await setup();
            await createMessageFixture({ notebookId, pageId });
            await new Promise((resolve) => setTimeout(resolve, 5));
            for (let i = 0; i < 60; i++) {
                await insertNotification(userId, { notebookId, pageId });
            }
            await insertNotification(userId, {}, { type: 'share_received' });

            const response = await request(token, '/api/notifications/read-all', 'PATCH');

            const data: any = await response.json();
            expect(data.count).toBe(61);
            expect(data.unreadNotificationCount).toBe(0);
            const unread: any = await (await request(token, `/api/pages/${pageId}/unread`)).json();
            expect(unread.count).toBe(0);
        });
    });

    describe('GET /api/notifications', () => {
        it('returns the total unread count and hides expired notifications', async () => {
            const { userId, token } = await setup();
            await insertNotification(userId, {}, { type: 'reminder' });
            await insertNotification(userId, {}, { type: 'reminder', read: true });
            await insertNotification(
                userId,
                {},
                { type: 'reminder', expiresAt: new Date(Date.now() - 1000) },
            );

            const response = await request(token, '/api/notifications?limit=1');

            const data: any = await response.json();
            expect(data.notifications).toHaveLength(1);
            expect(data.total).toBe(2);
            expect(data.unreadCount).toBe(1);

            const count: any = await (
                await request(token, '/api/notifications/unread-count')
            ).json();
            expect(count.unreadCount).toBe(1);
        });
    });
});
