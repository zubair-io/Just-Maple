import { describe, it, expect } from 'vitest';
import { ensurePasskeyIndexes } from '../passkey-indexes';
import { testDb, mongoAvailable } from '../../__tests__/setup';
import {
    savePasskeyChallenge,
    consumePasskeyChallenge,
} from '../../repositories/passkey-challenge.repo';

describe.runIf(mongoAvailable)('Passkey storage', () => {
    it('migrates the existing unique email index idempotently without losing existing users', async () => {
        const users = testDb!.collection('users');
        await users.dropIndex('email_1');
        await users.createIndex({ email: 1 }, { unique: true });
        const existing = await users.insertOne({ email: 'legacy@example.com' });
        await ensurePasskeyIndexes(testDb!);
        await ensurePasskeyIndexes(testDb!);
        await users.insertMany([{ displayName: 'First reader' }, { displayName: 'Second reader' }]);
        expect(await users.countDocuments()).toBe(3);
        expect(await users.findOne({ _id: existing.insertedId })).toHaveProperty(
            'email',
            'legacy@example.com',
        );
        expect((await users.indexes()).find((i) => i.name === 'email_1')).toMatchObject({
            unique: true,
            sparse: true,
        });
    });

    it('allows only one concurrent consumption of a challenge', async () => {
        await savePasskeyChallenge('concurrent-challenge', { kind: 'login' });
        const attempts = await Promise.all(
            Array.from({ length: 10 }, () =>
                consumePasskeyChallenge('concurrent-challenge', 'login'),
            ),
        );
        expect(attempts.filter(Boolean)).toHaveLength(1);
    });

    it('rejects expiry before the TTL worker has deleted the record', async () => {
        await savePasskeyChallenge('expired-challenge', { kind: 'login' });
        await testDb!
            .collection('passkey_challenges')
            .updateOne({ _id: 'expired-challenge' } as any, {
                $set: { expiresAt: new Date(Date.now() - 1000) },
            });
        expect(await consumePasskeyChallenge('expired-challenge', 'login')).toBeNull();
    });
});
