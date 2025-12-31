import { test, expect } from './fixtures';

/**
 * Y.js Collaboration - Data Loading Tests
 *
 * These tests verify that the critical Y.js data persistence bugs are fixed:
 * - Bug 1: UpdateNoteSchema now includes Y.js fields (yjsSnapshot, yjsUpdates, lastCompactedAt)
 * - Bug 2: updateNoteInternal() function allows Y.js service to persist updates
 * - Bug 3: NoteDocument type and toNoteResponse() include Y.js fields
 */

test.describe('Y.js Collaboration - Data Loading', () => {
    test('should load existing note content via Y.js WebSocket sync', async ({
        authenticatedPage,
        testUser,
    }) => {
        // Create a note via API with ProseMirror content
        const createResponse = await authenticatedPage.request.post(
            'http://localhost:7071/api/notes',
            {
                headers: {
                    Authorization: `Bearer ${testUser.token}`,
                },
                data: {
                    title: 'Collaborative Note',
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'heading',
                                attrs: { level: 1 },
                                content: [{ type: 'text', text: 'Hello World' }],
                            },
                            {
                                type: 'paragraph',
                                content: [
                                    { type: 'text', text: 'Initial content from ProseMirror' },
                                ],
                            },
                        ],
                    },
                },
            },
        );

        expect(createResponse.ok()).toBeTruthy();
        const note = await createResponse.json();
        const noteId = note._id;

        // Navigate to the note
        await authenticatedPage.goto(`/chat/${noteId}`);

        // Wait for editor to be visible
        await authenticatedPage.waitForSelector('.tiptap', { timeout: 10000 });

        // Wait for collaboration to initialize (WebSocket connection + sync)
        await authenticatedPage.waitForTimeout(3000);

        // Verify content loaded
        const heading = await authenticatedPage.locator('.tiptap h1').textContent();
        expect(heading).toContain('Hello World');

        const editorText = await authenticatedPage.locator('.tiptap').textContent();
        expect(editorText).toContain('Initial content from ProseMirror');
    });

    test('should persist edits to MongoDB and reload them', async ({
        authenticatedPage,
        testUser,
    }) => {
        // Create a note via API
        const createResponse = await authenticatedPage.request.post(
            'http://localhost:7071/api/notes',
            {
                headers: {
                    Authorization: `Bearer ${testUser.token}`,
                },
                data: {
                    title: 'Persistence Test',
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'heading',
                                attrs: { level: 1 },
                                content: [{ type: 'text', text: 'Original Title' }],
                            },
                        ],
                    },
                },
            },
        );

        expect(createResponse.ok()).toBeTruthy();
        const note = await createResponse.json();
        const noteId = note._id;

        // Navigate to the note
        await authenticatedPage.goto(`/chat/${noteId}`);
        await authenticatedPage.waitForSelector('.tiptap', { timeout: 10000 });
        await authenticatedPage.waitForTimeout(2000);

        // Make an edit to the heading
        await authenticatedPage.click('.tiptap h1');
        await authenticatedPage.keyboard.press('End');
        await authenticatedPage.keyboard.type(' - Edited');

        // Wait for Y.js update to persist (give server time to save)
        await authenticatedPage.waitForTimeout(4000);

        // Reload the page
        await authenticatedPage.reload();
        await authenticatedPage.waitForSelector('.tiptap', { timeout: 10000 });
        await authenticatedPage.waitForTimeout(2000);

        // Verify the edit persisted
        const heading = await authenticatedPage.locator('.tiptap h1').textContent();
        expect(heading).toContain('Edited');
    });

    test('should not show empty note when data exists (regression test)', async ({
        authenticatedPage,
        testUser,
    }) => {
        // This is the specific bug the user reported:
        // "on init load nothing is loading so i clean all data and login the note is empty even when there is data"

        // Create a note with content
        const createResponse = await authenticatedPage.request.post(
            'http://localhost:7071/api/notes',
            {
                headers: {
                    Authorization: `Bearer ${testUser.token}`,
                },
                data: {
                    title: 'Non-Empty Note',
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'heading',
                                attrs: { level: 1 },
                                content: [{ type: 'text', text: 'Important Content' }],
                            },
                            {
                                type: 'paragraph',
                                content: [{ type: 'text', text: 'This should not be empty' }],
                            },
                        ],
                    },
                },
            },
        );

        expect(createResponse.ok()).toBeTruthy();
        const note = await createResponse.json();
        const noteId = note._id;

        // Navigate to the note
        await authenticatedPage.goto(`/chat/${noteId}`);
        await authenticatedPage.waitForSelector('.tiptap', { timeout: 10000 });
        await authenticatedPage.waitForTimeout(3000);

        // Verify note is NOT empty
        const editorText = await authenticatedPage.locator('.tiptap').textContent();
        expect(editorText.trim().length).toBeGreaterThan(0);
        expect(editorText).toContain('Important Content');
        expect(editorText).toContain('This should not be empty');
    });

    test('should handle WebSocket reconnection and sync', async ({
        authenticatedPage,
        testUser,
    }) => {
        // Create a note
        const createResponse = await authenticatedPage.request.post(
            'http://localhost:7071/api/notes',
            {
                headers: {
                    Authorization: `Bearer ${testUser.token}`,
                },
                data: {
                    title: 'Reconnection Test',
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'heading',
                                attrs: { level: 1 },
                                content: [{ type: 'text', text: 'Reconnect Test' }],
                            },
                        ],
                    },
                },
            },
        );

        expect(createResponse.ok()).toBeTruthy();
        const note = await createResponse.json();
        const noteId = note._id;

        // Navigate to note
        await authenticatedPage.goto(`/chat/${noteId}`);
        await authenticatedPage.waitForSelector('.tiptap', { timeout: 10000 });
        await authenticatedPage.waitForTimeout(2000);

        // Verify initial content
        let heading = await authenticatedPage.locator('.tiptap h1').textContent();
        expect(heading).toContain('Reconnect Test');

        // Make an edit
        await authenticatedPage.click('.tiptap h1');
        await authenticatedPage.keyboard.press('End');
        await authenticatedPage.keyboard.type(' - Modified');

        // Wait for persistence
        await authenticatedPage.waitForTimeout(3000);

        // Simulate reconnection by reloading
        await authenticatedPage.reload();
        await authenticatedPage.waitForSelector('.tiptap', { timeout: 10000 });
        await authenticatedPage.waitForTimeout(2000);

        // Verify edit survived reconnection
        heading = await authenticatedPage.locator('.tiptap h1').textContent();
        expect(heading).toContain('Modified');
    });
});
