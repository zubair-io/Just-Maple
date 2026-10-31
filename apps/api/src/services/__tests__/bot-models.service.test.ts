import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listBotModels } from '../bot-models.service';

const fetchMock = vi.fn();
beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});
const page = (data: unknown[], rest = {}) => ({ ok: true, json: async () => ({ data, ...rest }) });

describe('provider model discovery', () => {
    it('discovers models directly from the approved LAN server with its saved credential', async () => {
        vi.stubEnv('BOT_ALLOWED_PRIVATE_ENDPOINTS', 'http://10.0.0.9:8080/v1');
        fetchMock.mockResolvedValue(page([{ id: 'local-model' }]));
        expect(
            await listBotModels('openai-compatible', 'local-key', false, 'http://10.0.0.9:8080/v1'),
        ).toEqual([{ id: 'local-model', name: 'local-model' }]);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://10.0.0.9:8080/v1/models',
            expect.objectContaining({
                redirect: 'error',
                headers: { Authorization: 'Bearer local-key' },
            }),
        );
    });
    it('loads OpenAI reply models, includes fine tunes, and excludes specialist models', async () => {
        fetchMock.mockResolvedValue(
            page([
                { id: 'gpt-current' },
                { id: 'gpt-current' },
                { id: 'ft:gpt-current:org:custom' },
                { id: 'text-embedding-3-large' },
                { id: 'gpt-audio' },
                { id: 'gpt-realtime' },
                { id: 'gpt-retired', shutdown_date: '2000-01-01' },
            ]),
        );
        expect((await listBotModels('openai', 'key')).map((m) => m.id)).toEqual([
            'ft:gpt-current:org:custom',
            'gpt-current',
        ]);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.openai.com/v1/models',
            expect.objectContaining({ headers: { Authorization: 'Bearer key' } }),
        );
    });
    it('paginates Claude results and retains provider display names', async () => {
        fetchMock.mockResolvedValueOnce(
            page([{ id: 'claude-sonnet-current', display_name: 'Sonnet Current' }], {
                has_more: true,
                last_id: 'claude-sonnet-current',
            }),
        );
        fetchMock.mockResolvedValueOnce(
            page([{ id: 'claude-opus-current', display_name: 'Opus Current' }], {
                has_more: false,
            }),
        );
        expect(await listBotModels('anthropic', 'key')).toEqual([
            { id: 'claude-opus-current', name: 'Opus Current' },
            { id: 'claude-sonnet-current', name: 'Sonnet Current' },
        ]);
        expect(fetchMock.mock.calls[1]![0]).toContain('after_id=claude-sonnet-current');
        expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({
            'x-api-key': 'key',
            'anthropic-version': '2023-06-01',
        });
    });
    it('supports saved Claude OAuth credentials without treating them as API keys', async () => {
        fetchMock.mockResolvedValue(page([]));
        await listBotModels('anthropic', 'oauth', true);
        expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer oauth');
        expect(fetchMock.mock.calls[0]![1].headers['x-api-key']).toBeUndefined();
    });
    it('returns actionable credential errors without forwarding provider response bodies', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => 'sensitive provider text',
        });
        await expect(listBotModels('openai', 'key')).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('rejected this API key'),
        });
    });
    it('rejects malformed and incomplete paginated responses', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: 'bad' }) });
        await expect(listBotModels('openai', 'key')).rejects.toThrow('invalid model list');
        fetchMock.mockResolvedValue(page([], { has_more: true }));
        await expect(listBotModels('anthropic', 'key')).rejects.toThrow('cursor');
    });
    it('handles provider outages without exposing network errors', async () => {
        fetchMock.mockRejectedValue(new Error('secret details'));
        await expect(listBotModels('openai', 'key')).rejects.toThrow(
            'Could not reach the model provider',
        );
    });
});
