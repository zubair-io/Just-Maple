import { test, expect } from './fixtures';

// Run tests serially to avoid shared backend state conflicts
test.describe.serial('Automerge Collaboration Test (/write)', () => {
    test('should sync edits between two browser windows in real-time', async ({ browser }) => {
        // Use unique database name for this test run
        const testDbName = `test-${Date.now()}`;
        const testUrl = `http://localhost:4200/write?db=${testDbName}`;

        // Create two separate browser contexts (like two different windows)
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        // Listen to console logs for debugging
        page1.on('console', (msg) => console.log('Page1:', msg.text()));
        page2.on('console', (msg) => console.log('Page2:', msg.text()));

        try {
            // Navigate to page with unique database
            await page1.goto(testUrl);

            // Wait for page1 to create and store document URL
            await page1.waitForTimeout(2000);

            // Get the document URL from page1
            const docUrl = await page1.evaluate((dbName) => {
                return localStorage.getItem(`${dbName}-doc-url`);
            }, testDbName);

            console.log('Shared document URL:', docUrl);

            // Set the same document URL in page2 BEFORE navigating to /write
            await page2.goto('http://localhost:4200');
            await page2.evaluate(
                ({ url, dbName }) => {
                    if (url) {
                        localStorage.setItem(`${dbName}-doc-url`, url);
                    }
                },
                { url: docUrl, dbName: testDbName },
            );

            // Now navigate to /write with the same database name
            await page2.goto(testUrl);

            // Wait for both editors to be ready and WebSocket to connect
            await page1.waitForTimeout(2000);
            await page2.waitForTimeout(2000);

            // Get the editor elements - ProseMirror creates a contenteditable element
            const editor1 = page1.locator('[contenteditable="true"]');
            const editor2 = page2.locator('[contenteditable="true"]');

            // Verify editors are visible
            await expect(editor1).toBeVisible();
            await expect(editor2).toBeVisible();

            console.log('Editor1 role:', await editor1.getAttribute('role'));
            console.log('Editor2 role:', await editor2.getAttribute('role'));

            // Clear any existing content in editor1
            await editor1.click();
            await editor1.press('Control+A'); // Select all
            await editor1.press('Delete'); // Delete

            // Wait for delete to sync to editor2
            await page1.waitForTimeout(2000);

            // Verify both editors are now empty (or nearly empty)
            const text1Before = await editor1.textContent();
            const text2Before = await editor2.textContent();
            console.log('Editor 1 content after delete:', text1Before);
            console.log('Editor 2 content after delete:', text2Before);

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
            await expect(editor2).toContainText(text1);
            await expect(editor2).toContainText('Second line from window 1');

            // Type in the second editor
            await editor2.click();
            await editor2.press('End'); // Go to end
            await editor2.press('Enter'); // New paragraph
            await editor2.pressSequentially(text2);

            // Wait for sync
            await page2.waitForTimeout(2000);

            // Check that text appears in the first editor
            await expect(editor1).toContainText(text2);

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

    test('should handle rapid typing from both windows', async ({ browser }) => {
        // Use unique database name for this test run
        const testDbName = `test-${Date.now()}`;
        const testUrl = `http://localhost:4200/write?db=${testDbName}`;

        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        try {
            // Navigate to page with unique database
            await page1.goto(testUrl);
            await page1.waitForTimeout(2000);

            // Get the document URL from page1
            const docUrl = await page1.evaluate((dbName) => {
                return localStorage.getItem(`${dbName}-doc-url`);
            }, testDbName);

            // Set the same document URL in page2
            await page2.goto('http://localhost:4200');
            await page2.evaluate(
                ({ url, dbName }) => {
                    if (url) {
                        localStorage.setItem(`${dbName}-doc-url`, url);
                    }
                },
                { url: docUrl, dbName: testDbName },
            );

            // Now navigate to /write with the same database name
            await page2.goto(testUrl);

            await page1.waitForTimeout(2000);
            await page2.waitForTimeout(2000);

            const editor1 = page1.locator('[contenteditable="true"]');
            const editor2 = page2.locator('[contenteditable="true"]');

            await expect(editor1).toBeVisible();
            await expect(editor2).toBeVisible();

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
            await page1.waitForTimeout(4000);

            // Both editors should contain all characters (order may vary due to CRDT)
            const text1 = await editor1.textContent();
            const text2 = await editor2.textContent();

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
