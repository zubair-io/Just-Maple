import { createTestUser } from './fixtures';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Helper to create a test user and get their auth token
 */
async function createTestUserAndGetToken(page: Page, apiBaseUrl: string) {
    return createTestUser(page, apiBaseUrl);
}

/**
 * Helper to authenticate a page with a token and user data
 */
async function authenticatePage(
    page: Page,
    token: string,
    userId: string,
    displayName: string,
    baseURL: string = 'http://localhost:7072',
): Promise<void> {
    await page.goto(baseURL);
    await page.evaluate(
        ({ t, uid, e }) => {
            const storageKey = `auth:${window.location.origin}`;
            const authData = {
                accessToken: t,
                user: {
                    _id: uid,
                    displayName: e,
                },
            };
            localStorage.setItem(storageKey, JSON.stringify(authData));
        },
        { t: token, uid: userId, e: displayName },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
}

/**
 * Helper to create a tag via API
 */
async function createTag(
    page: Page,
    token: string,
    label: string,
    baseURL: string = 'http://localhost:7072',
): Promise<{ _id: string; label: string }> {
    const response = await page.request.post(`${baseURL}/api/tags`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        data: { label },
    });

    if (!response.ok()) {
        throw new Error(`Failed to create tag: ${response.status()}`);
    }

    const data = await response.json();
    return data.tag;
}

/**
 * Helper to create a note via API
 */
async function createNote(
    page: Page,
    token: string,
    notebookId: string,
    title: string,
    baseURL: string = 'http://localhost:7072',
): Promise<{ _id: string; id: string }> {
    const response = await page.request.post(`${baseURL}/api/pages`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        data: {
            title,
            content: { type: 'doc', content: [] },
            notebookId,
            type: 'memo',
        },
    });

    if (!response.ok()) {
        throw new Error(`Failed to create note: ${response.status()}`);
    }

    const data = await response.json();
    return data.page;
}

// Run tests serially to avoid shared backend state conflicts
test.describe.serial('Y.js Collaboration Test (/write)', () => {
    test.skip('should sync edits between two browser windows in real-time', async ({
        browser,
        baseURL,
    }) => {
        const apiBaseUrl = baseURL || 'http://localhost:7072';

        // Create two separate browser contexts (like two different users/windows)
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        // Listen to console logs for debugging
        page1.on('console', (msg) => console.log('Page1:', msg.text()));
        page2.on('console', (msg) => console.log('Page2:', msg.text()));

        try {
            // Create a shared test user (both contexts will use the same auth)
            const testUser = await createTestUserAndGetToken(page1, apiBaseUrl);
            console.log('Test user created:', testUser.displayName);

            // Authenticate both pages with the same user
            await authenticatePage(
                page1,
                testUser.token,
                testUser.userId,
                testUser.displayName,
                apiBaseUrl,
            );
            await authenticatePage(
                page2,
                testUser.token,
                testUser.userId,
                testUser.displayName,
                apiBaseUrl,
            );

            // Create a tag and note for testing
            const tag = await createTag(
                page1,
                testUser.token,
                `Collab Test ${Date.now()}`,
                apiBaseUrl,
            );
            console.log('Tag created:', tag._id);

            const note = await createNote(
                page1,
                testUser.token,
                tag._id,
                'Collaboration Test Note',
                apiBaseUrl,
            );
            console.log('Note created:', note.id);

            // Navigate both pages to the same note
            const noteUrl = `${apiBaseUrl}/${tag._id}/${note.id}`;
            await page1.goto(noteUrl);
            await page2.goto(noteUrl);

            // Wait for both editors to be ready
            await page1.waitForLoadState('networkidle');
            await page2.waitForLoadState('networkidle');

            // Get the editor elements - ProseMirror creates a contenteditable element
            const editor1 = page1.locator('[contenteditable="true"]');
            const editor2 = page2.locator('[contenteditable="true"]');

            // Verify editors are visible with increased timeout
            await expect(editor1).toBeVisible({ timeout: 15000 });
            await expect(editor2).toBeVisible({ timeout: 15000 });

            console.log('Both editors are visible');

            // Wait for Y.js to establish connection
            await page1.waitForTimeout(3000);

            // Clear any existing content in editor1
            await editor1.click();
            await editor1.press('Control+A'); // Select all
            await editor1.press('Delete'); // Delete

            // Wait for delete to sync to editor2
            await page1.waitForTimeout(2000);

            // Use unique test strings
            const uniqueId = Date.now();
            const text1 = `Test1-${uniqueId}`;
            const text2 = `Test2-${uniqueId}`;

            // Type in the first editor
            await editor1.click();
            await editor1.pressSequentially(text1, { delay: 50 });
            await page1.waitForTimeout(500);
            await editor1.press('Enter'); // New paragraph
            await page1.waitForTimeout(500);
            await editor1.pressSequentially('Second line from window 1', { delay: 50 });

            // Wait for sync
            await page1.waitForTimeout(4000);

            // Debug: Check what's in both editors
            const text1After = await editor1.textContent();
            const text2After = await editor2.textContent();
            console.log('Editor 1 after typing:', text1After);
            console.log('Editor 2 after typing:', text2After);

            // Check that text appears in the second editor
            await expect(editor2).toContainText(text1, { timeout: 10000 });
            await expect(editor2).toContainText('Second line from window 1', { timeout: 10000 });

            // Type in the second editor
            await editor2.click();
            await editor2.press('End'); // Go to end
            await editor2.press('Enter'); // New paragraph
            await editor2.pressSequentially(text2);

            // Wait for sync
            await page2.waitForTimeout(3000);

            // Check that text appears in the first editor
            await expect(editor1).toContainText(text2, { timeout: 10000 });

            // Verify both editors have all texts
            await expect(editor1).toContainText(text1);
            await expect(editor1).toContainText('Second line from window 1');
            await expect(editor1).toContainText(text2);
            await expect(editor2).toContainText(text1);
            await expect(editor2).toContainText('Second line from window 1');
            await expect(editor2).toContainText(text2);
        } finally {
            // Clean up pages and contexts
            await page1.close();
            await page2.close();
            await context1.close();
            await context2.close();
        }
    });

    test.skip('should handle rapid typing from both windows', async ({ browser, baseURL }) => {
        const apiBaseUrl = baseURL || 'http://localhost:7072';

        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        try {
            // Create a shared test user
            const testUser = await createTestUserAndGetToken(page1, apiBaseUrl);

            // Authenticate both pages
            await authenticatePage(
                page1,
                testUser.token,
                testUser.userId,
                testUser.displayName,
                apiBaseUrl,
            );
            await authenticatePage(
                page2,
                testUser.token,
                testUser.userId,
                testUser.displayName,
                apiBaseUrl,
            );

            // Create a tag and note for testing
            const tag = await createTag(
                page1,
                testUser.token,
                `Rapid Test ${Date.now()}`,
                apiBaseUrl,
            );
            const note = await createNote(
                page1,
                testUser.token,
                tag._id,
                'Rapid Typing Test',
                apiBaseUrl,
            );

            // Navigate both pages to the same note
            const noteUrl = `${apiBaseUrl}/${tag._id}/${note.id}`;
            await page1.goto(noteUrl);
            await page2.goto(noteUrl);

            await page1.waitForLoadState('networkidle');
            await page2.waitForLoadState('networkidle');

            const editor1 = page1.locator('[contenteditable="true"]');
            const editor2 = page2.locator('[contenteditable="true"]');

            await expect(editor1).toBeVisible({ timeout: 15000 });
            await expect(editor2).toBeVisible({ timeout: 15000 });

            // Wait for Y.js connection
            await page1.waitForTimeout(3000);

            // Clear any existing content
            await editor1.click();
            await editor1.press('Control+A');
            await editor1.press('Delete');
            await page1.waitForTimeout(2000);

            // Rapidly type in both editors alternating
            await editor1.click();
            await editor1.pressSequentially('ABC', { delay: 50 });
            await page1.waitForTimeout(500);

            await editor2.click();
            await editor2.pressSequentially('123', { delay: 50 });
            await page1.waitForTimeout(500);

            await editor1.click();
            await editor1.pressSequentially('DEF', { delay: 50 });
            await page1.waitForTimeout(500);

            await editor2.click();
            await editor2.pressSequentially('456', { delay: 50 });

            // Wait for all syncs to complete
            await page1.waitForTimeout(5000);

            // Both editors should contain all characters (order may vary due to CRDT)
            const text1 = await editor1.textContent();
            const text2 = await editor2.textContent();

            console.log('Editor 1 final text:', text1);
            console.log('Editor 2 final text:', text2);

            // Check both have the same final text
            expect(text1).toBe(text2);

            // Check all characters are present
            expect(text1).toContain('ABC');
            expect(text1).toContain('123');
            expect(text1).toContain('DEF');
            expect(text1).toContain('456');
        } finally {
            // Clean up pages and contexts
            await page1.close();
            await page2.close();
            await context1.close();
            await context2.close();
        }
    });
});
