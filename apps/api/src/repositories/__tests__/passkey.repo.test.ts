import { describe, it, expect } from 'vitest';
import {
    createPasskey,
    findPasskeyByCredentialId,
    findPasskeysByUserId,
    updatePasskeyCounter,
    deletePasskey,
    getAllCredentialIdsForUser,
} from '../passkey.repo';
import { createUserFixture, createPasskeyFixture } from '../../__tests__/helpers/fixtures';
import { testDb } from '../../__tests__/setup';
import { randomBytes } from 'crypto';

describe('PasskeyRepo', () => {
    describe('createPasskey', () => {
        it('should create a new passkey', async () => {
            const user = await createUserFixture();
            const credentialId = randomBytes(32).toString('base64url');
            const publicKey = randomBytes(65).toString('base64url');

            const passkey = await createPasskey({
                userId: user._id.toString(),
                credentialId,
                publicKey,
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            expect(passkey).toBeDefined();
            expect(passkey.credentialId).toBe(credentialId);
            expect(passkey.userId).toBe(user._id.toString());
            expect(passkey.counter).toBe(0);
        });

        it('should set createdAt timestamp', async () => {
            const user = await createUserFixture();
            const before = new Date();

            const passkey = await createPasskey({
                userId: user._id.toString(),
                credentialId: randomBytes(32).toString('base64url'),
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            const after = new Date();
            expect(passkey.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(passkey.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        it('should include transports when provided', async () => {
            const user = await createUserFixture();

            const passkey = await createPasskey({
                userId: user._id.toString(),
                credentialId: randomBytes(32).toString('base64url'),
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'multiDevice',
                backedUp: true,
                transports: ['usb', 'ble'],
            });

            expect(passkey.transports).toEqual(['usb', 'ble']);
        });
    });

    describe('findPasskeyByCredentialId', () => {
        it('should return passkey when found', async () => {
            const user = await createUserFixture();
            const credentialId = randomBytes(32).toString('base64url');
            await createPasskey({
                userId: user._id.toString(),
                credentialId,
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            const passkey = await findPasskeyByCredentialId(credentialId);

            expect(passkey).not.toBeNull();
            expect(passkey!.credentialId).toBe(credentialId);
        });

        it('should return null when not found', async () => {
            const passkey = await findPasskeyByCredentialId('nonexistent');

            expect(passkey).toBeNull();
        });
    });

    describe('findPasskeysByUserId', () => {
        it('should return all passkeys for user', async () => {
            const user = await createUserFixture();
            const otherUser = await createUserFixture();

            // Create passkeys for the user
            await createPasskey({
                userId: user._id.toString(),
                credentialId: randomBytes(32).toString('base64url'),
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });
            await createPasskey({
                userId: user._id.toString(),
                credentialId: randomBytes(32).toString('base64url'),
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });
            // Create passkey for other user
            await createPasskey({
                userId: otherUser._id.toString(),
                credentialId: randomBytes(32).toString('base64url'),
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            const passkeys = await findPasskeysByUserId(user._id.toString());

            expect(passkeys).toHaveLength(2);
            passkeys.forEach((p) => {
                expect(p.userId).toBe(user._id.toString());
            });
        });

        it('should return empty array when no passkeys', async () => {
            const user = await createUserFixture();

            const passkeys = await findPasskeysByUserId(user._id.toString());

            expect(passkeys).toHaveLength(0);
        });
    });

    describe('updatePasskeyCounter', () => {
        it('should update the counter', async () => {
            const user = await createUserFixture();
            const credentialId = randomBytes(32).toString('base64url');
            await createPasskey({
                userId: user._id.toString(),
                credentialId,
                publicKey: randomBytes(65).toString('base64url'),
                counter: 5,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            await updatePasskeyCounter(credentialId, 10);

            const doc = await testDb.collection('passkeys').findOne({ credentialId });
            expect(doc!.counter).toBe(10);
        });
    });

    describe('deletePasskey', () => {
        it('should delete passkey owned by user', async () => {
            const user = await createUserFixture();
            const credentialId = randomBytes(32).toString('base64url');
            const passkey = await createPasskey({
                userId: user._id.toString(),
                credentialId,
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            const result = await deletePasskey(passkey.id, user._id.toString());

            expect(result).toBe(true);

            const doc = await testDb.collection('passkeys').findOne({ credentialId });
            expect(doc).toBeNull();
        });

        it('should return false if passkey not owned by user', async () => {
            const user = await createUserFixture();
            const otherUser = await createUserFixture();
            const credentialId = randomBytes(32).toString('base64url');
            const passkey = await createPasskey({
                userId: otherUser._id.toString(),
                credentialId,
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            const result = await deletePasskey(passkey.id, user._id.toString());

            expect(result).toBe(false);

            // Passkey should still exist
            const doc = await testDb.collection('passkeys').findOne({ credentialId });
            expect(doc).not.toBeNull();
        });

        it('should return false for non-existent passkey', async () => {
            const result = await deletePasskey('507f1f77bcf86cd799439011', 'any-user-id');

            expect(result).toBe(false);
        });
    });

    describe('getAllCredentialIdsForUser', () => {
        it('should return all credential IDs for user', async () => {
            const user = await createUserFixture();
            const cred1 = randomBytes(32).toString('base64url');
            const cred2 = randomBytes(32).toString('base64url');
            await createPasskey({
                userId: user._id.toString(),
                credentialId: cred1,
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });
            await createPasskey({
                userId: user._id.toString(),
                credentialId: cred2,
                publicKey: randomBytes(65).toString('base64url'),
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
            });

            const ids = await getAllCredentialIdsForUser(user._id.toString());

            expect(ids).toHaveLength(2);
            expect(ids).toContain(cred1);
            expect(ids).toContain(cred2);
        });

        it('should return empty array when no passkeys', async () => {
            const ids = await getAllCredentialIdsForUser('nonexistent-user');

            expect(ids).toHaveLength(0);
        });
    });
});
