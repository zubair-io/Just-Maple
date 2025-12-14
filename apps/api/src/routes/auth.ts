import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { findOrCreateUser, findUserById, findUserByEmail } from '../repositories/user.repo';
import { createMagicLink, validateAndConsumeMagicLink } from '../repositories/magic-link.repo';
import {
    createPasskey,
    findPasskeyByCredentialId,
    findPasskeysByUserId,
    updatePasskeyCounter,
    getAllCredentialIdsForUser,
} from '../repositories/passkey.repo';
import { sendMagicLinkEmail } from '../services/email';
import { config } from '../config';
import type { JWTPayload, UserResponse } from '@maple/shared';

// Store challenges temporarily (in production, use Redis or DB)
const challengeStore = new Map<string, string>();

// Helper to verify JWT and get user
async function verifyAndGetUser(
    jwtVerify: (token: string) => Promise<JWTPayload | false>,
    authHeader: string | null,
): Promise<UserResponse | null> {
    if (!authHeader?.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.slice(7);

    try {
        const payload = (await jwtVerify(token)) as JWTPayload | false;
        if (!payload) return null;

        const user = await findUserById(payload.sub);
        return user;
    } catch {
        return null;
    }
}

export const authRoutes = new Elysia({ prefix: '/api/auth' })
    .use(
        jwt({
            name: 'jwt',
            secret: config.jwtSecret,
            exp: config.jwtExpiresIn,
        }),
    )

    // Request magic link
    .post(
        '/magic-link',
        async ({ body, set, request }) => {
            try {
                const { email } = body;

                // Find or create user
                const user = await findOrCreateUser(email);

                // Create magic link
                const token = await createMagicLink(user._id, email);

                // Get base URL from request origin or use default
                const origin = request.headers.get('origin') || 'http://localhost:4200';

                // Send magic link email (logs to console in dev)
                await sendMagicLinkEmail({ email, token, baseUrl: origin });

                const response: { message: string; devToken?: string } = {
                    message: 'Magic link sent to your email',
                };

                // In dev mode, include the token for easy testing
                if (config.isDev) {
                    response.devToken = token;
                }

                return response;
            } catch (error) {
                console.error('Magic link error:', error);
                set.status = 500;
                return { error: 'Failed to send magic link' };
            }
        },
        {
            body: t.Object({
                email: t.String({ format: 'email' }),
            }),
        },
    )

    // Verify magic link and return JWT
    .get(
        '/verify',
        async ({ query, jwt, set }) => {
            try {
                const { token } = query;

                if (!token) {
                    set.status = 400;
                    return { error: 'Token is required' };
                }

                // Validate and consume the magic link
                const result = await validateAndConsumeMagicLink(token);

                if (!result) {
                    set.status = 401;
                    return { error: 'Invalid or expired token' };
                }

                // Get the user
                const user = await findUserById(result.userId);

                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                // Generate JWT
                const accessToken = await jwt.sign({
                    sub: user._id,
                    email: user.email,
                });

                return {
                    accessToken,
                    user: {
                        _id: user._id,
                        email: user.email,
                        displayName: user.displayName,
                    },
                };
            } catch (error) {
                console.error('Verify error:', error);
                set.status = 500;
                return { error: 'Verification failed' };
            }
        },
        {
            query: t.Object({
                token: t.String(),
            }),
        },
    )

    // Get current user (requires auth)
    .get('/me', async ({ jwt, request, set }) => {
        const user = await verifyAndGetUser(
            (token) => jwt.verify(token) as Promise<JWTPayload | false>,
            request.headers.get('authorization'),
        );

        if (!user) {
            set.status = 401;
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        return { user };
    })

    // Logout (client should clear token)
    .post('/logout', () => {
        // Server-side logout is a no-op for JWT
        // Client should clear the token
        return { message: 'Logged out successfully' };
    })

    // ============ PASSKEY ROUTES ============

    // Start passkey registration (requires auth)
    .post('/passkey/register/start', async ({ jwt, request, set }) => {
        const user = await verifyAndGetUser(
            (token) => jwt.verify(token) as Promise<JWTPayload | false>,
            request.headers.get('authorization'),
        );

        if (!user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        try {
            // Get existing credentials to exclude
            const existingCredentials = await getAllCredentialIdsForUser(user._id);

            const options = await generateRegistrationOptions({
                rpName: config.rpName,
                rpID: config.rpID,
                userName: user.email,
                userDisplayName: user.displayName || user.email,
                attestationType: 'none',
                excludeCredentials: existingCredentials.map((id) => ({
                    id: Buffer.from(id, 'base64url'),
                    type: 'public-key' as const,
                })),
                authenticatorSelection: {
                    residentKey: 'preferred',
                    userVerification: 'preferred',
                },
            });

            // Store challenge for verification
            challengeStore.set(user._id, options.challenge);

            return options;
        } catch (error) {
            console.error('Passkey registration start error:', error);
            set.status = 500;
            return { error: 'Failed to start registration' };
        }
    })

    // Finish passkey registration
    .post(
        '/passkey/register/finish',
        async ({ body, jwt, request, set }) => {
            const user = await verifyAndGetUser(
                (token) => jwt.verify(token) as Promise<JWTPayload | false>,
                request.headers.get('authorization'),
            );

            if (!user) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const expectedChallenge = challengeStore.get(user._id);
            if (!expectedChallenge) {
                set.status = 400;
                return { error: 'No challenge found. Start registration first.' };
            }

            try {
                const verification = await verifyRegistrationResponse({
                    response: body,
                    expectedChallenge,
                    expectedOrigin: config.origin,
                    expectedRPID: config.rpID,
                });

                if (!verification.verified || !verification.registrationInfo) {
                    set.status = 400;
                    return { error: 'Verification failed' };
                }

                const { credential, credentialDeviceType, credentialBackedUp } =
                    verification.registrationInfo;

                // Store the credential
                const passkey = await createPasskey({
                    userId: user._id,
                    credentialId: Buffer.from(credential.id).toString('base64url'),
                    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                    counter: credential.counter,
                    transports: body.response.transports as
                        | AuthenticatorTransportFuture[]
                        | undefined,
                    deviceType: credentialDeviceType,
                    backedUp: credentialBackedUp,
                });

                // Clean up challenge
                challengeStore.delete(user._id);

                return {
                    verified: true,
                    passkey: {
                        id: passkey.id,
                        visibleId: passkey.visibleId,
                        createdAt: passkey.createdAt,
                    },
                };
            } catch (error) {
                console.error('Passkey registration finish error:', error);
                set.status = 500;
                return { error: 'Failed to complete registration' };
            }
        },
        {
            body: t.Any(),
        },
    )

    // Start passkey login
    .post(
        '/passkey/login/start',
        async ({ body, set }) => {
            try {
                let allowCredentials: { id: Uint8Array; type: 'public-key' }[] | undefined;

                // If email provided, only allow that user's credentials
                if (body?.email) {
                    const user = await findUserByEmail(body.email);
                    if (user) {
                        const credentials = await getAllCredentialIdsForUser(user._id);
                        allowCredentials = credentials.map((id) => ({
                            id: Buffer.from(id, 'base64url'),
                            type: 'public-key' as const,
                        }));
                    }
                }

                const options = await generateAuthenticationOptions({
                    rpID: config.rpID,
                    userVerification: 'preferred',
                    allowCredentials,
                });

                // Store challenge with a temporary ID (use challenge itself)
                challengeStore.set(`login:${options.challenge}`, options.challenge);

                return options;
            } catch (error) {
                console.error('Passkey login start error:', error);
                set.status = 500;
                return { error: 'Failed to start login' };
            }
        },
        {
            body: t.Optional(
                t.Object({
                    email: t.Optional(t.String({ format: 'email' })),
                }),
            ),
        },
    )

    // Finish passkey login
    .post(
        '/passkey/login/finish',
        async ({ body, jwt, set }) => {
            try {
                // Find the passkey by credential ID
                const credentialId = Buffer.from(body.id, 'base64url').toString('base64url');
                const passkey = await findPasskeyByCredentialId(credentialId);

                if (!passkey) {
                    set.status = 401;
                    return { error: 'Passkey not found' };
                }

                // Get the challenge from the client data
                const clientDataJSON = JSON.parse(
                    Buffer.from(body.response.clientDataJSON, 'base64url').toString(),
                );
                const expectedChallenge = clientDataJSON.challenge;

                if (!challengeStore.has(`login:${expectedChallenge}`)) {
                    set.status = 400;
                    return { error: 'Invalid or expired challenge' };
                }

                const verification = await verifyAuthenticationResponse({
                    response: body,
                    expectedChallenge,
                    expectedOrigin: config.origin,
                    expectedRPID: config.rpID,
                    credential: {
                        id: Buffer.from(passkey.credentialId, 'base64url'),
                        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
                        counter: passkey.counter,
                        transports: passkey.transports,
                    },
                });

                if (!verification.verified) {
                    set.status = 401;
                    return { error: 'Authentication failed' };
                }

                // Update counter
                await updatePasskeyCounter(
                    passkey.credentialId,
                    verification.authenticationInfo.newCounter,
                );

                // Clean up challenge
                challengeStore.delete(`login:${expectedChallenge}`);

                // Get user and generate JWT
                const user = await findUserById(passkey.userId);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                const accessToken = await jwt.sign({
                    sub: user._id,
                    email: user.email,
                });

                return {
                    verified: true,
                    accessToken,
                    user: {
                        _id: user._id,
                        email: user.email,
                        displayName: user.displayName,
                    },
                };
            } catch (error) {
                console.error('Passkey login finish error:', error);
                set.status = 500;
                return { error: 'Failed to complete login' };
            }
        },
        {
            body: t.Any(),
        },
    )

    // Get user's passkeys (requires auth)
    .get('/passkeys', async ({ jwt, request, set }) => {
        const user = await verifyAndGetUser(
            (token) => jwt.verify(token) as Promise<JWTPayload | false>,
            request.headers.get('authorization'),
        );

        if (!user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const passkeys = await findPasskeysByUserId(user._id);
        return {
            passkeys: passkeys.map((p) => ({
                id: p.id,
                visibleId: p.visibleId,
                deviceType: p.deviceType,
                backedUp: p.backedUp,
                createdAt: p.createdAt,
            })),
        };
    });
