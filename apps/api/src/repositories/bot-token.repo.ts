import { ObjectId, Collection, Binary } from 'mongodb';
import { randomBytes } from 'crypto';
import { getDb } from '../db/client';

/**
 * Bot Access Token - allows external services to access the API
 */
interface BotAccessTokenDocument {
    _id: ObjectId;
    userBotId: ObjectId; // Links to user_bots collection
    userId: ObjectId; // Token owner
    tokenHash: Binary; // bcrypt hash (never store plaintext)
    name: string; // Human-readable name (e.g., "Home Assistant", "Zapier")
    permissions: Array<'read' | 'write' | 'invoke'>;
    notebookScope: string[]; // Limit to specific notebook IDs (empty = all user's notebooks)
    lastUsedAt: Date | null;
    expiresAt: Date | null; // Optional expiration
    createdAt: Date;
}

/**
 * Public token representation (for API responses)
 */
export interface BotAccessToken {
    _id: string;
    userBotId: string;
    userId: string;
    name: string;
    permissions: Array<'read' | 'write' | 'invoke'>;
    notebookScope: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
}

/**
 * Input for creating a new token
 */
export interface CreateBotTokenInput {
    userBotId: string;
    userId: string;
    name: string;
    permissions: Array<'read' | 'write' | 'invoke'>;
    notebookScope?: string[];
    expiresAt?: Date;
}

/**
 * Internal token data (includes hash for verification)
 */
export interface BotAccessTokenInternal extends BotAccessToken {
    tokenHash: Uint8Array;
}

function getCollection(): Collection<BotAccessTokenDocument> {
    return getDb().collection<BotAccessTokenDocument>('bot_access_tokens');
}

/**
 * Convert document to public token representation
 */
function toPublicToken(doc: BotAccessTokenDocument): BotAccessToken {
    return {
        _id: doc._id.toString(),
        userBotId: doc.userBotId.toString(),
        userId: doc.userId.toString(),
        name: doc.name,
        permissions: doc.permissions,
        notebookScope: doc.notebookScope,
        lastUsedAt: doc.lastUsedAt?.toISOString() || null,
        expiresAt: doc.expiresAt?.toISOString() || null,
        createdAt: doc.createdAt.toISOString(),
    };
}

/**
 * Convert document to internal token (with hash for verification)
 */
function toInternalToken(doc: BotAccessTokenDocument): BotAccessTokenInternal {
    return {
        ...toPublicToken(doc),
        tokenHash: new Uint8Array(doc.tokenHash.buffer),
    };
}

/**
 * Generate a random token string
 * Returns: 32-byte random token as base64url string (43 chars)
 */
export function generateTokenString(): string {
    const bytes = randomBytes(32);
    // Convert to base64url (URL-safe base64)
    return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Hash a token for storage using SHA-256
 * We use SHA-256 instead of bcrypt because:
 * 1. Tokens are random and high-entropy (unlike passwords)
 * 2. Fast verification is important for API performance
 */
export async function hashToken(token: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}

/**
 * Create a new bot access token
 * Returns the plaintext token - this is the only time it's available!
 */
export async function createBotToken(
    input: CreateBotTokenInput,
): Promise<{ token: BotAccessToken; plaintextToken: string }> {
    // Generate the plaintext token
    const plaintextToken = generateTokenString();

    // Hash for storage
    const tokenHash = await hashToken(plaintextToken);

    const doc: BotAccessTokenDocument = {
        _id: new ObjectId(),
        userBotId: new ObjectId(input.userBotId),
        userId: new ObjectId(input.userId),
        tokenHash: new Binary(tokenHash),
        name: input.name,
        permissions: input.permissions,
        notebookScope: input.notebookScope || [],
        lastUsedAt: null,
        expiresAt: input.expiresAt || null,
        createdAt: new Date(),
    };

    await getCollection().insertOne(doc);

    return {
        token: toPublicToken(doc),
        plaintextToken, // Return only once!
    };
}

/**
 * Find all tokens for a user bot (for listing - no hashes)
 */
export async function findTokensByUserBotId(userBotId: string): Promise<BotAccessToken[]> {
    try {
        const docs = await getCollection()
            .find({ userBotId: new ObjectId(userBotId) })
            .toArray();
        return docs.map(toPublicToken);
    } catch {
        return [];
    }
}

/**
 * Find a token by ID
 */
export async function findTokenById(tokenId: string): Promise<BotAccessToken | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(tokenId) });
        return doc ? toPublicToken(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find token by hash (for authentication)
 * Returns internal token with hash for verification
 */
export async function findTokenByHash(
    tokenHash: Uint8Array,
): Promise<BotAccessTokenInternal | null> {
    try {
        const doc = await getCollection().findOne({
            tokenHash: new Binary(tokenHash),
        });
        return doc ? toInternalToken(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Verify a token and return the token data if valid
 */
export async function verifyToken(plaintextToken: string): Promise<BotAccessTokenInternal | null> {
    try {
        // Hash the provided token
        const tokenHash = await hashToken(plaintextToken);

        // Look up by hash
        const token = await findTokenByHash(tokenHash);
        if (!token) {
            return null;
        }

        // Check expiration
        if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
            return null;
        }

        // Update last used timestamp (non-blocking)
        updateLastUsed(token._id).catch(() => {});

        return token;
    } catch {
        return null;
    }
}

/**
 * Update the lastUsedAt timestamp
 */
export async function updateLastUsed(tokenId: string): Promise<void> {
    try {
        await getCollection().updateOne(
            { _id: new ObjectId(tokenId) },
            { $set: { lastUsedAt: new Date() } },
        );
    } catch {
        // Silent fail - not critical
    }
}

/**
 * Delete a token
 */
export async function deleteToken(tokenId: string, userId: string): Promise<boolean> {
    try {
        const result = await getCollection().deleteOne({
            _id: new ObjectId(tokenId),
            userId: new ObjectId(userId), // Ensure user owns the token
        });
        return result.deletedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Delete all tokens for a user bot
 */
export async function deleteTokensByUserBotId(userBotId: string): Promise<number> {
    try {
        const result = await getCollection().deleteMany({
            userBotId: new ObjectId(userBotId),
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}

/**
 * Check if a token has permission for a specific action
 */
export function hasPermission(
    token: BotAccessToken | BotAccessTokenInternal,
    permission: 'read' | 'write' | 'invoke',
): boolean {
    return token.permissions.includes(permission);
}

/**
 * Check if a token can access a specific notebook
 */
export function canAccessNotebook(
    token: BotAccessToken | BotAccessTokenInternal,
    notebookId: string,
): boolean {
    // Empty scope means access to all notebooks the bot is shared with
    if (token.notebookScope.length === 0) {
        return true;
    }
    return token.notebookScope.includes(notebookId);
}
