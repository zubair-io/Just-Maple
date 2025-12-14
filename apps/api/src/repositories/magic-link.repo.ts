import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import { config } from '../config';
import { randomBytes } from 'crypto';

interface MagicLinkDocument {
    _id: ObjectId;
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}

function getCollection(): Collection<MagicLinkDocument> {
    return getDb().collection<MagicLinkDocument>('magic_links');
}

export function generateToken(): string {
    return randomBytes(32).toString('hex');
}

export async function createMagicLink(userId: string, email: string): Promise<string> {
    const token = generateToken();
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
        expiresAt,
        createdAt: now,
    });

    return token;
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

export async function deleteMagicLinksForUser(email: string): Promise<void> {
    await getCollection().deleteMany({ email: email.toLowerCase() });
}
