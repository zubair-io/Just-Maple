import { ObjectId, Collection, Binary } from 'mongodb';
import { randomBytes } from 'crypto';
import { getDb } from '../db/client';

/**
 * Bot Provisioning Token - one-time token shown when creating a custom bot
 * Bot developers use this to exchange for a JWT
 */
interface BotProvisioningTokenDocument {
    _id: ObjectId;
    userBotId: ObjectId;
    userId: ObjectId;
    tokenHash: Binary; // SHA-256 hash (never store plaintext)
    createdAt: Date;
    expiresAt: Date; // 30 days default
    usedAt: Date | null; // Set when first used for login
    revoked: boolean;
}

/**
 * Public token representation (for API responses)
 */
export interface BotProvisioningToken {
    _id: string;
    userBotId: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    revoked: boolean;
}

/**
 * Internal token data (includes hash for verification)
 */
export interface BotProvisioningTokenInternal extends BotProvisioningToken {
    tokenHash: Uint8Array;
}

function getCollection(): Collection<BotProvisioningTokenDocument> {
    return getDb().collection<BotProvisioningTokenDocument>('bot_provisioning_tokens');
}

/**
 * Convert document to public token representation
 */
function toPublicToken(doc: BotProvisioningTokenDocument): BotProvisioningToken {
    return {
        _id: doc._id.toString(),
        userBotId: doc.userBotId.toString(),
        userId: doc.userId.toString(),
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
        usedAt: doc.usedAt?.toISOString() || null,
        revoked: doc.revoked,
    };
}

/**
 * Convert document to internal token (with hash for verification)
 */
function toInternalToken(doc: BotProvisioningTokenDocument): BotProvisioningTokenInternal {
    return {
        ...toPublicToken(doc),
        tokenHash: new Uint8Array(doc.tokenHash.buffer),
    };
}

/**
 * Generate a random provisioning token string
 * Format: prov_<32 bytes as base64url> (prefix helps identify token type)
 */
export function generateProvisioningTokenString(): string {
    const bytes = randomBytes(32);
    const base64 = bytes
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `prov_${base64}`;
}

/**
 * Hash a token for storage using SHA-256
 */
export async function hashToken(token: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}

/**
 * Create a new provisioning token for a custom bot
 * Returns the plaintext token - this is the only time it's available!
 */
export async function createProvisioningToken(
    userBotId: string,
    userId: string,
    expirationDays: number = 30,
): Promise<{ token: BotProvisioningToken; plaintextToken: string }> {
    // Generate the plaintext token
    const plaintextToken = generateProvisioningTokenString();

    // Hash for storage
    const tokenHash = await hashToken(plaintextToken);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expirationDays * 24 * 60 * 60 * 1000);

    const doc: BotProvisioningTokenDocument = {
        _id: new ObjectId(),
        userBotId: new ObjectId(userBotId),
        userId: new ObjectId(userId),
        tokenHash: new Binary(tokenHash),
        createdAt: now,
        expiresAt,
        usedAt: null,
        revoked: false,
    };

    await getCollection().insertOne(doc);

    return {
        token: toPublicToken(doc),
        plaintextToken, // Return only once!
    };
}

/**
 * Verify a provisioning token and return the token data if valid
 * Does NOT mark the token as used - call markTokenUsed separately
 */
export async function verifyProvisioningToken(
    plaintextToken: string,
): Promise<BotProvisioningTokenInternal | null> {
    try {
        // Validate token format
        if (!plaintextToken.startsWith('prov_')) {
            return null;
        }

        // Hash the provided token
        const tokenHash = await hashToken(plaintextToken);

        // Look up by hash
        const doc = await getCollection().findOne({
            tokenHash: new Binary(tokenHash),
        });

        if (!doc) {
            return null;
        }

        // Check if revoked
        if (doc.revoked) {
            return null;
        }

        // Check expiration
        if (doc.expiresAt < new Date()) {
            return null;
        }

        return toInternalToken(doc);
    } catch {
        return null;
    }
}

/**
 * Mark a provisioning token as used
 * Should be called after successful JWT generation
 */
export async function markTokenUsed(tokenId: string): Promise<void> {
    try {
        await getCollection().updateOne(
            { _id: new ObjectId(tokenId) },
            { $set: { usedAt: new Date() } },
        );
    } catch {
        // Silent fail - not critical
    }
}

/**
 * Revoke a specific provisioning token
 */
export async function revokeToken(tokenId: string, userId: string): Promise<boolean> {
    try {
        const result = await getCollection().updateOne(
            {
                _id: new ObjectId(tokenId),
                userId: new ObjectId(userId),
            },
            { $set: { revoked: true } },
        );
        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Revoke all provisioning tokens for a bot
 * Used when regenerating token or deleting bot
 */
export async function revokeAllTokens(userBotId: string): Promise<number> {
    try {
        const result = await getCollection().updateMany(
            { userBotId: new ObjectId(userBotId) },
            { $set: { revoked: true } },
        );
        return result.modifiedCount;
    } catch {
        return 0;
    }
}

/**
 * Find all tokens for a bot (for listing - no hashes)
 */
export async function findTokensByUserBotId(userBotId: string): Promise<BotProvisioningToken[]> {
    try {
        const docs = await getCollection()
            .find({ userBotId: new ObjectId(userBotId) })
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toPublicToken);
    } catch {
        return [];
    }
}

/**
 * Find a token by ID
 */
export async function findTokenById(tokenId: string): Promise<BotProvisioningToken | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(tokenId) });
        return doc ? toPublicToken(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Delete expired and revoked tokens (cleanup)
 */
export async function cleanupExpiredTokens(): Promise<number> {
    try {
        const result = await getCollection().deleteMany({
            $or: [{ expiresAt: { $lt: new Date() } }, { revoked: true, usedAt: { $ne: null } }],
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}
