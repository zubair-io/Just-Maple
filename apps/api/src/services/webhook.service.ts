import { createHmac } from 'crypto';
import type { Message, PageContent, UserBot, BotInvocation } from '@maple/shared';

/**
 * Webhook Service
 *
 * Handles webhook invocation for custom bots.
 */

// Webhook timeout (30 seconds)
const WEBHOOK_TIMEOUT_MS = 30000;

// Retry delays: 1s, 5s, 30s
const RETRY_DELAYS_MS = [1000, 5000, 30000];

/**
 * Webhook payload sent to custom bots
 */
export interface WebhookPayload {
    event_type: 'thread_mention';
    thread_id: string | null;
    parent_message_id: string;
    page_id: string;
    messages: WebhookMessage[];
    context: {
        notebook_id: string;
        page_id: string;
    };
    timestamp: string;
}

/**
 * Message format in webhook payload
 */
export interface WebhookMessage {
    id: string;
    author: {
        id: string;
        name: string;
        type: 'user' | 'bot';
    };
    content: string;
    content_json: PageContent;
    created_at: string;
}

/**
 * Sign a webhook payload with HMAC-SHA256
 */
export function signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify a webhook signature (for bot-side verification)
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = signPayload(payload, secret);
    const received = signature.replace('sha256=', '');

    // Constant-time comparison
    if (expected.length !== received.length) {
        return false;
    }

    let result = 0;
    for (let i = 0; i < expected.length; i++) {
        result |= expected.charCodeAt(i) ^ received.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Extract plain text from ProseMirror content
 */
function extractText(content: PageContent): string {
    if (!content || typeof content !== 'object') {
        return '';
    }

    const traverse = (node: any): string => {
        if (!node) return '';

        if (node.type === 'text' && typeof node.text === 'string') {
            return node.text;
        }

        if (node.type === 'mention' && node.attrs?.handle) {
            return `@${node.attrs.handle}`;
        }

        if (Array.isArray(node.content)) {
            return node.content.map(traverse).join('');
        }

        return '';
    };

    return traverse(content);
}

/**
 * Build webhook payload from messages and context
 */
export function buildWebhookPayload(
    invocation: BotInvocation,
    messages: Message[],
    threadId: string | null,
): WebhookPayload {
    return {
        event_type: 'thread_mention',
        thread_id: threadId,
        parent_message_id: invocation.sourceId,
        page_id: messages[0]?.pageId || '',
        messages: messages.map((msg) => ({
            id: msg.id || msg._id,
            author: {
                id: msg.userId,
                name: msg.senderDisplayName || msg.senderEmail || 'Unknown',
                type: (msg.senderType || 'user') as 'user' | 'bot',
            },
            content: extractText(msg.content as PageContent),
            content_json: msg.content as PageContent,
            created_at: msg.createdAt,
        })),
        context: {
            notebook_id: invocation.notebookId,
            page_id: messages[0]?.pageId || '',
        },
        timestamp: new Date().toISOString(),
    };
}

/**
 * Check if a URL is safe to call (SSRF protection)
 */
function isUrlSafe(url: string): boolean {
    try {
        const parsed = new URL(url);

        // Must be HTTPS in production
        if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
            return false;
        }

        // Block private IPs
        const hostname = parsed.hostname.toLowerCase();

        // Block localhost
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
            return false;
        }

        // Block private IP ranges
        const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
            /^169\.254\./, // Link-local (including cloud metadata)
            /^0\./,
            /^224\./, // Multicast
            /^fe80:/i, // IPv6 link-local
            /^fc00:/i, // IPv6 private
            /^fd00:/i, // IPv6 private
        ];

        for (const range of privateRanges) {
            if (range.test(hostname)) {
                return false;
            }
        }

        // Block cloud metadata endpoints
        if (hostname === '169.254.169.254') {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Invoke a custom bot's webhook
 */
export async function invokeWebhook(
    userBot: UserBot,
    payload: WebhookPayload,
): Promise<{ success: boolean; error?: string }> {
    if (!userBot.invokeUrl || !userBot.webhookSecret) {
        return { success: false, error: 'Bot missing invokeUrl or webhookSecret' };
    }

    // SSRF protection
    if (!isUrlSafe(userBot.invokeUrl)) {
        return { success: false, error: 'Invalid webhook URL' };
    }

    const body = JSON.stringify(payload);
    const signature = signPayload(body, userBot.webhookSecret);

    try {
        const response = await fetch(userBot.invokeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Maple-Signature': `sha256=${signature}`,
                'X-Maple-Timestamp': payload.timestamp,
                'X-Maple-Bot-Id': userBot._id,
            },
            body,
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Webhook returned ${response.status}: ${response.statusText}`,
            };
        }

        const result = await response.json();

        if (result.status !== 'accepted') {
            return { success: false, error: 'Webhook did not acknowledge' };
        }

        return { success: true };
    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                return { success: false, error: 'Webhook timeout' };
            }
            return { success: false, error: error.message };
        }
        return { success: false, error: 'Unknown error' };
    }
}

/**
 * Invoke webhook with retries
 */
export async function invokeWebhookWithRetry(
    userBot: UserBot,
    payload: WebhookPayload,
): Promise<{ success: boolean; error?: string; attempts: number }> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        const result = await invokeWebhook(userBot, payload);

        if (result.success) {
            return { success: true, attempts: attempt + 1 };
        }

        lastError = result.error;

        // Don't retry on client errors (4xx-like responses)
        if (
            lastError?.includes('400') ||
            lastError?.includes('401') ||
            lastError?.includes('403')
        ) {
            return { success: false, error: lastError, attempts: attempt + 1 };
        }

        // Wait before retrying (if not last attempt)
        if (attempt < RETRY_DELAYS_MS.length) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
    }

    return {
        success: false,
        error: lastError || 'All retry attempts failed',
        attempts: RETRY_DELAYS_MS.length + 1,
    };
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
