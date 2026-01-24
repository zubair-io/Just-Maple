import { describe, it, expect } from 'vitest';
import {
    findUserBotsByUserId,
    findUserBotById,
    findUserBotByHandle,
    // findEnabledBotsForTag, // Function no longer exists - tests skipped
    createUserBot,
    updateUserBot,
    deleteUserBot,
    searchUserBots,
} from '../user-bot.repo';
import {
    createUserFixture,
    createBotTemplateFixture,
    createUserBotFixture,
    createNotebookFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('UserBotRepo', () => {
    describe('findUserBotsByUserId', () => {
        it('should return all bots for a user', async () => {
            const user = await createUserFixture();
            await createUserBotFixture({ userId: user._id.toString(), handle: 'bot-1' });
            await createUserBotFixture({ userId: user._id.toString(), handle: 'bot-2' });

            const bots = await findUserBotsByUserId(user._id.toString());

            expect(bots.length).toBe(2);
        });

        it('should not return bots from other users', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            await createUserBotFixture({ userId: user1._id.toString(), handle: 'user1-bot' });
            await createUserBotFixture({ userId: user2._id.toString(), handle: 'user2-bot' });

            const bots = await findUserBotsByUserId(user1._id.toString());

            expect(bots.length).toBe(1);
            expect(bots[0].handle).toBe('user1-bot');
        });

        it('should return empty array when user has no bots', async () => {
            const user = await createUserFixture();

            const bots = await findUserBotsByUserId(user._id.toString());

            expect(bots).toEqual([]);
        });
    });

    describe('findUserBotById', () => {
        it('should return bot when id exists', async () => {
            const fixture = await createUserBotFixture({ handle: 'test-bot' });

            const bot = await findUserBotById(fixture._id.toString());

            expect(bot).not.toBeNull();
            expect(bot!.handle).toBe('test-bot');
        });

        it('should return null when id does not exist', async () => {
            const bot = await findUserBotById('507f1f77bcf86cd799439011');

            expect(bot).toBeNull();
        });
    });

    describe('findUserBotByHandle', () => {
        it('should return bot when user has bot with handle', async () => {
            const user = await createUserFixture();
            await createUserBotFixture({ userId: user._id.toString(), handle: 'mybot' });

            const bot = await findUserBotByHandle(user._id.toString(), 'mybot');

            expect(bot).not.toBeNull();
            expect(bot!.handle).toBe('mybot');
        });

        it('should be case-insensitive', async () => {
            const user = await createUserFixture();
            await createUserBotFixture({ userId: user._id.toString(), handle: 'mybot' });

            const bot = await findUserBotByHandle(user._id.toString(), 'MYBOT');

            expect(bot).not.toBeNull();
        });

        it('should return null when handle not found for user', async () => {
            const user = await createUserFixture();

            const bot = await findUserBotByHandle(user._id.toString(), 'nonexistent');

            expect(bot).toBeNull();
        });
    });

    // NOTE: findEnabledBotsForTag function no longer exists - this test is outdated
    // Bot-to-tag relationships are now managed via tag.sharing.sharedBots array
    // Use findUserBotsForTag(notebookId) instead
    describe.skip('findEnabledBotsForTag', () => {
        it('should return global bots (no notebookId)', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), role: 'owner' }],
            });
            await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'global-bot',
                isEnabled: true,
            });

            // const bots = await findEnabledBotsForTag(user._id.toString(), tag._id.toString());
            // expect(bots.some((b) => b.handle === 'global-bot')).toBe(true);
        });

        it('should return tag-specific bots', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), role: 'owner' }],
            });
            await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'tag-bot',
                notebookId: tag._id.toString(),
                isEnabled: true,
            });

            // const bots = await findEnabledBotsForTag(user._id.toString(), tag._id.toString());
            // expect(bots.some((b) => b.handle === 'tag-bot')).toBe(true);
        });

        it('should not return disabled bots', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), role: 'owner' }],
            });
            await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'disabled-bot',
                isEnabled: false,
            });

            // const bots = await findEnabledBotsForTag(user._id.toString(), tag._id.toString());
            // expect(bots.some((b) => b.handle === 'disabled-bot')).toBe(false);
        });
    });

    describe('createUserBot', () => {
        it('should create a new user bot', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ handle: 'template-bot' });

            const bot = await createUserBot(
                user._id.toString(),
                {
                    templateId: template._id.toString(),
                    displayName: 'My Bot',
                },
                template.handle,
            );

            expect(bot).toBeDefined();
            expect(bot._id).toBeDefined();
            expect(bot.handle).toBe('template-bot');
            expect(bot.displayName).toBe('My Bot');
            expect(bot.isEnabled).toBe(true);
        });

        it('should use custom handle if provided', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ handle: 'original' });

            const bot = await createUserBot(
                user._id.toString(),
                {
                    templateId: template._id.toString(),
                    handle: 'custom-handle',
                },
                template.handle,
            );

            expect(bot.handle).toBe('custom-handle');
        });

        it('should lowercase handle', async () => {
            const user = await createUserFixture();
            const template = await createBotTemplateFixture({ handle: 'test' });

            const bot = await createUserBot(
                user._id.toString(),
                {
                    templateId: template._id.toString(),
                    handle: 'UPPERCASE',
                },
                template.handle,
            );

            expect(bot.handle).toBe('uppercase');
        });
    });

    describe('updateUserBot', () => {
        it('should update bot properties', async () => {
            const user = await createUserFixture();
            const fixture = await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'original',
                isEnabled: true,
            });

            const updated = await updateUserBot(fixture._id.toString(), user._id.toString(), {
                displayName: 'Updated Name',
                isEnabled: false,
            });

            expect(updated).not.toBeNull();
            expect(updated!.displayName).toBe('Updated Name');
            expect(updated!.isEnabled).toBe(false);
        });

        it('should return null when bot not found', async () => {
            const user = await createUserFixture();

            const updated = await updateUserBot('507f1f77bcf86cd799439011', user._id.toString(), {
                displayName: 'New Name',
            });

            expect(updated).toBeNull();
        });

        it('should not update bots owned by other users', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const fixture = await createUserBotFixture({
                userId: user1._id.toString(),
                handle: 'user1-bot',
            });

            const updated = await updateUserBot(fixture._id.toString(), user2._id.toString(), {
                displayName: 'Hacked',
            });

            expect(updated).toBeNull();
        });
    });

    describe('deleteUserBot', () => {
        it('should delete bot owned by user', async () => {
            const user = await createUserFixture();
            const fixture = await createUserBotFixture({ userId: user._id.toString() });

            const deleted = await deleteUserBot(fixture._id.toString(), user._id.toString());

            expect(deleted).toBe(true);

            const bot = await findUserBotById(fixture._id.toString());
            expect(bot).toBeNull();
        });

        it('should not delete bots owned by other users', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const fixture = await createUserBotFixture({ userId: user1._id.toString() });

            const deleted = await deleteUserBot(fixture._id.toString(), user2._id.toString());

            expect(deleted).toBe(false);
        });

        it('should return false when bot not found', async () => {
            const user = await createUserFixture();

            const deleted = await deleteUserBot('507f1f77bcf86cd799439011', user._id.toString());

            expect(deleted).toBe(false);
        });
    });

    describe('searchUserBots', () => {
        it('should search by handle', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), role: 'owner' }],
            });
            await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'summarize',
                isEnabled: true,
            });

            const results = await searchUserBots(user._id.toString(), tag._id.toString(), 'sum');

            expect(results.length).toBe(1);
            expect(results[0].handle).toBe('summarize');
        });

        it('should search by displayName', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), role: 'owner' }],
            });
            await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'mybot',
                displayName: 'Weather Helper',
                isEnabled: true,
            });

            const results = await searchUserBots(
                user._id.toString(),
                tag._id.toString(),
                'weather',
            );

            expect(results.length).toBe(1);
            expect(results[0].displayName).toBe('Weather Helper');
        });

        it('should not return disabled bots', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), role: 'owner' }],
            });
            await createUserBotFixture({
                userId: user._id.toString(),
                handle: 'disabled',
                isEnabled: false,
            });

            const results = await searchUserBots(
                user._id.toString(),
                tag._id.toString(),
                'disabled',
            );

            expect(results).toEqual([]);
        });
    });
});
