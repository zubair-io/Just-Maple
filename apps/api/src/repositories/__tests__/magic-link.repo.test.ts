import { describe, it, expect } from 'vitest';
import {
    createMagicLink,
    validateAndConsumeMagicLink,
    deleteMagicLinksForUser,
    generateToken,
} from '../magic-link.repo';
import { createUserFixture, createMagicLinkFixture } from '../../__tests__/helpers/fixtures';
import { testDb, mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('MagicLinkRepo', () => {
    describe('generateToken', () => {
        it('should generate a 64 character hex string', () => {
            const token = generateToken();

            expect(token).toHaveLength(64);
            expect(/^[0-9a-f]+$/.test(token)).toBe(true);
        });

        it('should generate unique tokens', () => {
            const tokens = new Set<string>();
            for (let i = 0; i < 100; i++) {
                tokens.add(generateToken());
            }
            expect(tokens.size).toBe(100);
        });
    });

    describe('createMagicLink', () => {
        it('should create a magic link for user', async () => {
            const user = await createUserFixture();

            const token = await createMagicLink(user._id.toString(), user.email);

            expect(token).toHaveLength(64);

            const doc = await testDb.collection('magic_links').findOne({ token });
            expect(doc).not.toBeNull();
            expect(doc!.email).toBe(user.email);
            expect(doc!.userId).toBe(user._id.toString());
        });

        it('should delete existing magic links for same email', async () => {
            const user = await createUserFixture();

            const firstToken = await createMagicLink(user._id.toString(), user.email);
            const secondToken = await createMagicLink(user._id.toString(), user.email);

            const firstDoc = await testDb.collection('magic_links').findOne({ token: firstToken });
            expect(firstDoc).toBeNull();

            const secondDoc = await testDb
                .collection('magic_links')
                .findOne({ token: secondToken });
            expect(secondDoc).not.toBeNull();
        });

        it('should set expiration time', async () => {
            const user = await createUserFixture();

            const token = await createMagicLink(user._id.toString(), user.email);

            const doc = await testDb.collection('magic_links').findOne({ token });
            expect(doc!.expiresAt.getTime()).toBeGreaterThan(Date.now());
            // Should expire in approximately 15 minutes
            expect(doc!.expiresAt.getTime()).toBeLessThan(Date.now() + 16 * 60 * 1000);
        });
    });

    describe('validateAndConsumeMagicLink', () => {
        it('should validate and return magic link data', async () => {
            const user = await createUserFixture();
            const fixture = await createMagicLinkFixture({
                userId: user._id.toString(),
                email: user.email,
            });

            const result = await validateAndConsumeMagicLink(fixture.token);

            expect(result).not.toBeNull();
            expect(result!.userId).toBe(user._id.toString());
            expect(result!.email).toBe(user.email);
        });

        it('should delete the magic link after validation', async () => {
            const fixture = await createMagicLinkFixture();

            await validateAndConsumeMagicLink(fixture.token);

            const doc = await testDb.collection('magic_links').findOne({ token: fixture.token });
            expect(doc).toBeNull();
        });

        it('should return null for expired token', async () => {
            const fixture = await createMagicLinkFixture({
                expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
            });

            const result = await validateAndConsumeMagicLink(fixture.token);

            expect(result).toBeNull();
        });

        it('should return null for non-existent token', async () => {
            const result = await validateAndConsumeMagicLink('nonexistent-token');

            expect(result).toBeNull();
        });
    });

    describe('deleteMagicLinksForUser', () => {
        it('should delete all magic links for email', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            await createMagicLinkFixture({ email: user1.email });
            await createMagicLinkFixture({ email: user2.email });

            await deleteMagicLinksForUser(user1.email);

            const user1Links = await testDb
                .collection('magic_links')
                .find({ email: user1.email })
                .toArray();
            expect(user1Links).toHaveLength(0);

            const user2Links = await testDb
                .collection('magic_links')
                .find({ email: user2.email })
                .toArray();
            expect(user2Links).toHaveLength(1);
        });
    });
});
