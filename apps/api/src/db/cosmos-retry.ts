/**
 * Retry utility for Azure Cosmos DB operations that may hit rate limits (429 / Error 16500).
 *
 * Cosmos DB returns a `RetryAfterMs` value when rate-limited. This utility
 * respects that value and falls back to exponential backoff if not available.
 */

const MAX_RETRIES = 5;
const DEFAULT_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * Extract the RetryAfterMs value from a Cosmos DB error message.
 */
function parseRetryAfterMs(error: any): number | null {
    const message = error?.message || error?.errmsg || '';
    const match = message.match(/RetryAfterMs=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if an error is a Cosmos DB rate limit error (429 / 16500).
 */
function isCosmosRateLimitError(error: any): boolean {
    const message = error?.message || error?.errmsg || '';
    const code = error?.code;

    return (
        code === 16500 ||
        code === 429 ||
        message.includes('TooManyRequests') ||
        message.includes('Request rate is large') ||
        message.includes('16500')
    );
}

/**
 * Execute a Cosmos DB operation with automatic retry on rate limiting.
 *
 * Uses the `RetryAfterMs` value from the error when available,
 * otherwise falls back to exponential backoff.
 */
export async function withCosmosRetry<T>(operation: () => Promise<T>, label?: string): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;

            if (!isCosmosRateLimitError(error) || attempt === MAX_RETRIES) {
                throw error;
            }

            const retryAfter = parseRetryAfterMs(error);
            const backoff = retryAfter ?? Math.min(DEFAULT_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);

            console.warn(
                `[Cosmos Retry]${label ? ` ${label}:` : ''} Rate limited (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${backoff}ms`,
            );

            await new Promise((resolve) => setTimeout(resolve, backoff));
        }
    }

    throw lastError;
}
