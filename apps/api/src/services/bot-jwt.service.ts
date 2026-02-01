import * as jose from 'jose';
import { config } from '../config';
import type { BotJWTPayload } from '@maple/shared';

/**
 * Bot JWT Service
 *
 * Handles JWT generation and verification for custom bots.
 * Uses a separate secret derived from the main JWT secret to isolate bot tokens.
 */

// Derive bot secret from main JWT secret
const BOT_JWT_SECRET = new TextEncoder().encode(`bot:${config.jwtSecret}`);

// Default expiration: 12 hours
const DEFAULT_EXPIRATION_HOURS = 12;

/**
 * Generate a JWT for a custom bot
 */
export async function generateBotJWT(
    userBotId: string,
    userId: string,
    sessionId: string,
    expirationHours: number = DEFAULT_EXPIRATION_HOURS,
): Promise<{ jwt: string; expiresAt: Date }> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + expirationHours * 60 * 60) * 1000);

    const payload: BotJWTPayload = {
        sub: userBotId,
        userId,
        type: 'bot',
        sessionId,
        iat: now,
        exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const jwt = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(expiresAt)
        .sign(BOT_JWT_SECRET);

    return { jwt, expiresAt };
}

/**
 * Verify a bot JWT and return the payload if valid
 */
export async function verifyBotJWT(token: string): Promise<BotJWTPayload | null> {
    try {
        const { payload } = await jose.jwtVerify(token, BOT_JWT_SECRET, {
            algorithms: ['HS256'],
        });

        // Validate that this is a bot JWT
        if (payload.type !== 'bot') {
            return null;
        }

        // Validate required fields
        if (
            typeof payload.sub !== 'string' ||
            typeof payload.userId !== 'string' ||
            typeof payload.sessionId !== 'string'
        ) {
            return null;
        }

        return {
            sub: payload.sub,
            userId: payload.userId as string,
            type: 'bot',
            sessionId: payload.sessionId as string,
            iat: payload.iat as number,
            exp: payload.exp as number,
        };
    } catch {
        return null;
    }
}

/**
 * Decode a bot JWT without verifying (for debugging/logging)
 */
export function decodeBotJWT(token: string): BotJWTPayload | null {
    try {
        const payload = jose.decodeJwt(token);

        if (payload.type !== 'bot') {
            return null;
        }

        return {
            sub: payload.sub as string,
            userId: payload.userId as string,
            type: 'bot',
            sessionId: payload.sessionId as string,
            iat: payload.iat as number,
            exp: payload.exp as number,
        };
    } catch {
        return null;
    }
}

/**
 * Check if a JWT is close to expiring (within threshold)
 */
export function isJWTExpiringSoon(payload: BotJWTPayload, thresholdMinutes: number = 30): boolean {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp - now;
    return expiresIn < thresholdMinutes * 60;
}

/**
 * Get remaining time until JWT expires (in seconds)
 */
export function getJWTRemainingTime(payload: BotJWTPayload): number {
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, payload.exp - now);
}
