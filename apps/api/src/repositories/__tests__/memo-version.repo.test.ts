import { describe, it, expect, beforeEach } from 'vitest';
import {
    createMemoVersion,
    listMemoVersions,
    getMemoVersion,
    getMemoVersionState,
    getLatestMemoVersion,
    countMemoVersions,
    deleteMemoVersion,
    deleteMemoVersions,
    deleteAllMemoVersions,
    getVersionsOlderThan,
    getVersionStorageSize,
} from '../memo-version.repo';
import { createMemoVersionFixture, createPageFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';
import { randomUUID } from 'crypto';

describe.runIf(mongoAvailable)('MemoVersionRepo', () => {
    describe('createMemoVersion', () => {
        it('should create a new version with all fields', async () => {
            const noteId = randomUUID();
            const state = new Uint8Array([1, 2, 3, 4, 5]);

            const version = await createMemoVersion({
                noteId,
                state,
                version: 1,
                trigger: 'manual',
                label: 'Test checkpoint',
                contentPreview: 'Hello world',
                wordCount: 2,
                headingText: 'Test',
            });

            expect(version).toBeDefined();
            expect(version._id).toBeDefined();
            expect(version.noteId).toBe(noteId);
            expect(version.version).toBe(1);
            expect(version.trigger).toBe('manual');
            expect(version.label).toBe('Test checkpoint');
            expect(version.contentPreview).toBe('Hello world');
            expect(version.wordCount).toBe(2);
            expect(version.headingText).toBe('Test');
            expect(version.byteSize).toBe(5);
            expect(version.createdAt).toBeDefined();
        });

        it('should create version with auto-interval trigger', async () => {
            const noteId = randomUUID();
            const state = new Uint8Array([1, 2, 3]);

            const version = await createMemoVersion({
                noteId,
                state,
                version: 5,
                trigger: 'auto-interval',
            });

            expect(version.trigger).toBe('auto-interval');
            expect(version.version).toBe(5);
        });

        it('should compress large states', async () => {
            const noteId = randomUUID();
            // Create a state large enough to trigger compression (>1KB)
            // Use repetitive data that compresses well
            const largeState = new Uint8Array(2000);
            for (let i = 0; i < 2000; i++) {
                largeState[i] = i % 10;
            }

            const version = await createMemoVersion({
                noteId,
                state: largeState,
                version: 1,
                trigger: 'manual',
            });

            // Original size should be preserved
            expect(version.byteSize).toBe(2000);
        });
    });

    describe('listMemoVersions', () => {
        it('should return versions for a note sorted by createdAt desc', async () => {
            const noteId = randomUUID();

            // Create versions with different timestamps
            const now = new Date();
            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: new Date(now.getTime() - 3000),
            });
            await createMemoVersionFixture({
                noteId,
                version: 2,
                createdAt: new Date(now.getTime() - 2000),
            });
            await createMemoVersionFixture({
                noteId,
                version: 3,
                createdAt: new Date(now.getTime() - 1000),
            });

            const { versions, hasMore } = await listMemoVersions(noteId, 10);

            expect(versions).toHaveLength(3);
            expect(versions[0].version).toBe(3);
            expect(versions[1].version).toBe(2);
            expect(versions[2].version).toBe(1);
            expect(hasMore).toBe(false);
        });

        it('should paginate results with hasMore', async () => {
            const noteId = randomUUID();

            // Create 5 versions
            for (let i = 1; i <= 5; i++) {
                await createMemoVersionFixture({
                    noteId,
                    version: i,
                    createdAt: new Date(Date.now() - (5 - i) * 1000),
                });
            }

            const { versions, hasMore } = await listMemoVersions(noteId, 3);

            expect(versions).toHaveLength(3);
            expect(hasMore).toBe(true);
        });

        it('should return empty list for note with no versions', async () => {
            const noteId = randomUUID();

            const { versions, hasMore } = await listMemoVersions(noteId);

            expect(versions).toHaveLength(0);
            expect(hasMore).toBe(false);
        });

        it('should filter by before date', async () => {
            const noteId = randomUUID();
            const cutoffDate = new Date();

            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: new Date(cutoffDate.getTime() - 2000),
            });
            await createMemoVersionFixture({
                noteId,
                version: 2,
                createdAt: new Date(cutoffDate.getTime() + 1000),
            });

            const { versions } = await listMemoVersions(noteId, 10, cutoffDate);

            expect(versions).toHaveLength(1);
            expect(versions[0].version).toBe(1);
        });
    });

    describe('getMemoVersion', () => {
        it('should return version with state', async () => {
            const noteId = randomUUID();
            const state = new Uint8Array([10, 20, 30]);
            const fixture = await createMemoVersionFixture({
                noteId,
                state,
                version: 1,
                trigger: 'manual',
                label: 'Test',
            });

            const version = await getMemoVersion(noteId, fixture._id.toString());

            expect(version).not.toBeNull();
            expect(version!._id).toBe(fixture._id.toString());
            expect(version!.noteId).toBe(noteId);
            expect(version!.version).toBe(1);
            expect(version!.state).toBeDefined();
        });

        it('should return null for non-existent version', async () => {
            const noteId = randomUUID();
            const fakeVersionId = '507f1f77bcf86cd799439011';

            const version = await getMemoVersion(noteId, fakeVersionId);

            expect(version).toBeNull();
        });

        it('should return null for mismatched noteId', async () => {
            const noteId = randomUUID();
            const fixture = await createMemoVersionFixture({
                noteId,
                version: 1,
            });

            const version = await getMemoVersion('different-note-id', fixture._id.toString());

            expect(version).toBeNull();
        });

        it('should return null for invalid versionId', async () => {
            const version = await getMemoVersion(randomUUID(), 'invalid-id');

            expect(version).toBeNull();
        });
    });

    describe('getMemoVersionState', () => {
        it('should return decompressed state as Uint8Array', async () => {
            const noteId = randomUUID();
            const state = new Uint8Array([1, 2, 3, 4, 5]);
            const fixture = await createMemoVersionFixture({
                noteId,
                state,
            });

            const result = await getMemoVersionState(noteId, fixture._id.toString());

            expect(result).not.toBeNull();
            expect(result).toBeInstanceOf(Uint8Array);
            expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5]);
        });

        it('should return null for non-existent version', async () => {
            const result = await getMemoVersionState(randomUUID(), '507f1f77bcf86cd799439011');

            expect(result).toBeNull();
        });
    });

    describe('getLatestMemoVersion', () => {
        it('should return the most recent version', async () => {
            const noteId = randomUUID();

            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: new Date(Date.now() - 2000),
            });
            await createMemoVersionFixture({
                noteId,
                version: 2,
                createdAt: new Date(Date.now() - 1000),
            });

            const latest = await getLatestMemoVersion(noteId);

            expect(latest).not.toBeNull();
            expect(latest!.version).toBe(2);
        });

        it('should return null when no versions exist', async () => {
            const latest = await getLatestMemoVersion(randomUUID());

            expect(latest).toBeNull();
        });
    });

    describe('countMemoVersions', () => {
        it('should return correct count', async () => {
            const noteId = randomUUID();

            await createMemoVersionFixture({ noteId, version: 1 });
            await createMemoVersionFixture({ noteId, version: 2 });
            await createMemoVersionFixture({ noteId, version: 3 });

            const count = await countMemoVersions(noteId);

            expect(count).toBe(3);
        });

        it('should return 0 for note with no versions', async () => {
            const count = await countMemoVersions(randomUUID());

            expect(count).toBe(0);
        });
    });

    describe('deleteMemoVersion', () => {
        it('should delete a specific version', async () => {
            const noteId = randomUUID();
            const fixture = await createMemoVersionFixture({ noteId, version: 1 });

            const result = await deleteMemoVersion(noteId, fixture._id.toString());

            expect(result).toBe(true);

            const version = await getMemoVersion(noteId, fixture._id.toString());
            expect(version).toBeNull();
        });

        it('should return false for non-existent version', async () => {
            const result = await deleteMemoVersion(randomUUID(), '507f1f77bcf86cd799439011');

            expect(result).toBe(false);
        });

        it('should return false for mismatched noteId', async () => {
            const noteId = randomUUID();
            const fixture = await createMemoVersionFixture({ noteId, version: 1 });

            const result = await deleteMemoVersion('different-note-id', fixture._id.toString());

            expect(result).toBe(false);
        });
    });

    describe('deleteMemoVersions', () => {
        it('should delete multiple versions by IDs', async () => {
            const noteId = randomUUID();
            const v1 = await createMemoVersionFixture({ noteId, version: 1 });
            const v2 = await createMemoVersionFixture({ noteId, version: 2 });
            const v3 = await createMemoVersionFixture({ noteId, version: 3 });

            const deleted = await deleteMemoVersions([v1._id.toString(), v2._id.toString()]);

            expect(deleted).toBe(2);

            const count = await countMemoVersions(noteId);
            expect(count).toBe(1);
        });

        it('should return 0 for empty array', async () => {
            const deleted = await deleteMemoVersions([]);

            expect(deleted).toBe(0);
        });
    });

    describe('deleteAllMemoVersions', () => {
        it('should delete all versions for a note', async () => {
            const noteId = randomUUID();
            await createMemoVersionFixture({ noteId, version: 1 });
            await createMemoVersionFixture({ noteId, version: 2 });
            await createMemoVersionFixture({ noteId, version: 3 });

            const deleted = await deleteAllMemoVersions(noteId);

            expect(deleted).toBe(3);

            const count = await countMemoVersions(noteId);
            expect(count).toBe(0);
        });

        it('should return 0 for note with no versions', async () => {
            const deleted = await deleteAllMemoVersions(randomUUID());

            expect(deleted).toBe(0);
        });

        it('should not delete versions from other notes', async () => {
            const noteId1 = randomUUID();
            const noteId2 = randomUUID();

            await createMemoVersionFixture({ noteId: noteId1, version: 1 });
            await createMemoVersionFixture({ noteId: noteId2, version: 1 });

            await deleteAllMemoVersions(noteId1);

            const count1 = await countMemoVersions(noteId1);
            const count2 = await countMemoVersions(noteId2);

            expect(count1).toBe(0);
            expect(count2).toBe(1);
        });
    });

    describe('getVersionsOlderThan', () => {
        it('should return versions older than specified date', async () => {
            const noteId = randomUUID();
            const now = new Date();

            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: new Date(now.getTime() - 5000),
            });
            await createMemoVersionFixture({
                noteId,
                version: 2,
                createdAt: new Date(now.getTime() - 3000),
            });
            await createMemoVersionFixture({
                noteId,
                version: 3,
                createdAt: new Date(now.getTime() - 1000),
            });

            const cutoff = new Date(now.getTime() - 2000);
            const versions = await getVersionsOlderThan(noteId, cutoff);

            expect(versions).toHaveLength(2);
            expect(versions.map((v) => v.version)).toContain(1);
            expect(versions.map((v) => v.version)).toContain(2);
        });

        it('should return empty array when no versions are older', async () => {
            const noteId = randomUUID();
            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: new Date(),
            });

            const versions = await getVersionsOlderThan(noteId, new Date(Date.now() - 10000));

            expect(versions).toHaveLength(0);
        });
    });

    describe('getVersionStorageSize', () => {
        it('should return total byte size for a note', async () => {
            const noteId = randomUUID();

            await createMemoVersionFixture({
                noteId,
                state: new Uint8Array(100),
                version: 1,
            });
            await createMemoVersionFixture({
                noteId,
                state: new Uint8Array(200),
                version: 2,
            });

            const size = await getVersionStorageSize(noteId);

            expect(size).toBe(300);
        });

        it('should return 0 for note with no versions', async () => {
            const size = await getVersionStorageSize(randomUUID());

            expect(size).toBe(0);
        });
    });
});
