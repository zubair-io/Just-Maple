import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Elysia } from 'elysia';
import { authRoutes } from '../auth';
import { testDb, mongoAvailable } from '../../__tests__/setup';
import {
    createUserFixture,
    createAuthToken,
    createPasskeyFixture,
} from '../../__tests__/helpers/fixtures';
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';

vi.mock('@simplewebauthn/server', async (original) => ({
    ...(await original<typeof import('@simplewebauthn/server')>()),
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
}));

function credential(challenge: string, id = 'test-credential') {
    return {
        id,
        response: {
            clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url'),
        },
    };
}

describe.runIf(mongoAvailable)('Passkey authentication', () => {
    const app = new Elysia().use(authRoutes);
    const post = (path: string, body: unknown = {}, token?: string) =>
        app.handle(
            new Request(`http://localhost/api/auth${path}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(body),
            }),
        );
    beforeEach(() => vi.resetAllMocks());

    async function startSignup(displayName = 'Maple reader') {
        const response = await post('/passkey/signup/start', { displayName });
        expect(response.status).toBe(200);
        return response.json();
    }
    function registrationVerified(id = 'test-credential') {
        vi.mocked(verifyRegistrationResponse).mockResolvedValue({
            verified: true,
            registrationInfo: {
                credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
                credentialDeviceType: 'multiDevice',
                credentialBackedUp: true,
            },
        } as any);
    }

    it('creates no user until a passkey is verified; signup needs no email', async () => {
        const options = await startSignup('  Maple reader  ');
        expect(options.authenticatorSelection.residentKey).toBe('required');
        expect(options.authenticatorSelection.userVerification).toBe('required');
        expect(await testDb!.collection('users').countDocuments()).toBe(0);
        registrationVerified();
        const response = await post('/passkey/signup/finish', credential(options.challenge));
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.accessToken).toBeTruthy();
        expect(result.user.displayName).toBe('Maple reader');
        expect(result.user.email).toBeUndefined();
        const user = await testDb!.collection('users').findOne({ displayName: 'Maple reader' });
        expect(user).toBeTruthy();
        expect(user).not.toHaveProperty('email');
        expect(verifyRegistrationResponse).toHaveBeenCalledWith(
            expect.objectContaining({ requireUserVerification: true }),
        );
        expect((await post('/passkey/signup/finish', credential(options.challenge))).status).toBe(
            400,
        );
    });

    it('supports multiple accounts without email and duplicate display names', async () => {
        for (const id of ['first-key', 'second-key']) {
            const options = await startSignup();
            registrationVerified(id);
            expect(
                (await post('/passkey/signup/finish', credential(options.challenge, id))).status,
            ).toBe(200);
        }
        expect(await testDb!.collection('users').countDocuments()).toBe(2);
    });

    it('rejects whitespace names and overlong names', async () => {
        expect((await post('/passkey/signup/start', { displayName: '   ' })).status).toBe(400);
        expect((await post('/passkey/signup/start', { displayName: 'a'.repeat(81) })).status).toBe(
            422,
        );
    });

    it('rejects expired, mismatched, and malformed challenges without creating accounts', async () => {
        const options = await startSignup();
        await testDb!
            .collection('passkey_challenges')
            .updateOne({ _id: options.challenge } as any, { $set: { expiresAt: new Date(0) } });
        for (const challenge of [options.challenge, 'unknown-challenge-value', { $ne: null }]) {
            expect(
                (await post('/passkey/signup/finish', credential(challenge as any))).status,
            ).toBe(400);
        }
        expect(verifyRegistrationResponse).not.toHaveBeenCalled();
        expect(await testDb!.collection('users').countDocuments()).toBe(0);
    });

    it('consumes failed verification attempts and leaves no user', async () => {
        const options = await startSignup();
        vi.mocked(verifyRegistrationResponse).mockRejectedValue(
            new Error('Wrong origin or signature'),
        );
        expect((await post('/passkey/signup/finish', credential(options.challenge))).status).toBe(
            400,
        );
        registrationVerified();
        expect((await post('/passkey/signup/finish', credential(options.challenge))).status).toBe(
            400,
        );
        expect(await testDb!.collection('users').countDocuments()).toBe(0);
    });

    it('cannot reuse an existing credential to create another account', async () => {
        await createPasskeyFixture({ credentialId: 'test-credential' });
        const options = await startSignup();
        registrationVerified();
        expect((await post('/passkey/signup/finish', credential(options.challenge))).status).toBe(
            400,
        );
        expect(await testDb!.collection('users').countDocuments()).toBe(0);
    });

    it('requires a session to enroll additional passkeys and binds the challenge to that user', async () => {
        expect((await post('/passkey/register/start')).status).toBe(401);
        const user = await createUserFixture();
        const other = await createUserFixture();
        const token = await createAuthToken(user._id.toString());
        const options = await (await post('/passkey/register/start', {}, token)).json();
        registrationVerified();
        expect(
            (
                await post(
                    '/passkey/register/finish',
                    credential(options.challenge),
                    await createAuthToken(other._id.toString()),
                )
            ).status,
        ).toBe(400);
        expect((await post('/passkey/signup/finish', credential(options.challenge))).status).toBe(
            400,
        );
        expect(
            (await post('/passkey/register/finish', credential(options.challenge), token)).status,
        ).toBe(200);
    });

    it('signs in existing users with discoverable credentials and rejects replay', async () => {
        const user = await createUserFixture();
        await createPasskeyFixture({
            userId: user._id.toString(),
            credentialId: 'test-credential',
        });
        const options = await (await post('/passkey/login/start')).json();
        expect(options.allowCredentials ?? []).toEqual([]);
        expect(options.userVerification).toBe('required');
        vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
            verified: true,
            authenticationInfo: { newCounter: 1 },
        } as any);
        const result = await post('/passkey/login/finish', credential(options.challenge));
        expect(result.status).toBe(200);
        expect((await result.json()).user._id).toBe(user._id.toString());
        expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
            expect.objectContaining({ requireUserVerification: true }),
        );
        expect((await post('/passkey/login/finish', credential(options.challenge))).status).toBe(
            400,
        );
    });

    it('rejects authentication verification failures', async () => {
        await createPasskeyFixture({ credentialId: 'test-credential' });
        const options = await (await post('/passkey/login/start')).json();
        vi.mocked(verifyAuthenticationResponse).mockResolvedValue({ verified: false } as any);
        expect((await post('/passkey/login/finish', credential(options.challenge))).status).toBe(
            401,
        );
    });

    it('keeps existing sessions valid and removes all email login endpoints', async () => {
        const user = await createUserFixture();
        const token = await createAuthToken(user._id.toString());
        expect((await post('/refresh', {}, token)).status).toBe(200);
        expect((await post('/magic-link', { email: 'test@example.com' })).status).toBe(404);
        expect(
            (await post('/verify-code', { email: 'test@example.com', code: '123456' })).status,
        ).toBe(404);
        expect(
            (await app.handle(new Request('http://localhost/api/auth/verify?token=old'))).status,
        ).toBe(404);
    });
});
