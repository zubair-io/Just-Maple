import { describe, it, expect, beforeEach } from 'vitest';
import { searchNotes } from '../search.service';
import { indexPage } from '../../repositories/search.repo';
import {
    createUserFixture,
    createNotebookFixture,
    createPageFixture,
} from '../../__tests__/helpers/fixtures';
import { testDb, mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('SearchService', () => {
    describe('searchNotes', () => {
        beforeEach(async () => {
            // Create the text index for search
            try {
                await testDb!
                    .collection('search_index')
                    .createIndex(
                        { title: 'text', plainText: 'text' },
                        { weights: { title: 10, plainText: 1 }, name: 'search_text_index' },
                    );
            } catch {
                // Index may already exist
            }
        });

        it('should find pages by title', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
            });
            const page = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                type: 'memo',
                title: 'Unique Search Term Here',
            });

            await indexPage(page.id);

            const results = await searchNotes('Unique Search Term', {
                userId: user._id.toString(),
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].pageId).toBe(page.id);
            expect(results[0].title).toBe('Unique Search Term Here');
        });

        it('should find pages by content', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
            });
            const page = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                type: 'memo',
                title: 'Test Page',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'uniquecontentterm12345' }],
                        },
                    ],
                },
            });

            await indexPage(page.id);

            const results = await searchNotes('uniquecontentterm12345', {
                userId: user._id.toString(),
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].pageId).toBe(page.id);
        });

        it('should return highlighted snippets', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
            });
            const page = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                type: 'memo',
                title: 'Test',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'This contains the searchword here.' }],
                        },
                    ],
                },
            });

            await indexPage(page.id);

            const results = await searchNotes('searchword', {
                userId: user._id.toString(),
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].snippet).toContain('<mark>');
            expect(results[0].snippet.toLowerCase()).toContain('searchword');
        });

        it('should respect access control - only search accessible notebooks', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();

            // User1's notebook (not shared with user2)
            const notebook1 = await createNotebookFixture({
                createdBy: user1._id.toString(),
            });
            const page1 = await createPageFixture({
                userId: user1._id.toString(),
                notebookId: notebook1._id.toString(),
                type: 'memo',
                title: 'private data for user1',
            });

            // User2's notebook
            const notebook2 = await createNotebookFixture({
                createdBy: user2._id.toString(),
            });
            const page2 = await createPageFixture({
                userId: user2._id.toString(),
                notebookId: notebook2._id.toString(),
                type: 'memo',
                title: 'private data for user2',
            });

            await indexPage(page1.id);
            await indexPage(page2.id);

            // User2 should only find their own page
            const results = await searchNotes('private data', {
                userId: user2._id.toString(),
            });

            expect(results.length).toBe(1);
            expect(results[0].pageId).toBe(page2.id);
        });

        it('should filter by type', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
            });
            const memoPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                type: 'memo',
                title: 'test memo page',
            });
            const whiteboardPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                type: 'whiteboard',
                title: 'test whiteboard page',
            });

            await indexPage(memoPage.id);
            await indexPage(whiteboardPage.id);

            const results = await searchNotes('test', {
                userId: user._id.toString(),
                types: ['memo'],
            });

            expect(results.length).toBe(1);
            expect(results[0].type).toBe('memo');
        });

        it('should filter by notebook', async () => {
            const user = await createUserFixture();
            const notebook1 = await createNotebookFixture({
                createdBy: user._id.toString(),
                label: 'Notebook 1',
            });
            const notebook2 = await createNotebookFixture({
                createdBy: user._id.toString(),
                label: 'Notebook 2',
            });
            const page1 = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook1._id.toString(),
                type: 'memo',
                title: 'test in notebook1',
            });
            const page2 = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook2._id.toString(),
                type: 'memo',
                title: 'test in notebook2',
            });

            await indexPage(page1.id);
            await indexPage(page2.id);

            const results = await searchNotes('test', {
                userId: user._id.toString(),
                notebookIds: [notebook1._id.toString()],
            });

            expect(results.length).toBe(1);
            expect(results[0].notebookId).toBe(notebook1._id.toString());
        });

        it('should respect limit parameter', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
            });

            // Create multiple pages
            for (let i = 0; i < 5; i++) {
                const page = await createPageFixture({
                    userId: user._id.toString(),
                    notebookId: notebook._id.toString(),
                    type: 'memo',
                    title: `limit test page ${i}`,
                });
                await indexPage(page.id);
            }

            const results = await searchNotes('limit test', {
                userId: user._id.toString(),
                limit: 2,
            });

            expect(results.length).toBe(2);
        });

        it('should return empty array when no notebooks accessible', async () => {
            const user = await createUserFixture();
            // No notebooks created for this user

            const results = await searchNotes('anything', {
                userId: user._id.toString(),
            });

            expect(results).toEqual([]);
        });
    });
});
