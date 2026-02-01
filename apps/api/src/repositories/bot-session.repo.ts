import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';

/**
 * Bot Session - tracks active JWT sessions for custom bots
 */
interface BotSessionDocument {
    _id: ObjectId;
    userBotId: ObjectId;
    userId: ObjectId;
    jwtId: string; // Unique JWT identifier (used in JWT payload)
    createdAt: Date;
    expiresAt: Date;
    lastUsedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    revokedAt: Date | null;
}

/**
 * Public session representation
 */
export interface BotSession {
    _id: string;
    userBotId: string;
    userId: string;
    jwtId: string;
    createdAt: string;
    expiresAt: string;
    lastUsedAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    revokedAt: string | null;
}

/**
 * Input for creating a new session
 */
export interface CreateBotSessionInput {
    userBotId: string;
    userId: string;
    expirationHours: number;
    ipAddress?: string;
    userAgent?: string;
}

function getCollection(): Collection<BotSessionDocument> {
    return getDb().collection<BotSessionDocument>('bot_sessions');
}

/**
 * Convert document to public session representation
 */
function toPublicSession(doc: BotSessionDocument): BotSession {
    return {
        _id: doc._id.toString(),
        userBotId: doc.userBotId.toString(),
        userId: doc.userId.toString(),
        jwtId: doc.jwtId,
        createdAt: doc.createdAt.toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
        lastUsedAt: doc.lastUsedAt.toISOString(),
        ipAddress: doc.ipAddress,
        userAgent: doc.userAgent,
        revokedAt: doc.revokedAt?.toISOString() || null,
    };
}

/**
 * Generate a unique JWT ID
 */
function generateJwtId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Buffer.from(bytes).toString('hex');
}

/**
 * Create a new bot session
 * Returns the session with jwtId for JWT generation
 */
export async function createSession(input: CreateBotSessionInput): Promise<BotSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expirationHours * 60 * 60 * 1000);

    const doc: BotSessionDocument = {
        _id: new ObjectId(),
        userBotId: new ObjectId(input.userBotId),
        userId: new ObjectId(input.userId),
        jwtId: generateJwtId(),
        createdAt: now,
        expiresAt,
        lastUsedAt: now,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
        revokedAt: null,
    };

    await getCollection().insertOne(doc);
    return toPublicSession(doc);
}

/**
 * Find a session by JWT ID
 */
export async function findSessionByJwtId(jwtId: string): Promise<BotSession | null> {
    try {
        const doc = await getCollection().findOne({ jwtId });
        return doc ? toPublicSession(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Find a session by ID
 */
export async function findSessionById(sessionId: string): Promise<BotSession | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(sessionId) });
        return doc ? toPublicSession(doc) : null;
    } catch {
        return null;
    }
}

/**
 * Validate a session (not expired, not revoked)
 */
export async function validateSession(jwtId: string): Promise<BotSession | null> {
    try {
        const doc = await getCollection().findOne({
            jwtId,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        });

        if (!doc) {
            return null;
        }

        // Update last used timestamp (non-blocking)
        updateLastUsed(doc._id.toString()).catch(() => {});

        return toPublicSession(doc);
    } catch {
        return null;
    }
}

/**
 * Update the lastUsedAt timestamp
 */
export async function updateLastUsed(sessionId: string): Promise<void> {
    try {
        await getCollection().updateOne(
            { _id: new ObjectId(sessionId) },
            { $set: { lastUsedAt: new Date() } },
        );
    } catch {
        // Silent fail - not critical
    }
}

/**
 * Revoke a session
 */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
    try {
        const result = await getCollection().updateOne(
            {
                _id: new ObjectId(sessionId),
                userId: new ObjectId(userId),
            },
            { $set: { revokedAt: new Date() } },
        );
        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Revoke a session by JWT ID
 */
export async function revokeSessionByJwtId(jwtId: string): Promise<boolean> {
    try {
        const result = await getCollection().updateOne(
            { jwtId },
            { $set: { revokedAt: new Date() } },
        );
        return result.modifiedCount === 1;
    } catch {
        return false;
    }
}

/**
 * Revoke all sessions for a bot
 */
export async function revokeAllSessions(userBotId: string): Promise<number> {
    try {
        const result = await getCollection().updateMany(
            {
                userBotId: new ObjectId(userBotId),
                revokedAt: null,
            },
            { $set: { revokedAt: new Date() } },
        );
        return result.modifiedCount;
    } catch {
        return 0;
    }
}

/**
 * Find all active sessions for a bot
 */
export async function findActiveSessionsByBotId(userBotId: string): Promise<BotSession[]> {
    try {
        const docs = await getCollection()
            .find({
                userBotId: new ObjectId(userBotId),
                revokedAt: null,
                expiresAt: { $gt: new Date() },
            })
            .sort({ lastUsedAt: -1 })
            .toArray();
        return docs.map(toPublicSession);
    } catch {
        return [];
    }
}

/**
 * Find all sessions for a bot (including expired/revoked)
 */
export async function findAllSessionsByBotId(userBotId: string): Promise<BotSession[]> {
    try {
        const docs = await getCollection()
            .find({ userBotId: new ObjectId(userBotId) })
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray();
        return docs.map(toPublicSession);
    } catch {
        return [];
    }
}

/**
 * Delete expired and revoked sessions (cleanup)
 */
export async function cleanupExpiredSessions(): Promise<number> {
    try {
        const result = await getCollection().deleteMany({
            $or: [
                { expiresAt: { $lt: new Date() } },
                { revokedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, // Revoked > 7 days ago
            ],
        });
        return result.deletedCount;
    } catch {
        return 0;
    }
}

/**
 * Count active sessions for a bot
 */
export async function countActiveSessions(userBotId: string): Promise<number> {
    try {
        return await getCollection().countDocuments({
            userBotId: new ObjectId(userBotId),
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        });
    } catch {
        return 0;
    }
}
