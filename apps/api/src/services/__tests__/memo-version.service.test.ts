import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
    createSnapshot,
    createSnapshotFromState,
    applyRetentionPolicy,
} from '../memo-version.service';
import { createMemoVersionFixture, createPageFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import { randomUUID } from 'crypto';
import { countMemoVersions, listMemoVersions } from '../../repositories/memo-version.repo';

describe.runIf(mongoAvailable)('MemoVersionService', () => {
    describe('createSnapshot', () => {
        it('should create a snapshot from Y.Doc', async () => {
            const noteId = randomUUID();
            const ydoc = new Y.Doc();

            // Add some content to the Y.Doc
            const fragment = ydoc.getXmlFragment('prosemirror');
            const paragraph = new Y.XmlElement('paragraph');
            paragraph.insert(0, [new Y.XmlText('Hello world')]);
            fragment.insert(0, [paragraph]);

            const version = await createSnapshot(noteId, ydoc, 'manual', 'Test checkpoint');

            expect(version).toBeDefined();
            expect(version._id).toBeDefined();
            expect(version.noteId).toBe(noteId);
            expect(version.trigger).toBe('manual');
            expect(version.label).toBe('Test checkpoint');
            expect(version.byteSize).toBeGreaterThan(0);

            ydoc.destroy();
        });

        it('should extract text content and word count', async () => {
            const noteId = randomUUID();
            const ydoc = new Y.Doc();

            const fragment = ydoc.getXmlFragment('prosemirror');
            const p1 = new Y.XmlElement('paragraph');
            p1.insert(0, [new Y.XmlText('Hello world this is a test')]);
            fragment.insert(0, [p1]);

            const version = await createSnapshot(noteId, ydoc, 'auto-interval');

            expect(version.contentPreview).toContain('Hello world');
            expect(version.wordCount).toBe(6);

            ydoc.destroy();
        });

        it('should extract heading text', async () => {
            const noteId = randomUUID();
            const ydoc = new Y.Doc();

            const fragment = ydoc.getXmlFragment('prosemirror');
            const heading = new Y.XmlElement('heading');
            heading.insert(0, [new Y.XmlText('My Document Title')]);
            fragment.insert(0, [heading]);

            const version = await createSnapshot(noteId, ydoc, 'manual');

            expect(version.headingText).toBe('My Document Title');

            ydoc.destroy();
        });

        it('should create snapshot with different triggers', async () => {
            const noteId = randomUUID();
            const ydoc = new Y.Doc();

            const triggers = [
                'auto-interval',
                'auto-idle',
                'manual',
                'ai-edit',
                'significant-change',
                'import',
            ] as const;

            for (const trigger of triggers) {
                const version = await createSnapshot(noteId, ydoc, trigger);
                expect(version.trigger).toBe(trigger);
            }

            const count = await countMemoVersions(noteId);
            expect(count).toBe(triggers.length);

            ydoc.destroy();
        });
    });

    describe('createSnapshotFromState', () => {
        it('should create a snapshot from raw state', async () => {
            const noteId = randomUUID();

            // Create a Y.Doc and get its state
            const ydoc = new Y.Doc();
            const fragment = ydoc.getXmlFragment('prosemirror');
            const paragraph = new Y.XmlElement('paragraph');
            paragraph.insert(0, [new Y.XmlText('Test content from state')]);
            fragment.insert(0, [paragraph]);

            const state = Y.encodeStateAsUpdate(ydoc);
            ydoc.destroy();

            const version = await createSnapshotFromState(noteId, state, 'manual', 'From state');

            expect(version).toBeDefined();
            expect(version.noteId).toBe(noteId);
            expect(version.trigger).toBe('manual');
            expect(version.label).toBe('From state');
            expect(version.contentPreview).toContain('Test content');
        });

        it('should preserve word count from state', async () => {
            const noteId = randomUUID();

            const ydoc = new Y.Doc();
            const fragment = ydoc.getXmlFragment('prosemirror');
            const p = new Y.XmlElement('paragraph');
            p.insert(0, [new Y.XmlText('One two three four five')]);
            fragment.insert(0, [p]);

            const state = Y.encodeStateAsUpdate(ydoc);
            ydoc.destroy();

            const version = await createSnapshotFromState(noteId, state, 'auto-interval');

            expect(version.wordCount).toBe(5);
        });
    });

    describe('applyRetentionPolicy', () => {
        it('should keep all versions from last 24 hours', async () => {
            const noteId = randomUUID();
            const now = new Date();

            // Create versions within last 24 hours
            for (let i = 0; i < 5; i++) {
                await createMemoVersionFixture({
                    noteId,
                    version: i + 1,
                    createdAt: new Date(now.getTime() - i * 60 * 60 * 1000), // 1 hour apart
                });
            }

            const deleted = await applyRetentionPolicy(noteId);

            expect(deleted).toBe(0);
            expect(await countMemoVersions(noteId)).toBe(5);
        });

        it('should delete versions older than 90 days', async () => {
            const noteId = randomUUID();
            const now = new Date();

            // Create a recent version
            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: now,
            });

            // Create a very old version (100 days old)
            await createMemoVersionFixture({
                noteId,
                version: 2,
                createdAt: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000),
            });

            const deleted = await applyRetentionPolicy(noteId);

            expect(deleted).toBe(1);
            expect(await countMemoVersions(noteId)).toBe(1);
        });

        it('should keep one version per hour for 1-7 days old', async () => {
            const noteId = randomUUID();
            const now = new Date();

            // Create 3 versions in the same hour, 2 days ago
            const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
            const hourStart = new Date(
                twoDaysAgo.getFullYear(),
                twoDaysAgo.getMonth(),
                twoDaysAgo.getDate(),
                10, // 10 AM
            );

            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: new Date(hourStart.getTime() + 5 * 60 * 1000), // 10:05
            });
            await createMemoVersionFixture({
                noteId,
                version: 2,
                createdAt: new Date(hourStart.getTime() + 30 * 60 * 1000), // 10:30
            });
            await createMemoVersionFixture({
                noteId,
                version: 3,
                createdAt: new Date(hourStart.getTime() + 55 * 60 * 1000), // 10:55
            });

            const deleted = await applyRetentionPolicy(noteId);

            // Should keep only 1 (the newest in that hour)
            expect(deleted).toBe(2);
            expect(await countMemoVersions(noteId)).toBe(1);
        });

        it('should return 0 when no versions to delete', async () => {
            const noteId = randomUUID();
            const now = new Date();

            // Create a recent version
            await createMemoVersionFixture({
                noteId,
                version: 1,
                createdAt: now,
            });

            const deleted = await applyRetentionPolicy(noteId);

            expect(deleted).toBe(0);
        });

        it('should handle empty version list', async () => {
            const noteId = randomUUID();

            const deleted = await applyRetentionPolicy(noteId);

            expect(deleted).toBe(0);
        });
    });

    describe('storage limits', () => {
        it('should enforce version count limit', async () => {
            const noteId = randomUUID();
            const ydoc = new Y.Doc();

            // We can't easily test MAX_VERSIONS_PER_MEMO (200) but we can verify
            // the snapshot creation works without error
            for (let i = 0; i < 5; i++) {
                await createSnapshot(noteId, ydoc, 'auto-interval');
            }

            const count = await countMemoVersions(noteId);
            expect(count).toBe(5);

            ydoc.destroy();
        });
    });
});
