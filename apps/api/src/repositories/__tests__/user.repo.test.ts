import { describe, it, expect } from 'vitest';
import { findUserByEmail, findUserById, createUser, findOrCreateUser } from '../user.repo';
import { createUserFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('UserRepo', () => {
    describe('findUserByEmail', () => {
        it('should return user when email exists', async () => {
            const fixture = await createUserFixture();

            const user = await findUserByEmail(fixture.email);

            expect(user).not.toBeNull();
            expect(user!.email).toBe(fixture.email);
            expect(user!._id).toBe(fixture._id.toString());
        });

        it('should return null when email does not exist', async () => {
            const user = await findUserByEmail('nonexistent-xyz@example.com');

            expect(user).toBeNull();
        });

        it('should be case-insensitive', async () => {
            const fixture = await createUserFixture();

            const user = await findUserByEmail(fixture.email.toUpperCase());

            expect(user).not.toBeNull();
            expect(user!.email).toBe(fixture.email.toLowerCase());
        });
    });

    describe('findUserById', () => {
        it('should return user when id exists', async () => {
            const fixture = await createUserFixture();

            const user = await findUserById(fixture._id.toString());

            expect(user).not.toBeNull();
            expect(user!.email).toBe(fixture.email);
        });

        it('should return null when id does not exist', async () => {
            const user = await findUserById('507f1f77bcf86cd799439011');

            expect(user).toBeNull();
        });

        it('should return null for invalid ObjectId', async () => {
            const user = await findUserById('invalid-id');

            expect(user).toBeNull();
        });
    });

    describe('createUser', () => {
        it('should create a new user', async () => {
            const uniqueEmail = `new-${Date.now()}@example.com`;
            const user = await createUser({ email: uniqueEmail });

            expect(user).toBeDefined();
            expect(user.email).toBe(uniqueEmail);
            expect(user._id).toBeDefined();
        });

        it('should lowercase email', async () => {
            const uniqueEmail = `NEW-${Date.now()}@EXAMPLE.COM`;
            const user = await createUser({ email: uniqueEmail });

            expect(user.email).toBe(uniqueEmail.toLowerCase());
        });

        it('should include displayName when provided', async () => {
            const uniqueEmail = `user-${Date.now()}@example.com`;
            const user = await createUser({
                email: uniqueEmail,
                displayName: 'Test User',
            });

            expect(user.displayName).toBe('Test User');
        });
    });

    describe('findOrCreateUser', () => {
        it('should return existing user if found', async () => {
            const fixture = await createUserFixture();

            const user = await findOrCreateUser(fixture.email);

            expect(user._id).toBe(fixture._id.toString());
            expect(user.email).toBe(fixture.email);
        });

        it('should create new user if not found', async () => {
            const uniqueEmail = `new-${Date.now()}@example.com`;
            const user = await findOrCreateUser(uniqueEmail);

            expect(user).toBeDefined();
            expect(user.email).toBe(uniqueEmail);
            expect(user._id).toBeDefined();
        });

        it('should be case-insensitive when finding', async () => {
            const fixture = await createUserFixture();

            const user = await findOrCreateUser(fixture.email.toUpperCase());

            expect(user._id).toBe(fixture._id.toString());
        });
    });
});
