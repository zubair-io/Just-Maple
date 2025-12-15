import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import { createUserFixture, createMagicLinkFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

// Mock email service
vi.mock('../../services/email', () => ({
    sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

describe.runIf(mongoAvailable)('Auth Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('POST /api/auth/magic-link', () => {
        it('should send magic link for new user', async () => {
            const uniqueEmail = `newuser-${Date.now()}@example.com`;
            const response = await app.handle(
                new Request('http://localhost/api/auth/magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: uniqueEmail }),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.message).toBe('Magic link sent to your email');
            // In dev mode, token should be included
            expect(data.devToken).toBeDefined();
        });

        it('should send magic link for existing user', async () => {
            const fixture = await createUserFixture();

            const response = await app.handle(
                new Request('http://localhost/api/auth/magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: fixture.email }),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.message).toBe('Magic link sent to your email');
        });

        it('should return 422 for invalid email', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/auth/magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'invalid-email' }),
                }),
            );

            expect(response.status).toBe(422); // Elysia validation error
        });
    });

    describe('GET /api/auth/verify', () => {
        it('should verify valid token and return JWT', async () => {
            const user = await createUserFixture();
            const magicLink = await createMagicLinkFixture({
                userId: user._id.toString(),
                email: user.email,
            });

            const response = await app.handle(
                new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.accessToken).toBeDefined();
            expect(data.user.email).toBe(user.email);
        });

        it('should return 401 for invalid token', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/auth/verify?token=invalid-token'),
            );

            expect(response.status).toBe(401);
            const data = await response.json();
            expect(data.error).toBe('Invalid or expired token');
        });

        it('should return 401 for expired token', async () => {
            const user = await createUserFixture();
            const magicLink = await createMagicLinkFixture({
                userId: user._id.toString(),
                email: user.email,
                expiresAt: new Date(Date.now() - 1000),
            });

            const response = await app.handle(
                new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
            );

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/auth/me', () => {
        it('should return user for valid JWT', async () => {
            const user = await createUserFixture();
            const magicLink = await createMagicLinkFixture({
                userId: user._id.toString(),
                email: user.email,
            });

            // First get a token
            const verifyResponse = await app.handle(
                new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
            );
            const { accessToken } = await verifyResponse.json();

            // Then use it to get user info
            const response = await app.handle(
                new Request('http://localhost/api/auth/me', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.user.email).toBe(user.email);
        });

        it('should return 401 without auth header', async () => {
            const response = await app.handle(new Request('http://localhost/api/auth/me'));

            expect(response.status).toBe(401);
        });

        it('should return 401 with invalid token', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/auth/me', {
                    headers: { Authorization: 'Bearer invalid-token' },
                }),
            );

            expect(response.status).toBe(401);
        });
    });

    describe('POST /api/auth/logout', () => {
        it('should return success message', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/auth/logout', {
                    method: 'POST',
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.message).toBe('Logged out successfully');
        });
    });

    describe('GET /api/auth/passkeys', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(new Request('http://localhost/api/auth/passkeys'));

            expect(response.status).toBe(401);
        });

        it('should return empty array for user without passkeys', async () => {
            const user = await createUserFixture();
            const magicLink = await createMagicLinkFixture({
                userId: user._id.toString(),
                email: user.email,
            });

            const verifyResponse = await app.handle(
                new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
            );
            const { accessToken } = await verifyResponse.json();

            const response = await app.handle(
                new Request('http://localhost/api/auth/passkeys', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.passkeys).toEqual([]);
        });
    });

    describe('POST /api/auth/passkey/login/start', () => {
        it('should return authentication options', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/auth/passkey/login/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.challenge).toBeDefined();
            expect(data.rpId).toBeDefined();
        });
    });
});
