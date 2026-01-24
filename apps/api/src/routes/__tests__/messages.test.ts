import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createNotebookFixture,
    createMessageFixture,
    createThreadFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

// Mock realtime and notification services
vi.mock('../../services/realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/notification.service', () => ({
    sendMessageReceivedNotification: vi.fn().mockResolvedValue(undefined),
}));

describe.runIf(mongoAvailable)('Message Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    async function getAuthToken(userId: string, email: string) {
        const magicLink = await createMagicLinkFixture({ userId, email });
        const response = await app.handle(
            new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
        );
        const data: any = await response.json();
        return data.accessToken;
    }

    describe('GET /api/notebooks/:id/messages', () => {
        it('should return messages for tag', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const message1 = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const message2 = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.messages).toHaveLength(2);
        });

        it('should not return messages from other tags', async () => {
            const user = await createUserFixture();
            const tag1 = await createNotebookFixture({ createdBy: user._id.toString() });
            const tag2 = await createNotebookFixture({ createdBy: user._id.toString() });
            await createMessageFixture({
                notebookId: tag2._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag1._id.toString()}/messages`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.messages).toHaveLength(0);
        });

        it('should respect limit parameter', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            // Create 3 messages
            await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/notebooks/${tag._id.toString()}/messages?limit=2`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.messages).toHaveLength(2);
        });

        it('should return 404 for tag user does not have access to', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('POST /api/notebooks/:id/messages', () => {
        it('should send a message', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const messageContent = {
                type: 'doc',
                content: [{ type: 'text', text: 'Hello world' }],
            };

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: messageContent }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message.content).toEqual(messageContent);
            expect(data.message.userId).toBe(user._id.toString());
            expect(data.message.notebookId).toBe(tag._id.toString());
        });

        it('should create thread when replying to message', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const parentMessage = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        content: { type: 'doc', content: [] },
                        parentMessageId: parentMessage._id.toString(),
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message.threadId).toBeDefined();
        });

        it('should add message to existing thread', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const parentMessage = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const thread = await createThreadFixture({
                parentMessageId: parentMessage._id.toString(),
                notebookId: tag._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        content: { type: 'doc', content: [] },
                        threadId: thread._id.toString(),
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message.threadId).toBe(thread._id.toString());
        });

        it('should require write access', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'read' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: { type: 'doc', content: [] } }),
                }),
            );

            expect(response.status).toBe(403);
        });

        it('should return 403 for non-accessible tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: { type: 'doc', content: [] } }),
                }),
            );

            expect(response.status).toBe(403);
        });
    });

    describe('POST /api/notebooks/:id/read', () => {
        it('should mark tag as read', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/read`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.lastReadAt).toBeDefined();
        });

        it('should return 404 for non-accessible tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/read`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('GET /api/notebooks/:id/unread', () => {
        it('should return unread count for tag', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/unread`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebookId).toBe(tag._id.toString());
            expect(data.count).toBeGreaterThanOrEqual(0);
        });

        it('should return 404 for non-accessible tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/unread`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('GET /api/unread', () => {
        it('should return unread counts for all user tags', async () => {
            const user = await createUserFixture();
            const tag1 = await createNotebookFixture({ createdBy: user._id.toString() });
            const tag2 = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/unread', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.counts).toBeDefined();
            expect(Array.isArray(data.counts)).toBe(true);
        });

        it('should require authentication', async () => {
            const response = await app.handle(new Request('http://localhost/api/unread'));

            expect(response.status).toBe(401);
        });
    });

    describe('PUT /api/messages/:id', () => {
        it('should edit message', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
                content: { type: 'doc', content: [{ type: 'text', text: 'Original' }] },
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const newContent = { type: 'doc', content: [{ type: 'text', text: 'Edited' }] };

            const response = await app.handle(
                new Request(`http://localhost/api/messages/${message.id}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: newContent }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message.content).toEqual(newContent);
            expect(data.message.editedAt).toBeDefined();
        });

        it('should not allow editing other users message', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const message = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user1._id.toString(),
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/messages/${message.id}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: { type: 'doc', content: [] } }),
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should return 404 for non-existent message', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/messages/507f1f77bcf86cd799439011', {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: { type: 'doc', content: [] } }),
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/messages/:id', () => {
        it('should soft delete message', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/messages/${message.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message).toBe('Message deleted');
        });

        it('should not allow deleting other users message', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const message = await createMessageFixture({
                notebookId: tag._id.toString(),
                userId: user1._id.toString(),
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/messages/${message.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should return 404 for non-existent message', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/messages/507f1f77bcf86cd799439011', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });
});
