import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import { config } from '../config';
import { randomBytes, randomInt } from 'crypto';

interface MagicLinkDocument {
    _id: ObjectId;
    userId: string;
    email: string;
    token: string;
    code: string; // 6-digit code for manual entry
    expiresAt: Date;
    createdAt: Date;
}

function getCollection(): Collection<MagicLinkDocument> {
    return getDb().collection<MagicLinkDocument>('magic_links');
}

export function generateToken(): string {
    return randomBytes(32).toString('hex');
}

export function generateCode(): string {
    // Security: Use cryptographically secure random number generator instead of Math.random()
    // Generate a 6-digit numeric code between 100000 and 999999
    return randomInt(100000, 1000000).toString();
}

export interface MagicLinkResult {
    token: string;
    code: string;
}

export async function createMagicLink(userId: string, email: string): Promise<MagicLinkResult> {
    const token = generateToken();
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.magicLinkExpiresIn);

    // Delete any existing magic links for this email
    await getCollection().deleteMany({ email: email.toLowerCase() });

    // Create new magic link
    await getCollection().insertOne({
        _id: new ObjectId(),
        userId,
        email: email.toLowerCase(),
        token,
        code,
        expiresAt,
        createdAt: now,
    });

    return { token, code };
}

export interface ValidatedMagicLink {
    userId: string;
    email: string;
}

export async function validateAndConsumeMagicLink(
    token: string,
): Promise<ValidatedMagicLink | null> {
    const doc = await getCollection().findOneAndDelete({
        token,
        expiresAt: { $gt: new Date() },
    });

    if (!doc) {
        return null;
    }

    return {
        userId: doc.userId,
        email: doc.email,
    };
}

export async function validateAndConsumeCode(
    email: string,
    code: string,
): Promise<ValidatedMagicLink | null> {
    const doc = await getCollection().findOneAndDelete({
        email: email.toLowerCase(),
        code,
        expiresAt: { $gt: new Date() },
    });

    if (!doc) {
        return null;
    }

    return {
        userId: doc.userId,
        email: doc.email,
    };
}

export async function deleteMagicLinksForUser(email: string): Promise<void> {
    await getCollection().deleteMany({ email: email.toLowerCase() });
}
