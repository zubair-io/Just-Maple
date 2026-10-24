import { isBotModel, type BotModelOption, type BotProvider } from '@maple/shared';

export class BotModelsError extends Error {
    constructor(
        message: string,
        readonly status = 502,
    ) {
        super(message);
    }
}

/** Discover models using only fixed provider endpoints; never expose credentials or raw upstream errors. */
export async function listBotModels(
    provider: BotProvider,
    apiKey: string,
    isOAuthToken = false,
): Promise<BotModelOption[]> {
    const base =
        provider === 'openai'
            ? 'https://api.openai.com/v1/models'
            : 'https://api.anthropic.com/v1/models';
    const headers: Record<string, string> =
        provider === 'openai'
            ? { Authorization: `Bearer ${apiKey}` }
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
            const response = await fetch(url.toString(), { headers, signal, redirect: 'error' });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403)
                    throw new BotModelsError(
                        'The provider rejected this API key. Check the bot credentials and try again.',
                        400,
                    );
                throw new BotModelsError(
                    `Could not load models from ${provider === 'openai' ? 'OpenAI' : 'Claude'} (${response.status}). Try again.`,
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
        throw new BotModelsError('Could not reach the model provider. Try again.');
    }
}
