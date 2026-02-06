import { ObjectId, Collection, Binary } from 'mongodb';
import { randomBytes } from 'crypto';
import { getDb } from '../db/client';

/**
 * Bot Auth Token - long-lived, revocable, reusable token for bot authentication.
 * Bots exchange this for short-lived JWTs via POST /api/bots/login.
 */
interface BotAuthTokenDocument {
    _id: ObjectId;
    userBotId: ObjectId;
    userId: ObjectId;
    tokenHash: Binary; // SHA-256 hash (never store plaintext)
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
}

/**
 * Public token representation (for API responses)
 */
export interface BotAuthToken {
    _id: string;
    userBotId: string;
    userId: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

function getCollection(): Collection<BotAuthTokenDocument> {
    return getDb().collection<BotAuthTokenDocument>('bot_auth_tokens');
}

function toPublicToken(doc: BotAuthTokenDocument): BotAuthToken {
    return {
        _id: doc._id.toString(),
        userBotId: doc.userBotId.toString(),
        userId: doc.userId.toString(),
        createdAt: doc.createdAt.toISOString(),
        lastUsedAt: doc.lastUsedAt?.toISOString() || null,
        revokedAt: doc.revokedAt?.toISOString() || null,
    };
}

/**
 * Generate a random bot token string.
 * Format: bot_<32 bytes as base64url>
 */
function generateBotTokenString(): string {
    const bytes = randomBytes(32);
    const base64 = bytes
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `bot_${base64}`;
}

/**
 * Hash a token for storage using SHA-256
 */
async function hashToken(token: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}

/**
 * Create a new bot auth token.
 * Returns the plaintext token — this is the only time it's available!
 */
export async function createBotToken(
    userBotId: string,
    userId: string,
): Promise<{ token: BotAuthToken; plaintextToken: string }> {
    const plaintextToken = generateBotTokenString();
    const tokenHash = await hashToken(plaintextToken);

    const doc: BotAuthTokenDocument = {
        _id: new ObjectId(),
        userBotId: new ObjectId(userBotId),
        userId: new ObjectId(userId),
        tokenHash: new Binary(tokenHash),
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
    };

    await getCollection().insertOne(doc);

    return {
        token: toPublicToken(doc),
        plaintextToken,
    };
}

/**
 * Verify a bot token and return the associated bot/user info if valid.
 * Updates lastUsedAt on success.
 */
export async function verifyBotToken(
    plaintextToken: string,
): Promise<{ userBotId: string; userId: string } | null> {
    try {
        if (!plaintextToken.startsWith('bot_')) {
            return null;
        }

        const tokenHash = await hashToken(plaintextToken);

        const doc = await getCollection().findOneAndUpdate(
            {
                tokenHash: new Binary(tokenHash),
                revokedAt: null,
            },
            { $set: { lastUsedAt: new Date() } },
            { returnDocument: 'after' },
        );

        if (!doc) {
            return null;
        }

        return {
            userBotId: doc.userBotId.toString(),
            userId: doc.userId.toString(),
        };
    } catch {
        return null;
    }
}

/**
 * Revoke a specific bot token by ID.
 */
export async function revokeBotToken(tokenId: string): Promise<boolean> {
    try {
        const result = await getCollection().updateOne(
            { _id: new ObjectId(tokenId) },
            { $set: { revokedAt: new Date() } },
        );
        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Revoke all bot tokens for a given bot.
 */
export async function revokeAllBotTokens(userBotId: string): Promise<number> {
    try {
        const result = await getCollection().updateMany(
            { userBotId: new ObjectId(userBotId), revokedAt: null },
            { $set: { revokedAt: new Date() } },
        );
        return result.modifiedCount;
    } catch {
        return 0;
    }
}

/**
 * Revoke all existing tokens and create a new one.
 * Returns the new plaintext token.
 */
export async function regenerateBotToken(
    userBotId: string,
    userId: string,
): Promise<{ token: BotAuthToken; plaintextToken: string }> {
    await revokeAllBotTokens(userBotId);
    return createBotToken(userBotId, userId);
}
