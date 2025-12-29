import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createTagFixture,
    createBotTemplateFixture,
    createUserBotFixture,
    createMessageFixture,
    createThreadFixture,
    createBotInvocationFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

// Mock bot executor service
vi.mock('../../services/bot-executor.service', () => ({
    botExecutor: {
        invoke: vi.fn().mockResolvedValue({
            _id: 'test-invocation-id',
            status: 'completed',
            output: { message: 'Bot response' },
        }),
    },
}));

describe.runIf(mongoAvailable)('Bot Routes', () => {
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

    describe('GET /api/bot-templates', () => {
        it('should return all bot templates', async () => {
            const user = await createUserFixture();
            const template1 = await createBotTemplateFixture({ name: 'Claude' });
            const template2 = await createBotTemplateFixture({ name: 'GPT-4' });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/bot-templates', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.templates).toHaveLength(2);
            expect(data.templates.some((t: any) => t._id === template1._id.toString())).toBe(true);
            expect(data.templates.some((t: any) => t._id === template2._id.toString())).toBe(true);
        });

        it('should require authentication', async () => {
            const response = await app.handle(new Request('http://localhost/api/bot-templates'));

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/bot-templates/:id', () => {
        it('should return template by id', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ name: 'Claude' });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/bot-templates/${template._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.template._id).toBe(template._id.toString());
            expect(data.template.name).toBe('Claude');
        });

        it('should return 404 for non-existent template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/bot-templates/507f1f77bcf86cd799439011', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('GET /api/user-bots', () => {
        it('should return user bots with template info', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ name: 'Claude' });
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
                handle: 'my-claude',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBots).toHaveLength(1);
            expect(data.userBots[0]._id).toBe(userBot._id.toString());
            expect(data.userBots[0].handle).toBe('my-claude');
            expect(data.userBots[0].templateName).toBe('Claude');
        });

        it('should not return other users bots', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const template = await createBotTemplateFixture();
            await createUserBotFixture({
                userId: user2._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBots).toHaveLength(0);
        });

        it('should redact API keys in response', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ requiresConfig: true });
            await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
                config: { apiKey: 'secret-key-12345' },
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBots[0].config?.apiKey).toBe('***REDACTED***');
        });
    });

    describe('POST /api/user-bots', () => {
        it('should register a new bot', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ handle: 'claude' });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        templateId: template._id.toString(),
                        handle: 'my-claude',
                        displayName: 'My Claude Bot',
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBot.handle).toBe('my-claude');
            expect(data.userBot.displayName).toBe('My Claude Bot');
            expect(data.userBot.templateName).toBe(template.name);
        });

        it('should use template handle if no custom handle provided', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ handle: 'claude' });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        templateId: template._id.toString(),
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBot.handle).toBe('claude');
        });

        it('should reject duplicate handle for same user', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ handle: 'claude' });
            await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
                handle: 'my-bot',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        templateId: template._id.toString(),
                        handle: 'my-bot',
                    }),
                }),
            );

            expect(response.status).toBe(400);
            const data: any = await response.json();
            expect(data.error).toContain('already have a bot');
        });

        it('should require API key for templates that requireConfig', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ requiresConfig: true });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        templateId: template._id.toString(),
                    }),
                }),
            );

            expect(response.status).toBe(400);
            const data: any = await response.json();
            expect(data.error).toContain('requires an API key');
        });

        it('should accept config with API key', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ requiresConfig: true });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        templateId: template._id.toString(),
                        config: { apiKey: 'my-api-key' },
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBot.config?.apiKey).toBe('***REDACTED***');
        });

        it('should return 400 for invalid template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/user-bots', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        templateId: '507f1f77bcf86cd799439011',
                    }),
                }),
            );

            expect(response.status).toBe(400);
        });
    });

    describe('PATCH /api/user-bots/:id', () => {
        it('should update bot display name', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/user-bots/${userBot._id.toString()}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        displayName: 'Updated Name',
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBot.displayName).toBe('Updated Name');
        });

        it('should update bot config', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
                config: { apiKey: 'old-key' },
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/user-bots/${userBot._id.toString()}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        config: { apiKey: 'new-key' },
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBot.config?.apiKey).toBe('***REDACTED***');
        });

        it('should toggle bot enabled status', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
                isEnabled: true,
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/user-bots/${userBot._id.toString()}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        isEnabled: false,
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.userBot.isEnabled).toBe(false);
        });

        it('should not allow updating other users bots', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user1._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/user-bots/${userBot._id.toString()}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        displayName: 'Hacked',
                    }),
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/user-bots/:id', () => {
        it('should delete user bot', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/user-bots/${userBot._id.toString()}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message).toBe('Bot deleted');
        });

        it('should not allow deleting other users bots', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user1._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/user-bots/${userBot._id.toString()}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('GET /api/tags/:id/bots', () => {
        it('should return bots available in tag', async () => {
            const user = await createUserFixture({ displayName: 'Test User' });
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const template = await createBotTemplateFixture({ name: 'Claude' });
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
                handle: 'claude-bot',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            // Share bot to tag
            const { shareBotToTag } = await import('../../repositories/tag.repo');
            await shareBotToTag(tag._id.toString(), user._id.toString(), userBot._id.toString());

            const response = await app.handle(
                new Request(`http://localhost/api/tags/${tag._id.toString()}/bots`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.bots).toHaveLength(1);
            expect(data.bots[0].id).toBe(userBot._id.toString());
            expect(data.bots[0].handle).toBe('claude-bot');
            expect(data.bots[0].type).toBe('bot');
            expect(data.bots[0].ownerName).toBe('Test User');
        });

        it('should return 404 for non-existent tag', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/tags/507f1f77bcf86cd799439011/bots', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('GET /api/threads/:id', () => {
        it('should return thread details', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const thread = await createThreadFixture({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/threads/${thread._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.thread._id).toBe(thread._id.toString());
            expect(data.thread.parentMessageId).toBe(message._id.toString());
        });

        it('should return 403 for thread in inaccessible tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user1._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user1._id.toString(),
            });
            const thread = await createThreadFixture({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/threads/${thread._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(403);
        });
    });

    describe('GET /api/threads/:id/messages', () => {
        it('should return messages in thread', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const parentMessage = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const thread = await createThreadFixture({
                parentMessageId: parentMessage._id.toString(),
                tagId: tag._id.toString(),
            });
            const threadMessage = await createMessageFixture({
                tagId: tag._id.toString(),
                threadId: thread._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/threads/${thread._id.toString()}/messages`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.messages).toHaveLength(1);
            expect(data.messages[0]._id).toBe(threadMessage._id.toString());
        });

        it('should respect limit parameter', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const parentMessage = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const thread = await createThreadFixture({
                parentMessageId: parentMessage._id.toString(),
                tagId: tag._id.toString(),
            });
            // Create 3 messages in thread
            await createMessageFixture({
                tagId: tag._id.toString(),
                threadId: thread._id.toString(),
                userId: user._id.toString(),
            });
            await createMessageFixture({
                tagId: tag._id.toString(),
                threadId: thread._id.toString(),
                userId: user._id.toString(),
            });
            await createMessageFixture({
                tagId: tag._id.toString(),
                threadId: thread._id.toString(),
                userId: user._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/threads/${thread._id.toString()}/messages?limit=2`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.messages).toHaveLength(2);
        });
    });

    describe('GET /api/messages/:messageId/thread', () => {
        it('should return thread for message', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
                hasThread: true,
            });
            const thread = await createThreadFixture({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/messages/${message._id.toString()}/thread`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.thread._id).toBe(thread._id.toString());
            expect(data.messages).toBeDefined();
        });

        it('should return 404 when message has no thread', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
                hasThread: false,
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/messages/${message._id.toString()}/thread`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });
});
