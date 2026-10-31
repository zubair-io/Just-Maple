import { isBotModel, type BotModelOption, type BotProvider } from '@maple/shared';
import type { HttpSend } from './llm-tool-loop.service';
import { assertBotRequestUrl } from '../utils/url-safety';

export class BotModelsError extends Error {
    constructor(
        message: string,
        readonly status = 502,
    ) {
        super(message);
    }
}

/**
 * Discover models from the provider, or from a custom bot's server (`baseUrl`, already
 * checked by the caller). Never exposes credentials or raw upstream errors.
 */
export async function listBotModels(
    provider: BotProvider,
    apiKey: string,
    isOAuthToken = false,
    baseUrl?: string,
    /** For servers the API can't reach itself: the request goes out from the owner's Mac. */
    send?: HttpSend,
): Promise<BotModelOption[]> {
    const base =
        provider === 'openai-compatible'
            ? `${baseUrl}/models`
            : provider === 'openai'
              ? 'https://api.openai.com/v1/models'
              : 'https://api.anthropic.com/v1/models';
    const providerName =
        provider === 'openai-compatible'
            ? 'the server'
            : provider === 'openai'
              ? 'OpenAI'
              : 'Claude';
    const headers: Record<string, string> =
        provider !== 'anthropic'
            ? apiKey
                ? { Authorization: `Bearer ${apiKey}` }
                : {}
            : {
                  'anthropic-version': '2023-06-01',
                  ...(isOAuthToken
                      ? { Authorization: `Bearer ${apiKey}`, 'anthropic-beta': 'oauth-2025-04-20' }
                      : { 'x-api-key': apiKey }),
              };
    const signal = AbortSignal.timeout(15000);
    const models = new Map<string, BotModelOption>();
    let after: string | undefined;
    try {
        for (let page = 0; page < 20; page++) {
            const url = new URL(base);
            if (provider === 'anthropic') {
                url.searchParams.set('limit', '1000');
                if (after) url.searchParams.set('after_id', after);
            }
            if (provider === 'openai-compatible') await assertBotRequestUrl(url.toString());
            const response = send
                ? await send({ method: 'GET', url: url.toString(), headers }).then((reply) => ({
                      ok: reply.status >= 200 && reply.status < 300,
                      status: reply.status,
                      json: async () => JSON.parse(reply.body) as unknown,
                  }))
                : await fetch(url.toString(), { headers, signal, redirect: 'error' });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403)
                    throw new BotModelsError(
                        'The provider rejected this API key. Check the bot credentials and try again.',
                        400,
                    );
                throw new BotModelsError(
                    `Could not load models from ${providerName} (${response.status}). Try again.`,
                );
            }
            const body = (await response.json()) as {
                data?: unknown;
                has_more?: boolean;
                last_id?: string;
            };
            if (!Array.isArray(body.data))
                throw new BotModelsError('The provider returned an invalid model list.');
            for (const item of body.data) {
                if (!item || typeof item.id !== 'string' || !isBotModel(item.id, provider))
                    continue;
                // These specialized OpenAI models cannot produce the bot's ordinary text/UI replies.
                if (
                    provider === 'openai' &&
                    /(?:audio|realtime|transcribe|tts|image|search|deep-research)/i.test(item.id)
                )
                    continue;
                if (
                    typeof item.shutdown_date === 'string' &&
                    Date.parse(item.shutdown_date) <= Date.now()
                )
                    continue;
                models.set(item.id, {
                    id: item.id,
                    name: typeof item.display_name === 'string' ? item.display_name : item.id,
                });
            }
            if (provider !== 'anthropic' || !body.has_more)
                return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
            if (!body.last_id || body.last_id === after)
                throw new BotModelsError('The provider returned an invalid model-list cursor.');
            after = body.last_id;
        }
        throw new BotModelsError('The provider returned too many model pages.');
    } catch (error) {
        if (error instanceof BotModelsError) throw error;
        // A local server's owner Mac is offline: say so instead of a generic error.
        if (error instanceof Error && error.name === 'MacDataUnavailableError')
            throw new BotModelsError(error.message, 503);
        throw new BotModelsError('Could not reach the model provider. Try again.');
    }
}
