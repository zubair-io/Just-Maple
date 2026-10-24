import { afterEach, describe, expect, it, vi } from 'vitest';
import { Elysia } from 'elysia';
import { SignJWT } from 'jose';
import { authRoutes } from '../auth';
import { config } from '../../config';
import { mongoAvailable } from '../../__tests__/setup';
import { createUserFixture, createAuthToken } from '../../__tests__/helpers/fixtures';

describe.runIf(mongoAvailable)('Development token login', () => {
    const app = new Elysia().use(authRoutes);
    afterEach(() => vi.unstubAllEnvs());
    const login = (email: string, token: string, origin = 'http://localhost:4200') =>
        app.handle(
            new Request('http://localhost/api/auth/dev-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: origin },
                body: JSON.stringify({ email, token }),
            }),
        );
    it('accepts a signed token for the matching existing email and returns a usable session', async () => {
        const user = await createUserFixture();
        const response = await login(
            ` ${user.email.toUpperCase()} `,
            await createAuthToken(user._id.toString()),
        );
        expect(response.status).toBe(200);
        const session = await response.json();
        expect(session.user._id).toBe(user._id.toString());
        const me = await app.handle(
            new Request('http://localhost/api/auth/me', {
                headers: { Authorization: `Bearer ${session.accessToken}` },
            }),
        );
        expect(me.status).toBe(200);
    });
    it('rejects an invalid token and an email belonging to a different account', async () => {
        const user = await createUserFixture();
        expect((await login(user.email, 'invalid')).status).toBe(401);
        expect(
            (await login('other@example.com', await createAuthToken(user._id.toString()))).status,
        ).toBe(401);
    });
    it('rejects expired and foreign-signed tokens', async () => {
        const user = await createUserFixture();
        const expired = await new SignJWT({ sub: user._id.toString() })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime(1)
            .sign(new TextEncoder().encode(config.jwtSecret));
        const foreign = await new SignJWT({ sub: user._id.toString() })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('1h')
            .sign(new TextEncoder().encode('different-server-secret'));
        expect((await login(user.email, expired)).status).toBe(401);
        expect((await login(user.email, foreign)).status).toBe(401);
    });
    it('is unavailable in production and on non-local browser origins', async () => {
        const user = await createUserFixture();
        const token = await createAuthToken(user._id.toString());
        expect((await login(user.email, token, 'https://justmaple.app')).status).toBe(404);
        vi.stubEnv('NODE_ENV', 'production');
        expect((await login(user.email, token)).status).toBe(404);
    });
});
