import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import { config } from '../config';

interface ChallengeDocument {
    _id: ObjectId;
    key: string;
    challenge: string;
    expiresAt: Date;
    createdAt: Date;
}

function getCollection(): Collection<ChallengeDocument> {
    return getDb().collection<ChallengeDocument>('passkey_challenges');
}

/**
 * Store a WebAuthn challenge for later verification.
 * Challenges expire automatically via MongoDB TTL index.
 */
export async function storeChallenge(key: string, challenge: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.challengeExpiresIn);

    // Delete any existing challenge for this key
    await getCollection().deleteMany({ key });

    // Create new challenge
    await getCollection().insertOne({
        _id: new ObjectId(),
        key,
        challenge,
        expiresAt,
        createdAt: now,
    });
}

/**
 * Retrieve and consume a challenge (one-time use).
 * Returns the challenge if valid and not expired, null otherwise.
 */
export async function consumeChallenge(key: string): Promise<string | null> {
    const doc = await getCollection().findOneAndDelete({
        key,
        expiresAt: { $gt: new Date() },
    });

    return doc?.challenge ?? null;
}

/**
 * Check if a challenge exists (without consuming it).
 * Used for validation before verification.
 */
export async function hasChallenge(key: string): Promise<boolean> {
    const doc = await getCollection().findOne({
        key,
        expiresAt: { $gt: new Date() },
    });

    return doc !== null;
}

/**
 * Delete a specific challenge.
 */
export async function deleteChallenge(key: string): Promise<void> {
    await getCollection().deleteMany({ key });
}
