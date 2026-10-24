import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createAuthToken,
    createUserBotFixture,
    createBotTemplateFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('node:dns/promises', () => ({
    lookup: vi.fn(async (host: string) => [
        { address: host === 'intranet.example.com' ? '10.1.2.3' : '93.184.216.34' },
    ]),
}));
const fetchMock = vi.fn();
describe.runIf(mongoAvailable)('bot model discovery routes', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockReset();
    });
    afterEach(() => vi.unstubAllGlobals());
    async function setup(provider = 'anthropic') {
        const user = await createUserFixture();
        const token = await createAuthToken(user._id.toString());
        const template = await createBotTemplateFixture();
        await testDb!.collection('bot_templates').updateOne(
            { _id: template._id },
            {
                $set: {
                    'definition.actions': [{ type: 'llm', id: 'reply', config: { provider } }],
                },
            },
        );
        const bot = await createUserBotFixture({
            userId: user._id.toString(),
            templateId: template._id.toString(),
            config: { apiKey: 'saved-provider-key' },
        });
        const app = createTestApp();
        const request = (body: unknown, auth = token, path = '/api/bot-models', method = 'POST') =>
            app.handle(
                new Request('http://localhost' + path, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
                    },
                    body: JSON.stringify(body),
                }),
            );
        return { user, template, bot, request };
    }
    it('uses the owned bot saved key, returns provider models, and preserves credentials when saving selection', async () => {
        const { bot, request } = await setup();
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [{ id: 'claude-current', display_name: 'Claude Current' }],
                has_more: false,
            }),
        });
        const result = await request({ userBotId: bot._id.toString() });
        expect(result.status).toBe(200);
        expect(await result.json()).toEqual({
            models: [{ id: 'claude-current', name: 'Claude Current' }],
        });
        expect(fetchMock.mock.calls[0]![1].headers['x-api-key']).toBe('saved-provider-key');
        const saved = await request(
            { config: { model: 'claude-current' } },
            undefined,
            '/api/user-bots/' + bot._id.toString(),
            'PATCH',
        );
        expect(saved.status).toBe(200);
        expect((await saved.json()).userBot.config.model).toBe('claude-current');
        expect(
            (await testDb!.collection('user_bots').findOne({ _id: bot._id }))!.config.apiKey,
        ).toBe('saved-provider-key');
    });
    it('uses a draft key for OpenAI without saving or exposing it', async () => {
        const { template, request } = await setup('openai');
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ id: 'gpt-current' }] }),
        });
        const result = await request({ templateId: template._id.toString(), apiKey: 'draft-key' });
        expect(result.status).toBe(200);
        expect(JSON.stringify(await result.json())).not.toContain('draft-key');
        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer draft-key');
    });
    it('requires authentication and rejects access to another owner saved credentials', async () => {
        const { bot, request } = await setup();
        expect((await request({ userBotId: bot._id.toString() }, '')).status).toBe(401);
        const other = await createUserFixture();
        expect(
            (
                await request(
                    { userBotId: bot._id.toString() },
                    await createAuthToken(other._id.toString()),
                )
            ).status,
        ).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('does not contact a provider without credentials or for unsupported providers', async () => {
        const { template, request } = await setup('inception');
        expect((await request({ templateId: template._id.toString(), apiKey: 'key' })).status).toBe(
            400,
        );
        await testDb!
            .collection('bot_templates')
            .updateOne(
                { _id: template._id },
                { $set: { 'definition.actions.0.config.provider': 'openai' } },
            );
        expect((await request({ templateId: template._id.toString() })).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    describe('custom OpenAI-compatible providers', () => {
        async function customSetup() {
            const ctx = await setup('openai-compatible');
            await testDb!
                .collection('user_bots')
                .updateOne(
                    { _id: ctx.bot._id },
                    { $set: { 'config.baseUrl': 'https://llm.example.com/v1' } },
                );
            return ctx;
        }

        it('lists models from the URL typed in a draft', async () => {
            const { template, request } = await customSetup();
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ data: [{ id: 'meta-llama/llama-3.3-70b' }] }),
            });
            const result = await request({
                templateId: template._id.toString(),
                apiKey: 'draft-key',
                baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
            });
            expect(result.status).toBe(200);
            expect(await result.json()).toEqual({
                models: [{ id: 'meta-llama/llama-3.3-70b', name: 'meta-llama/llama-3.3-70b' }],
            });
            expect(fetchMock.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/models');
            expect(fetchMock.mock.calls[0]![1].redirect).toBe('error');
        });

        it('never sends a saved key to a different server', async () => {
            const { bot, request } = await customSetup();
            const result = await request({
                userBotId: bot._id.toString(),
                baseUrl: 'https://attacker.example.com/v1',
            });
            expect(result.status).toBe(400);
            const moved = await request(
                { config: { baseUrl: 'https://attacker.example.com/v1' } },
                undefined,
                '/api/user-bots/' + bot._id.toString(),
                'PATCH',
            );
            expect(moved.status).toBe(400);
            expect(fetchMock).not.toHaveBeenCalled();
            const withKey = await request(
                { config: { baseUrl: 'https://groq.example.com/openai/v1/', apiKey: 'new-key' } },
                undefined,
                '/api/user-bots/' + bot._id.toString(),
                'PATCH',
            );
            expect(withKey.status).toBe(200);
            expect(
                (await testDb!.collection('user_bots').findOne({ _id: bot._id }))!.config.baseUrl,
            ).toBe('https://groq.example.com/openai/v1');
        });

        it('adds many providers from one template, each with its own public https server', async () => {
            const { template, request } = await customSetup();
            const add = (handle: string, baseUrl: string) =>
                request(
                    {
                        templateId: template._id.toString(),
                        handle,
                        displayName: handle,
                        config: { apiKey: 'key', baseUrl, model: 'some/model' },
                    },
                    undefined,
                    '/api/user-bots',
                );
            expect((await add('groq', 'https://api.groq.com/openai/v1')).status).toBe(200);
            expect((await add('router', 'https://openrouter.ai/api/v1')).status).toBe(200);
            expect((await add('plain', 'http://openrouter.ai/api/v1')).status).toBe(400);
            expect((await add('lan', 'https://192.168.1.20/v1')).status).toBe(400);
            expect((await add('intranet', 'https://intranet.example.com/v1')).status).toBe(400);
            expect((await add('nourl', '')).status).toBe(400);
        });
    });
});
