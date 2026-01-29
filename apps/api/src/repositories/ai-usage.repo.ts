import { getDb } from '../db/client';
import { AI_RATE_LIMITS, type AIUsage, type AIUsageResponse } from '@maple/shared';

const COLLECTION = 'ai_usage';

interface AIUsageDoc {
    userId: string;
    date: string; // YYYY-MM-DD
    requests: number;
    tokensInput: number;
    tokensOutput: number;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Get today's date string in YYYY-MM-DD format
 */
function getTodayString(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Get the start of the current month in YYYY-MM-DD format
 */
function getMonthStartString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Get the reset time for daily limits (midnight UTC)
 */
function getDailyResetTime(): string {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.toISOString();
}

/**
 * Get or create today's usage record for a user
 */
export async function getOrCreateTodayUsage(userId: string): Promise<AIUsageDoc> {
    const db = getDb();
    const collection = db.collection<AIUsageDoc>(COLLECTION);
    const today = getTodayString();

    const existing = await collection.findOne({ userId, date: today });
    if (existing) {
        return existing;
    }

    // Create new record for today
    const newDoc: AIUsageDoc = {
        userId,
        date: today,
        requests: 0,
        tokensInput: 0,
        tokensOutput: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    await collection.insertOne(newDoc);
    return newDoc;
}

/**
 * Increment usage for a user
 */
export async function incrementUsage(
    userId: string,
    tokensInput: number,
    tokensOutput: number,
): Promise<void> {
    const db = getDb();
    const collection = db.collection<AIUsageDoc>(COLLECTION);
    const today = getTodayString();

    await collection.updateOne(
        { userId, date: today },
        {
            $inc: {
                requests: 1,
                tokensInput,
                tokensOutput,
            },
            $set: { updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
    );
}

/**
 * Check if user has exceeded their rate limit
 */
export async function checkRateLimit(userId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: string;
}> {
    const usage = await getOrCreateTodayUsage(userId);
    const limit = AI_RATE_LIMITS.FREE_TIER.DAILY_REQUESTS;
    const remaining = Math.max(0, limit - usage.requests);
    const resetAt = getDailyResetTime();

    return {
        allowed: usage.requests < limit,
        remaining,
        resetAt,
    };
}

/**
 * Get user's AI usage statistics
 */
export async function getUserUsage(userId: string): Promise<AIUsageResponse> {
    const db = getDb();
    const collection = db.collection<AIUsageDoc>(COLLECTION);

    const today = getTodayString();
    const monthStart = getMonthStartString();

    // Get today's usage
    const todayUsage = await getOrCreateTodayUsage(userId);

    // Get monthly aggregate
    const monthlyAgg = await collection
        .aggregate<{ totalRequests: number; totalTokens: number }>([
            {
                $match: {
                    userId,
                    date: { $gte: monthStart },
                },
            },
            {
                $group: {
                    _id: null,
                    totalRequests: { $sum: '$requests' },
                    totalTokens: { $sum: { $add: ['$tokensInput', '$tokensOutput'] } },
                },
            },
        ])
        .toArray();

    const monthly = monthlyAgg[0] || { totalRequests: 0, totalTokens: 0 };

    return {
        daily: {
            requests: todayUsage.requests,
            tokens: todayUsage.tokensInput + todayUsage.tokensOutput,
            limit: AI_RATE_LIMITS.FREE_TIER.DAILY_REQUESTS,
        },
        monthly: {
            requests: monthly.totalRequests,
            tokens: monthly.totalTokens,
        },
        resetAt: getDailyResetTime(),
    };
}

/**
 * Create indexes for the ai_usage collection
 */
export async function createAIUsageIndexes(): Promise<void> {
    const db = getDb();
    const collection = db.collection(COLLECTION);

    await collection.createIndex({ userId: 1, date: 1 }, { unique: true });
    await collection.createIndex({ date: 1 }); // For cleanup of old records
}
