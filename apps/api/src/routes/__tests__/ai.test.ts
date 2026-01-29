import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createNotebookFixture,
    createBotTemplateFixture,
    createUserBotFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';

// Mock the AI writing service
vi.mock('../../services/ai-writing.service', () => ({
    aiWritingService: {
        generateStream: vi.fn().mockImplementation(async function* () {
            yield { type: 'token', data: { text: 'Hello ' } };
            yield { type: 'token', data: { text: 'world!' } };
            yield { type: 'done', data: { tokensUsed: 10, finishReason: 'stop' } };
        }),
    },
}));

describe.runIf(mongoAvailable)('AI Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
        vi.clearAllMocks();
    });

    async function getAuthToken(userId: string, email: string) {
        const magicLink = await createMagicLinkFixture({ userId, email });
        const response = await app.handle(
            new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
        );
        const data: any = await response.json();
        return data.accessToken;
    }

    async function setupNotebookWithBot(userId: string) {
        const notebook = await createNotebookFixture({ createdBy: userId });
        const template = await createBotTemplateFixture({ handle: 'claude', name: 'Claude' });
        const userBot = await createUserBotFixture({
            userId,
            templateId: template._id.toString(),
            handle: 'claude',
            config: { apiKey: 'test-api-key' },
        });

        // Share bot to notebook
        const { shareBotToNotebook } = await import('../../repositories/notebook.repo');
        await shareBotToNotebook(notebook._id.toString(), userId, userBot._id.toString());

        return { notebook, template, userBot };
    }

    describe('POST /api/ai/generate/:notebookId', () => {
        it('should require authentication', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/ai/generate/some-notebook-id', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'continue',
                        context: 'Some context',
                    }),
                }),
            );

            expect(response.status).toBe(401);
        });

        it('should return 404 for non-existent notebook', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/ai/generate/507f1f77bcf86cd799439011', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'continue',
                        context: 'Some context',
                    }),
                }),
            );

            expect(response.status).toBe(404);
            const data: any = await response.json();
            expect(data.error).toContain('not found');
        });

        it('should return 400 for invalid type', async () => {
            const user = await createUserFixture();
            const { notebook } = await setupNotebookWithBot(user._id.toString());
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/ai/generate/${notebook._id.toString()}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'invalid-type',
                        context: 'Some context',
                    }),
                }),
            );

            expect(response.status).toBe(400);
            const data: any = await response.json();
            expect(data.error).toContain('Invalid type');
        });

        it('should return SSE stream for valid request', async () => {
            const user = await createUserFixture();
            const { notebook } = await setupNotebookWithBot(user._id.toString());
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/ai/generate/${notebook._id.toString()}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'continue',
                        context: 'Some context',
                    }),
                }),
            );

            // Check that response is streaming
            expect(response.headers.get('content-type')).toBe('text/event-stream');
            expect(response.headers.get('cache-control')).toBe('no-cache');

            // Read the stream
            const text = await response.text();
            expect(text).toContain('event: token');
            expect(text).toContain('Hello');
            expect(text).toContain('world!');
            expect(text).toContain('event: done');
        });

        it('should accept all valid action types', async () => {
            const user = await createUserFixture();
            const { notebook } = await setupNotebookWithBot(user._id.toString());
            const token = await getAuthToken(user._id.toString(), user.email);

            const validTypes = [
                'continue',
                'improve',
                'simplify',
                'expand',
                'shorten',
                'summarize',
                'grammar',
                'translate',
                'custom',
            ];

            for (const type of validTypes) {
                const response = await app.handle(
                    new Request(`http://localhost/api/ai/generate/${notebook._id.toString()}`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            type,
                            context: 'Some context',
                            selection: type !== 'continue' ? 'Selected text' : undefined,
                            targetLanguage: type === 'translate' ? 'Spanish' : undefined,
                            instruction: type === 'custom' ? 'Custom instruction' : undefined,
                        }),
                    }),
                );

                expect(response.headers.get('content-type')).toBe('text/event-stream');
            }
        });
    });

    describe('GET /api/ai/usage', () => {
        it('should require authentication', async () => {
            const response = await app.handle(new Request('http://localhost/api/ai/usage'));

            expect(response.status).toBe(401);
        });

        it('should return usage statistics', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/ai/usage', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();

            expect(data.usage).toBeDefined();
            expect(data.usage.daily).toBeDefined();
            expect(data.usage.daily.requests).toBe(0);
            expect(data.usage.daily.tokens).toBe(0);
            expect(data.usage.daily.limit).toBeDefined();
            expect(data.usage.monthly).toBeDefined();
            expect(data.usage.resetAt).toBeDefined();
        });

        it('should track usage after generation requests', async () => {
            const user = await createUserFixture();
            const { notebook } = await setupNotebookWithBot(user._id.toString());
            const token = await getAuthToken(user._id.toString(), user.email);

            // Make a generation request
            await app.handle(
                new Request(`http://localhost/api/ai/generate/${notebook._id.toString()}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'continue',
                        context: 'Some context for testing usage tracking',
                    }),
                }),
            );

            // Check usage
            const response = await app.handle(
                new Request('http://localhost/api/ai/usage', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();

            expect(data.usage.daily.requests).toBe(1);
            expect(data.usage.daily.tokens).toBeGreaterThan(0);
        });
    });

    describe('Rate Limiting', () => {
        it('should enforce rate limits', async () => {
            const user = await createUserFixture();
            const { notebook } = await setupNotebookWithBot(user._id.toString());
            const token = await getAuthToken(user._id.toString(), user.email);

            // Insert usage record at the limit
            const today = new Date().toISOString().split('T')[0];
            await testDb.collection('ai_usage').insertOne({
                userId: user._id.toString(),
                date: today,
                requests: 50, // At the limit
                tokensInput: 10000,
                tokensOutput: 5000,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const response = await app.handle(
                new Request(`http://localhost/api/ai/generate/${notebook._id.toString()}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'continue',
                        context: 'Some context',
                    }),
                }),
            );

            expect(response.status).toBe(429);
            const data: any = await response.json();
            expect(data.error).toContain('Rate limit');
            expect(data.resetAt).toBeDefined();
        });
    });
});
