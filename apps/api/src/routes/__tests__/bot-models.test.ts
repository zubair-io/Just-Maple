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
});
