import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import { ensurePasskeyIndexes } from '../passkey-indexes';
import { testDb, mongoAvailable } from '../../__tests__/setup';
import {
    savePasskeyChallenge,
    consumePasskeyChallenge,
} from '../../repositories/passkey-challenge.repo';

describe.runIf(mongoAvailable)('Passkey storage', () => {
    it('migrates the existing unique email index idempotently without losing existing users', async () => {
        const users = testDb!.collection('users');
        if ((await users.indexes()).some((index) => index.name === 'email_1'))
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
        expect((await users.indexes()).some((i) => i.key.email === 1 && !i.sparse)).toBe(false);
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

// Reproduce Cosmos DB's unique-index creation failure without changing a live database.
describe('Passkey startup compatibility', () => {
    it('does not create an obsolete email index on an existing collection', async () => {
        const users = {
            indexes: vi.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }]),
            createIndex: vi
                .fn()
                .mockRejectedValue(new Error("Detected stuck collection metadata for 'users'.")),
            dropIndex: vi.fn(),
        };
        const challenges = { createIndex: vi.fn().mockResolvedValue('expiresAt_1') };
        const database = {
            listCollections: () => ({ hasNext: async () => true }),
            collection: (name: string) => (name === 'users' ? users : challenges),
        } as unknown as Db;
        await ensurePasskeyIndexes(database);
        expect(users.createIndex).not.toHaveBeenCalled();
        expect(users.dropIndex).not.toHaveBeenCalled();
        expect(challenges.createIndex).toHaveBeenCalledWith(
            { expiresAt: 1 },
            { expireAfterSeconds: 0 },
        );
    });
});
