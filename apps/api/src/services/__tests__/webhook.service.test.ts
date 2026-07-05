import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import type { UserBot } from '@maple/shared';
import { signPayload, verifySignature, invokeWebhook } from '../webhook.service';
import type { WebhookPayload } from '../webhook.service';

function createUserBotFixture(overrides: Partial<UserBot> = {}): UserBot {
    return {
        _id: 'bot-1',
        userId: 'user-1',
        handle: 'test-bot',
        isEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        botType: 'custom',
        invokeUrl: 'https://example.com/webhook',
        webhookSecret: 'test-secret',
        ...overrides,
    } as UserBot;
}

function createWebhookPayloadFixture(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
    return {
        event_type: 'thread_mention',
        thread_id: 'thread-1',
        parent_message_id: 'msg-1',
        page_id: 'page-1',
        messages: [],
        context: {
            notebook_id: 'notebook-1',
            page_id: 'page-1',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('WebhookService', () => {
    describe('signPayload', () => {
        it('should sign a payload using HMAC-SHA256', () => {
            const payload = JSON.stringify({ hello: 'world' });
            const secret = 'my-secret';

            const expected = createHmac('sha256', secret).update(payload).digest('hex');

            expect(signPayload(payload, secret)).toBe(expected);
        });

        it('should match a known-good signature for a fixed input/secret pair', () => {
            // Precomputed with: createHmac('sha256', 'known-secret').update('known-payload').digest('hex')
            const payload = 'known-payload';
            const secret = 'known-secret';
            const knownSignature =
                '23b0620626d0585936521c452fbd2b72d8a4a817db22d897595775d50bd79099';

            expect(signPayload(payload, secret)).toBe(knownSignature);
        });

        it('should produce different signatures for different payloads', () => {
            const secret = 'my-secret';
            const sigA = signPayload('payload-a', secret);
            const sigB = signPayload('payload-b', secret);

            expect(sigA).not.toBe(sigB);
        });

        it('should produce different signatures for different secrets', () => {
            const payload = 'same-payload';
            const sigA = signPayload(payload, 'secret-a');
            const sigB = signPayload(payload, 'secret-b');

            expect(sigA).not.toBe(sigB);
        });

        it('should be deterministic for the same input', () => {
            const payload = 'repeatable-payload';
            const secret = 'repeatable-secret';

            expect(signPayload(payload, secret)).toBe(signPayload(payload, secret));
        });
    });

    describe('verifySignature', () => {
        it('should verify a correctly signed payload', () => {
            const payload = JSON.stringify({ event: 'thread_mention' });
            const secret = 'shared-secret';
            const signature = `sha256=${signPayload(payload, secret)}`;

            expect(verifySignature(payload, signature, secret)).toBe(true);
        });

        it('should verify a signature even without the sha256= prefix', () => {
            const payload = 'raw-payload';
            const secret = 'shared-secret';
            const signature = signPayload(payload, secret);

            expect(verifySignature(payload, signature, secret)).toBe(true);
        });

        it('should reject a signature with an incorrect secret', () => {
            const payload = 'raw-payload';
            const signature = `sha256=${signPayload(payload, 'correct-secret')}`;

            expect(verifySignature(payload, signature, 'wrong-secret')).toBe(false);
        });

        it('should reject a signature for a tampered payload', () => {
            const secret = 'shared-secret';
            const signature = `sha256=${signPayload('original-payload', secret)}`;

            expect(verifySignature('tampered-payload', signature, secret)).toBe(false);
        });

        it('should reject a malformed/short signature without throwing', () => {
            const payload = 'raw-payload';
            const secret = 'shared-secret';

            expect(verifySignature(payload, 'sha256=not-a-real-signature', secret)).toBe(false);
        });

        it('should match a known-good signature/payload/secret triple', () => {
            const payload = 'known-payload';
            const secret = 'known-secret';
            const knownSignature =
                'sha256=23b0620626d0585936521c452fbd2b72d8a4a817db22d897595775d50bd79099';

            expect(verifySignature(payload, knownSignature, secret)).toBe(true);
        });
    });

    describe('invokeWebhook', () => {
        const originalFetch = global.fetch;

        beforeEach(() => {
            global.fetch = vi.fn();
        });

        afterEach(() => {
            global.fetch = originalFetch;
            vi.restoreAllMocks();
        });

        it('should return success when the webhook responds with 2xx and accepted status', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ status: 'accepted' }),
            });

            const result = await invokeWebhook(
                createUserBotFixture(),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({ success: true });
        });

        it('should return a failure result when fetch throws a TimeoutError', async () => {
            const timeoutError = new Error('The operation timed out');
            timeoutError.name = 'TimeoutError';
            (global.fetch as any).mockRejectedValue(timeoutError);

            const result = await invokeWebhook(
                createUserBotFixture(),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({ success: false, error: 'Webhook timeout' });
        });

        it('should return a failure result when fetch throws an AbortError', async () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            (global.fetch as any).mockRejectedValue(abortError);

            const result = await invokeWebhook(
                createUserBotFixture(),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({ success: false, error: 'Webhook timeout' });
        });

        it('should return the error message for other generic Error exceptions', async () => {
            (global.fetch as any).mockRejectedValue(new Error('Network is unreachable'));

            const result = await invokeWebhook(
                createUserBotFixture(),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({ success: false, error: 'Network is unreachable' });
        });

        it('should return an "Unknown error" result when a non-Error value is thrown', async () => {
            (global.fetch as any).mockRejectedValue('a string rejection, not an Error');

            const result = await invokeWebhook(
                createUserBotFixture(),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({ success: false, error: 'Unknown error' });
        });

        it('should not throw when fetch rejects - the promise resolves with a failure result', async () => {
            (global.fetch as any).mockRejectedValue(new Error('boom'));

            await expect(
                invokeWebhook(createUserBotFixture(), createWebhookPayloadFixture()),
            ).resolves.toMatchObject({ success: false });
        });

        it('should return failure when the response is not ok', async () => {
            (global.fetch as any).mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: async () => ({}),
            });

            const result = await invokeWebhook(
                createUserBotFixture(),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({
                success: false,
                error: 'Webhook returned 500: Internal Server Error',
            });
        });

        it('should return failure when invokeUrl or webhookSecret is missing', async () => {
            const result = await invokeWebhook(
                createUserBotFixture({ invokeUrl: undefined }),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({
                success: false,
                error: 'Bot missing invokeUrl or webhookSecret',
            });
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('should return failure when the URL fails the SSRF safety check', async () => {
            const result = await invokeWebhook(
                createUserBotFixture({ invokeUrl: 'http://169.254.169.254/webhook' }),
                createWebhookPayloadFixture(),
            );

            expect(result).toEqual({ success: false, error: 'Invalid webhook URL' });
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });
});
