import { describe, it, expect, beforeEach } from 'vitest';
import { indexPage, removeFromIndex, reindexAllForUser } from '../search.repo';
import {
    createUserFixture,
    createNotebookFixture,
    createPageFixture,
} from '../../__tests__/helpers/fixtures';
import { testDb, mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('SearchRepo', () => {
    describe('indexPage', () => {
        it('should index a page with title and content', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
                label: 'Test Notebook',
            });
            const page = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                type: 'memo',
                title: 'Test Page Title',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'This is the page content.' }],
                        },
                    ],
                },
            });

            await indexPage(page.id);

            const indexed = await testDb!.collection('search_index').findOne({ pageId: page.id });
            expect(indexed).not.toBeNull();
            expect(indexed!.title).toBe('Test Page Title');
            expect(indexed!.plainText).toContain('Test Page Title');
            expect(indexed!.plainText).toContain('This is the page content.');
            expect(indexed!.notebookId).toBe(notebook._id.toString());
            expect(indexed!.notebookLabel).toBe('Test Notebook');
            expect(indexed!.type).toBe('memo');
        });

        it('should update existing index entry when reindexed', async () => {
            const user = await createUserFixture();
            const page = await createPageFixture({
                userId: user._id.toString(),
                type: 'memo',
                title: 'Original Title',
            });

            await indexPage(page.id);

            // Update the page title in DB
            await testDb!
                .collection('pages')
                .updateOne({ id: page.id }, { $set: { title: 'Updated Title' } });

            await indexPage(page.id);

            const indexed = await testDb!.collection('search_index').findOne({ pageId: page.id });
            expect(indexed!.title).toBe('Updated Title');

            // Should only have one entry
            const count = await testDb!
                .collection('search_index')
                .countDocuments({ pageId: page.id });
            expect(count).toBe(1);
        });

        it('should not index non-existent pages', async () => {
            await indexPage('non-existent-page-id');

            const indexed = await testDb!
                .collection('search_index')
                .findOne({ pageId: 'non-existent-page-id' });
            expect(indexed).toBeNull();
        });

        it('should generate preview from plainText', async () => {
            const user = await createUserFixture();
            const longContent = 'A'.repeat(300);
            const page = await createPageFixture({
                userId: user._id.toString(),
                type: 'memo',
                title: 'Test',
                content: {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: longContent }] },
                    ],
                },
            });

            await indexPage(page.id);

            const indexed = await testDb!.collection('search_index').findOne({ pageId: page.id });
            expect(indexed!.preview.length).toBeLessThanOrEqual(200);
        });
    });

    describe('removeFromIndex', () => {
        it('should remove page from search index', async () => {
            const user = await createUserFixture();
            const page = await createPageFixture({
                userId: user._id.toString(),
                type: 'memo',
                title: 'Test Page',
            });

            await indexPage(page.id);
            let indexed = await testDb!.collection('search_index').findOne({ pageId: page.id });
            expect(indexed).not.toBeNull();

            await removeFromIndex(page.id);

            indexed = await testDb!.collection('search_index').findOne({ pageId: page.id });
            expect(indexed).toBeNull();
        });

        it('should not fail when removing non-existent entry', async () => {
            await expect(removeFromIndex('non-existent-id')).resolves.not.toThrow();
        });
    });

    describe('reindexAllForUser', () => {
        it('should index all pages for a user', async () => {
            const user = await createUserFixture();
            const page1 = await createPageFixture({
                userId: user._id.toString(),
                type: 'memo',
                title: 'Page 1',
            });
            const page2 = await createPageFixture({
                userId: user._id.toString(),
                type: 'memo',
                title: 'Page 2',
            });

            await reindexAllForUser(user._id.toString());

            const indexed1 = await testDb!.collection('search_index').findOne({ pageId: page1.id });
            const indexed2 = await testDb!.collection('search_index').findOne({ pageId: page2.id });

            expect(indexed1).not.toBeNull();
            expect(indexed2).not.toBeNull();
        });

        it('should not index pages from other users', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const page1 = await createPageFixture({
                userId: user1._id.toString(),
                type: 'memo',
                title: 'User1 Page',
            });
            const page2 = await createPageFixture({
                userId: user2._id.toString(),
                type: 'memo',
                title: 'User2 Page',
            });

            await reindexAllForUser(user1._id.toString());

            const indexed1 = await testDb!.collection('search_index').findOne({ pageId: page1.id });
            const indexed2 = await testDb!.collection('search_index').findOne({ pageId: page2.id });

            expect(indexed1).not.toBeNull();
            expect(indexed2).toBeNull();
        });
    });
});
