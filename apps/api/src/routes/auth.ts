import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import {
    findUserById,
    updateUserDisplayName,
    updateUserProfilePicture,
} from '../repositories/user.repo';
import {
    createPasskey,
    findPasskeyByCredentialId,
    findPasskeysByUserId,
    updatePasskeyCounter,
    getAllCredentialIdsForUser,
} from '../repositories/passkey.repo';
import {
    consumePasskeyChallenge,
    savePasskeyChallenge,
} from '../repositories/passkey-challenge.repo';
import { getDb } from '../db/client';
import { ObjectId } from 'mongodb';
import { config } from '../config';
import type { JWTPayload, UserResponse } from '@maple/shared';
import { uploadProfilePicture } from '../services/storage.service';

// The challenge is signed into clientDataJSON by the authenticator.
function responseChallenge(body: { response: { clientDataJSON: string } }): string {
    const challenge = JSON.parse(
        Buffer.from(body.response.clientDataJSON, 'base64url').toString(),
    ).challenge;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(challenge))
        throw new Error('Invalid challenge');
    return challenge;
}

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

    // Local development can import an existing signed session without WebAuthn.
    .post(
        '/dev-token',
        async ({ body, jwt, request, set }) => {
            let hostname: string;
            try {
                hostname = new URL(request.headers.get('origin') || request.url).hostname;
            } catch {
                set.status = 404;
                return { error: 'Not found' };
            }
            if (!config.isDev || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
                set.status = 404;
                return { error: 'Not found' };
            }
            const user = await verifyAndGetUser(
                (token) => jwt.verify(token) as Promise<JWTPayload | false>,
                `Bearer ${body.token.trim()}`,
            );
            if (!user?.email || user.email.toLowerCase() !== body.email.trim().toLowerCase()) {
                set.status = 401;
                return { error: 'Email or development token is invalid or expired' };
            }
            return { accessToken: await jwt.sign({ sub: user._id }), user };
        },
        {
            body: t.Object({
                email: t.String({ minLength: 1, maxLength: 254 }),
                token: t.String({ minLength: 1, maxLength: 8192 }),
            }),
        },
    )

    // New accounts have no email identity. Create the user only after WebAuthn verification.
    .post(
        '/passkey/signup/start',
        async ({ body, set }) => {
            const displayName = body.displayName.trim();
            if (!displayName) {
                set.status = 400;
                return { error: 'Display name is required' };
            }
            const userId = new ObjectId().toString();
            const options = await generateRegistrationOptions({
                rpName: config.rpName,
                rpID: config.rpID,
                userID: new TextEncoder().encode(userId),
                userName: displayName,
                userDisplayName: displayName,
                attestationType: 'none',
                authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            });
            await savePasskeyChallenge(options.challenge, { kind: 'signup', userId, displayName });
            return options;
        },
        { body: t.Object({ displayName: t.String({ minLength: 1, maxLength: 80 }) }) },
    )
    .post(
        '/passkey/signup/finish',
        async ({ body, jwt, set }) => {
            try {
                const challenge = await consumePasskeyChallenge(responseChallenge(body), 'signup');
                if (!challenge?.userId || !challenge.displayName) {
                    set.status = 400;
                    return { error: 'Invalid or expired challenge' };
                }
                const verification = await verifyRegistrationResponse({
                    response: body,
                    expectedChallenge: challenge._id,
                    expectedOrigin: config.passkeyOrigins,
                    expectedRPID: config.rpID,
                    requireUserVerification: true,
                });
                if (!verification.verified || !verification.registrationInfo) {
                    set.status = 400;
                    return { error: 'Passkey verification failed' };
                }
                const { credential, credentialDeviceType, credentialBackedUp } =
                    verification.registrationInfo;
                // Never attach a new account to an existing credential or display name.
                const passkey = await createPasskey({
                    userId: challenge.userId,
                    credentialId: credential.id,
                    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                    counter: credential.counter,
                    transports: credential.transports,
                    deviceType: credentialDeviceType,
                    backedUp: credentialBackedUp,
                });
                let user: UserResponse;
                try {
                    const now = new Date();
                    await getDb()
                        .collection('users')
                        .insertOne({
                            _id: new ObjectId(challenge.userId),
                            displayName: challenge.displayName,
                            createdAt: now,
                            updatedAt: now,
                        });
                    user = { _id: challenge.userId, displayName: challenge.displayName };
                } catch (error) {
                    await getDb()
                        .collection('passkeys')
                        .deleteOne({ _id: new ObjectId(passkey.id) });
                    throw error;
                }
                return { accessToken: await jwt.sign({ sub: user._id }), user };
            } catch {
                set.status = 400;
                return { error: 'Could not create account. Please try again.' };
            }
        },
        { body: t.Any() },
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

    // Refresh token (extends session by 14 days)
    .post('/refresh', async ({ jwt, request, set }) => {
        const user = await verifyAndGetUser(
            (token) => jwt.verify(token) as Promise<JWTPayload | false>,
            request.headers.get('authorization'),
        );

        if (!user) {
            set.status = 401;
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        // Generate new JWT with fresh 14-day expiration
        const accessToken = await jwt.sign({
            sub: user._id,
        });

        return {
            accessToken,
            user: {
                _id: user._id,
                displayName: user.displayName,
                profilePictureUrl: user.profilePictureUrl,
                admin: user.admin,
            },
        };
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
                userName: user.displayName || user._id,
                userDisplayName: user.displayName || user._id,
                userID: new TextEncoder().encode(user._id),
                attestationType: 'none',
                excludeCredentials: existingCredentials.map((id) => ({
                    id,
                    type: 'public-key' as const,
                })),
                authenticatorSelection: {
                    residentKey: 'required',
                    userVerification: 'required',
                },
            });

            // Store challenge for verification
            await savePasskeyChallenge(options.challenge, { kind: 'register', userId: user._id });

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

            let expectedChallenge: string | undefined;
            try {
                expectedChallenge = (
                    await consumePasskeyChallenge(responseChallenge(body), 'register', user._id)
                )?._id;
            } catch {
                /* Malformed client data is rejected below. */
            }
            if (!expectedChallenge) {
                set.status = 400;
                return { error: 'No challenge found. Start registration first.' };
            }

            try {
                const verification = await verifyRegistrationResponse({
                    response: body,
                    expectedChallenge,
                    expectedOrigin: config.passkeyOrigins,
                    expectedRPID: config.rpID,
                    requireUserVerification: true,
                });

                if (!verification.verified || !verification.registrationInfo) {
                    set.status = 400;
                    return { error: 'Verification failed' };
                }

                const { credential, credentialDeviceType, credentialBackedUp } =
                    verification.registrationInfo;

                // Store the credential
                // Use the verified base64url credential ID.
                const storedCredentialId = credential.id;

                const passkey = await createPasskey({
                    userId: user._id,
                    credentialId: storedCredentialId,
                    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                    counter: credential.counter,
                    transports: body.response.transports as
                        | AuthenticatorTransportFuture[]
                        | undefined,
                    deviceType: credentialDeviceType,
                    backedUp: credentialBackedUp,
                });

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
    .post('/passkey/login/start', async ({ set }) => {
        try {
            const options = await generateAuthenticationOptions({
                rpID: config.rpID,
                userVerification: 'required',
            });

            // Persist a short-lived, single-use challenge.
            await savePasskeyChallenge(options.challenge, { kind: 'login' });

            return options;
        } catch (error) {
            console.error('Passkey login start error:', error);
            set.status = 500;
            return { error: 'Failed to start login' };
        }
    })

    // Finish passkey login
    .post(
        '/passkey/login/finish',
        async ({ body, jwt, set }) => {
            try {
                // Find the passkey by credential ID
                // body.id is already base64url encoded from the client
                const credentialId = body.id;
                if (
                    typeof credentialId !== 'string' ||
                    !/^[A-Za-z0-9_-]+={0,2}$/.test(credentialId)
                ) {
                    set.status = 400;
                    return { error: 'Invalid passkey response' };
                }

                let passkey = await findPasskeyByCredentialId(credentialId);

                // If not found, try normalizing the base64url (some browsers add padding)
                if (!passkey) {
                    // Try with padding removed
                    const normalizedId = credentialId.replace(/=/g, '');
                    passkey = await findPasskeyByCredentialId(normalizedId);
                }

                if (!passkey) {
                    set.status = 401;
                    return { error: 'Passkey not found' };
                }

                // Get the challenge from the client data
                const expectedChallenge = responseChallenge(body);

                if (!(await consumePasskeyChallenge(expectedChallenge, 'login'))) {
                    set.status = 400;
                    return { error: 'Invalid or expired challenge' };
                }

                const verification = await verifyAuthenticationResponse({
                    response: body,
                    expectedChallenge,
                    expectedOrigin: config.passkeyOrigins,
                    expectedRPID: config.rpID,
                    credential: {
                        id: passkey.credentialId,
                        publicKey: Buffer.from(passkey.publicKey, 'base64url'),
                        counter: passkey.counter,
                        transports: passkey.transports,
                    },
                    // Require biometric/PIN verification for passkey-only sign-in.
                    requireUserVerification: true,
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

                // Get user and generate JWT
                const user = await findUserById(passkey.userId);
                if (!user) {
                    set.status = 401;
                    return { error: 'User not found' };
                }

                const accessToken = await jwt.sign({
                    sub: user._id,
                });

                return {
                    verified: true,
                    accessToken,
                    user: {
                        _id: user._id,
                        displayName: user.displayName,
                        admin: user.admin,
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
    })
    .patch(
        '/me',
        async ({ jwt, request, set, body }) => {
            const user = await verifyAndGetUser(
                (token) => jwt.verify(token) as Promise<JWTPayload | false>,
                request.headers.get('authorization'),
            );

            if (!user) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const updatedUser = await updateUserDisplayName(user._id, body.displayName);

            if (!updatedUser) {
                set.status = 500;
                return { error: 'Failed to update user' };
            }

            return { user: updatedUser };
        },
        {
            body: t.Object({
                displayName: t.Optional(t.String()),
            }),
        },
    )
    .post('/me/profile-picture', async ({ jwt, request, set }) => {
        const user = await verifyAndGetUser(
            (token) => jwt.verify(token) as Promise<JWTPayload | false>,
            request.headers.get('authorization'),
        );

        if (!user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        try {
            // Get the uploaded file from the request
            const contentType = request.headers.get('content-type') || '';

            // Check if it's a valid image type
            if (!contentType.startsWith('image/')) {
                set.status = 400;
                return { error: 'Only image files are allowed' };
            }

            // Read the file buffer
            const arrayBuffer = await request.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Check file size (max 5MB)
            if (buffer.length > 5 * 1024 * 1024) {
                set.status = 400;
                return { error: 'Image must be less than 5MB' };
            }

            // Upload to blob storage (processes image: strips metadata, creates thumbnail)
            const profilePictures = await uploadProfilePicture(user._id, buffer);

            // Update user with new profile picture URLs
            const updatedUser = await updateUserProfilePicture(user._id, profilePictures);

            if (!updatedUser) {
                set.status = 500;
                return { error: 'Failed to update profile picture' };
            }

            return { user: updatedUser };
        } catch (error) {
            console.error('Profile picture upload error:', error);
            set.status = 500;
            return { error: 'Failed to upload profile picture' };
        }
    });
