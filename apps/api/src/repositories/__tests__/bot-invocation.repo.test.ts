import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import {
    findInvocationById,
    createInvocation,
    updateInvocationStatus,
    findInvocationsByUserBot,
    findInvocationsBySourceMessage,
} from '../bot-invocation.repo';
import {
    createBotInvocationFixture,
    createUserBotFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('BotInvocationRepo', () => {
    describe('findInvocationById', () => {
        it('should return invocation when id exists', async () => {
            const fixture = await createBotInvocationFixture({ status: 'pending' });

            const invocation = await findInvocationById(fixture._id.toString());

            expect(invocation).not.toBeNull();
            expect(invocation!._id).toBe(fixture._id.toString());
            expect(invocation!.status).toBe('pending');
        });

        it('should return null when id does not exist', async () => {
            const invocation = await findInvocationById('507f1f77bcf86cd799439011');

            expect(invocation).toBeNull();
        });

        it('should return null for invalid ObjectId', async () => {
            const invocation = await findInvocationById('invalid-id');

            expect(invocation).toBeNull();
        });
    });

    describe('createInvocation', () => {
        it('should create a new invocation', async () => {
            const userBotId = new ObjectId().toString();
            const templateId = new ObjectId().toString();
            const sourceId = new ObjectId().toString();
            const notebookId = new ObjectId().toString();
            const userId = new ObjectId().toString();

            const invocation = await createInvocation({
                userBotId,
                templateId,
                sourceType: 'message',
                sourceId,
                notebookId,
                userId,
                context: { mentionText: '@bot hello' },
            });

            expect(invocation).toBeDefined();
            expect(invocation._id).toBeDefined();
            expect(invocation.userBotId).toBe(userBotId);
            expect(invocation.templateId).toBe(templateId);
            expect(invocation.sourceType).toBe('message');
            expect(invocation.status).toBe('pending');
            expect(invocation.variables).toEqual({});
            expect(invocation.context.mentionText).toBe('@bot hello');
        });

        it('should set initial status to pending', async () => {
            const invocation = await createInvocation({
                userBotId: new ObjectId().toString(),
                templateId: new ObjectId().toString(),
                sourceType: 'note',
                sourceId: new ObjectId().toString(),
                notebookId: new ObjectId().toString(),
                userId: new ObjectId().toString(),
                context: {},
            });

            expect(invocation.status).toBe('pending');
        });
    });

    describe('updateInvocationStatus', () => {
        it('should update status', async () => {
            const fixture = await createBotInvocationFixture({ status: 'pending' });

            const updated = await updateInvocationStatus(fixture._id.toString(), 'running');

            expect(updated).not.toBeNull();
            expect(updated!.status).toBe('running');
        });

        it('should update output when provided', async () => {
            const fixture = await createBotInvocationFixture({ status: 'running' });

            const updated = await updateInvocationStatus(fixture._id.toString(), 'completed', {
                output: { message: 'Bot response' },
            });

            expect(updated!.status).toBe('completed');
            expect(updated!.output).toEqual({ message: 'Bot response' });
        });

        it('should update error when provided', async () => {
            const fixture = await createBotInvocationFixture({ status: 'running' });

            const updated = await updateInvocationStatus(fixture._id.toString(), 'failed', {
                error: { code: 'API_ERROR', message: 'Failed to call API' },
            });

            expect(updated!.status).toBe('failed');
            expect(updated!.error).toEqual({ code: 'API_ERROR', message: 'Failed to call API' });
        });

        it('should update threadId and responseMessageId', async () => {
            const fixture = await createBotInvocationFixture({ status: 'running' });
            const threadId = new ObjectId().toString();
            const responseMessageId = new ObjectId().toString();

            const updated = await updateInvocationStatus(fixture._id.toString(), 'completed', {
                threadId,
                responseMessageId,
            });

            expect(updated!.threadId).toBe(threadId);
            expect(updated!.responseMessageId).toBe(responseMessageId);
        });

        it('should update executionTimeMs', async () => {
            const fixture = await createBotInvocationFixture({ status: 'running' });

            const updated = await updateInvocationStatus(fixture._id.toString(), 'completed', {
                executionTimeMs: 1500,
            });

            expect(updated!.executionTimeMs).toBe(1500);
        });

        it('should update variables', async () => {
            const fixture = await createBotInvocationFixture({ status: 'running' });

            const updated = await updateInvocationStatus(fixture._id.toString(), 'completed', {
                variables: { result: 'success', count: 42 },
            });

            expect(updated!.variables).toEqual({ result: 'success', count: 42 });
        });

        it('should return null when invocation not found', async () => {
            const updated = await updateInvocationStatus('507f1f77bcf86cd799439011', 'completed');

            expect(updated).toBeNull();
        });
    });

    describe('findInvocationsByUserBot', () => {
        it('should return invocations for user bot', async () => {
            const user = await createUserFixture();
            const userBot = await createUserBotFixture({ userId: user._id.toString() });
            await createBotInvocationFixture({ userBotId: userBot._id.toString() });
            await createBotInvocationFixture({ userBotId: userBot._id.toString() });

            const invocations = await findInvocationsByUserBot(userBot._id.toString());

            expect(invocations.length).toBe(2);
        });

        it('should not return invocations from other bots', async () => {
            const userBot1 = await createUserBotFixture();
            const userBot2 = await createUserBotFixture();
            await createBotInvocationFixture({ userBotId: userBot1._id.toString() });
            await createBotInvocationFixture({ userBotId: userBot2._id.toString() });

            const invocations = await findInvocationsByUserBot(userBot1._id.toString());

            expect(invocations.length).toBe(1);
            expect(invocations[0].userBotId).toBe(userBot1._id.toString());
        });

        it('should respect limit option', async () => {
            const userBot = await createUserBotFixture();
            await createBotInvocationFixture({ userBotId: userBot._id.toString() });
            await createBotInvocationFixture({ userBotId: userBot._id.toString() });
            await createBotInvocationFixture({ userBotId: userBot._id.toString() });

            const invocations = await findInvocationsByUserBot(userBot._id.toString(), {
                limit: 2,
            });

            expect(invocations.length).toBe(2);
        });

        it('should sort by createdAt descending', async () => {
            const userBot = await createUserBotFixture();

            const inv1 = await createBotInvocationFixture({ userBotId: userBot._id.toString() });
            await new Promise((resolve) => setTimeout(resolve, 10));
            const inv2 = await createBotInvocationFixture({ userBotId: userBot._id.toString() });

            const invocations = await findInvocationsByUserBot(userBot._id.toString());

            expect(invocations[0]._id).toBe(inv2._id.toString());
            expect(invocations[1]._id).toBe(inv1._id.toString());
        });
    });

    describe('findInvocationsBySourceMessage', () => {
        it('should return invocations for source message', async () => {
            const sourceId = new ObjectId().toString();
            await createBotInvocationFixture({ sourceType: 'message', sourceId });
            await createBotInvocationFixture({ sourceType: 'message', sourceId });

            const invocations = await findInvocationsBySourceMessage(sourceId);

            expect(invocations.length).toBe(2);
        });

        it('should not return invocations from other sources', async () => {
            const sourceId1 = new ObjectId().toString();
            const sourceId2 = new ObjectId().toString();
            await createBotInvocationFixture({ sourceType: 'message', sourceId: sourceId1 });
            await createBotInvocationFixture({ sourceType: 'message', sourceId: sourceId2 });

            const invocations = await findInvocationsBySourceMessage(sourceId1);

            expect(invocations.length).toBe(1);
            expect(invocations[0].sourceId).toBe(sourceId1);
        });

        it('should only return message type invocations', async () => {
            const sourceId = new ObjectId().toString();
            await createBotInvocationFixture({ sourceType: 'message', sourceId });
            await createBotInvocationFixture({ sourceType: 'note', sourceId });

            const invocations = await findInvocationsBySourceMessage(sourceId);

            expect(invocations.length).toBe(1);
            expect(invocations[0].sourceType).toBe('message');
        });
    });
});
