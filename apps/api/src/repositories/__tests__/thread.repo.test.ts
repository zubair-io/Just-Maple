import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import {
    findThreadById,
    findThreadByParentMessage,
    createThread,
    incrementThreadMessageCount,
    findThreadsByTagId,
    getOrCreateThread,
} from '../thread.repo';
import { createThreadFixture, createNotebookFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('ThreadRepo', () => {
    describe('findThreadById', () => {
        it('should return thread when id exists', async () => {
            const fixture = await createThreadFixture({ messageCount: 5 });

            const thread = await findThreadById(fixture._id.toString());

            expect(thread).not.toBeNull();
            expect(thread!._id).toBe(fixture._id.toString());
            expect(thread!.messageCount).toBe(5);
        });

        it('should return null when id does not exist', async () => {
            const thread = await findThreadById('507f1f77bcf86cd799439011');

            expect(thread).toBeNull();
        });

        it('should return null for invalid ObjectId', async () => {
            const thread = await findThreadById('invalid-id');

            expect(thread).toBeNull();
        });
    });

    describe('findThreadByParentMessage', () => {
        it('should return thread when parent message exists', async () => {
            const messageId = new ObjectId();
            await createThreadFixture({ parentMessageId: messageId.toString() });

            const thread = await findThreadByParentMessage(messageId.toString());

            expect(thread).not.toBeNull();
            expect(thread!.parentMessageId).toBe(messageId.toString());
        });

        it('should return null when no thread exists for message', async () => {
            const thread = await findThreadByParentMessage(new ObjectId().toString());

            expect(thread).toBeNull();
        });
    });

    describe('createThread', () => {
        it('should create a new thread', async () => {
            const parentMessageId = new ObjectId().toString();
            const tagId = new ObjectId().toString();

            const thread = await createThread({ parentMessageId, tagId });

            expect(thread).toBeDefined();
            expect(thread._id).toBeDefined();
            expect(thread.parentMessageId).toBe(parentMessageId);
            expect(thread.tagId).toBe(tagId);
            expect(thread.messageCount).toBe(0);
            expect(thread.createdAt).toBeDefined();
        });

        it('should include botInvocationId when provided', async () => {
            const parentMessageId = new ObjectId().toString();
            const tagId = new ObjectId().toString();
            const botInvocationId = new ObjectId().toString();

            const thread = await createThread({ parentMessageId, tagId, botInvocationId });

            expect(thread.botInvocationId).toBe(botInvocationId);
        });
    });

    describe('incrementThreadMessageCount', () => {
        it('should increment message count by 1', async () => {
            const fixture = await createThreadFixture({ messageCount: 3 });

            await incrementThreadMessageCount(fixture._id.toString());

            const thread = await findThreadById(fixture._id.toString());
            expect(thread!.messageCount).toBe(4);
        });

        it('should update updatedAt timestamp', async () => {
            const fixture = await createThreadFixture();
            const originalUpdatedAt = fixture.updatedAt;

            // Wait a bit to ensure timestamp difference
            await new Promise((resolve) => setTimeout(resolve, 10));
            await incrementThreadMessageCount(fixture._id.toString());

            const thread = await findThreadById(fixture._id.toString());
            expect(new Date(thread!.updatedAt).getTime()).toBeGreaterThan(
                originalUpdatedAt.getTime(),
            );
        });
    });

    describe('findThreadsByTagId', () => {
        it('should return threads for tag', async () => {
            const tag = await createNotebookFixture();
            await createThreadFixture({ tagId: tag._id.toString() });
            await createThreadFixture({ tagId: tag._id.toString() });

            const threads = await findThreadsByTagId(tag._id.toString());

            expect(threads.length).toBe(2);
        });

        it('should not return threads from other tags', async () => {
            const tag1 = await createNotebookFixture();
            const tag2 = await createNotebookFixture();
            await createThreadFixture({ tagId: tag1._id.toString() });
            await createThreadFixture({ tagId: tag2._id.toString() });

            const threads = await findThreadsByTagId(tag1._id.toString());

            expect(threads.length).toBe(1);
            expect(threads[0].tagId).toBe(tag1._id.toString());
        });

        it('should respect limit option', async () => {
            const tag = await createNotebookFixture();
            await createThreadFixture({ tagId: tag._id.toString() });
            await createThreadFixture({ tagId: tag._id.toString() });
            await createThreadFixture({ tagId: tag._id.toString() });

            const threads = await findThreadsByTagId(tag._id.toString(), { limit: 2 });

            expect(threads.length).toBe(2);
        });

        it('should sort by updatedAt descending', async () => {
            const tag = await createNotebookFixture();

            // Create threads with slight delay to ensure different timestamps
            const thread1 = await createThreadFixture({ tagId: tag._id.toString() });
            await new Promise((resolve) => setTimeout(resolve, 10));
            const thread2 = await createThreadFixture({ tagId: tag._id.toString() });

            const threads = await findThreadsByTagId(tag._id.toString());

            // Most recently updated should be first
            expect(threads[0]._id).toBe(thread2._id.toString());
            expect(threads[1]._id).toBe(thread1._id.toString());
        });
    });

    describe('getOrCreateThread', () => {
        it('should return existing thread if one exists', async () => {
            const parentMessageId = new ObjectId().toString();
            const tagId = new ObjectId().toString();
            const existing = await createThreadFixture({ parentMessageId, tagId });

            const thread = await getOrCreateThread({ parentMessageId, tagId });

            expect(thread._id).toBe(existing._id.toString());
        });

        it('should create new thread if none exists', async () => {
            const parentMessageId = new ObjectId().toString();
            const tagId = new ObjectId().toString();

            const thread = await getOrCreateThread({ parentMessageId, tagId });

            expect(thread).toBeDefined();
            expect(thread._id).toBeDefined();
            expect(thread.parentMessageId).toBe(parentMessageId);
        });
    });
});
