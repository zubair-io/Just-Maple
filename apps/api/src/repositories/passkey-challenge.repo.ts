import { getDb } from '../db/client';

export interface PasskeyChallenge {
    _id: string;
    kind: 'signup' | 'register' | 'login';
    userId?: string;
    displayName?: string;
    expiresAt: Date;
}

export async function savePasskeyChallenge(
    challenge: string,
    data: Omit<PasskeyChallenge, '_id' | 'expiresAt'>,
): Promise<void> {
    await getDb()
        .collection<PasskeyChallenge>('passkey_challenges')
        .insertOne({
            _id: challenge,
            ...data,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        });
}

// Atomic consumption prevents replay across concurrent requests and API replicas.
// Check expiry explicitly because TTL deletion is asynchronous.
export async function consumePasskeyChallenge(
    challenge: string,
    kind: PasskeyChallenge['kind'],
    userId?: string,
): Promise<PasskeyChallenge | null> {
    return getDb()
        .collection<PasskeyChallenge>('passkey_challenges')
        .findOneAndDelete({
            _id: challenge,
            kind,
            ...(userId ? { userId } : {}),
            expiresAt: { $gt: new Date() },
        });
}
