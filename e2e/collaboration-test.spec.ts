import { test, expect, Page } from '@playwright/test';

const TEST_USER = {
    email: 'test@example.com',
    // Dev token from auth service - will be fetched dynamically
};

async function loginWithDevToken(page: Page) {
    // Navigate to home page
    await page.goto('http://localhost:4200');

    // Check if already logged in by looking for editor or sidebar
    const isLoggedIn = await page.locator('.sidebar, .editor-content').count();
    if (isLoggedIn > 0) {
        console.log('✓ Already logged in');
        return;
    }

    // Click "Get Started" or "Sign In" to go to login page
    const getStartedBtn = page.locator('button:has-text("Get Started")');
    const signInBtn = page.locator('a:has-text("Sign In"), button:has-text("Sign In")');

    if ((await getStartedBtn.count()) > 0) {
        await getStartedBtn.click();
    } else if ((await signInBtn.count()) > 0) {
        await signInBtn.click();
    }

    // Wait for login form
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });

    // Enter email
    await page.fill('input[type="email"]', TEST_USER.email);

    // Click "Send Magic Link" button to use dev token
    await page.click('button:has-text("Send Magic Link")');

    // Wait for verification page to load
    await page.waitForSelector('text=Check your email!', { timeout: 5000 });

    // Click "Click here to verify" link in Dev Mode section
    await page.click('text=Click here to verify');

    // Wait for navigation to app (should redirect to notes/tags)
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('✓ Logged in successfully with dev token');
}

async function createNote(page: Page, title: string, content: string): Promise<string> {
    // Click "New Note" button
    await page.click('button:has-text("New Note"), button:has-text("Create Note")');

    // Wait for editor to load
    await page.waitForSelector('.editor-content', { timeout: 5000 });

    // Type title (first heading)
    const editor = page.locator('.editor-content').first();
    await editor.click();
    await page.keyboard.type(title);

    // Press Enter to create paragraph
    await page.keyboard.press('Enter');

    // Type content
    await page.keyboard.type(content);

    // Wait for auto-save
    await page.waitForTimeout(2000);

    // Get the full URL path (includes tagId/noteId)
    const url = page.url();
    const pathMatch = url.match(/http:\/\/[^\/]+\/(.+)$/);
    const path = pathMatch ? pathMatch[1] : '';

    console.log(`✓ Created note: ${title} (Path: ${path})`);
    return path;
}

async function switchToNote(page: Page, notePath: string) {
    // Navigate using full path (tagId/noteId)
    await page.goto(`http://localhost:4200/${notePath}`);
    await page.waitForSelector('.editor-content', { timeout: 5000 });
    console.log(`✓ Switched to note: ${notePath}`);
}

async function getEditorContent(page: Page): Promise<string> {
    // Get the entire text content of the editor
    const content = await page.locator('.editor-content').first().innerText();
    return content;
}

test.describe('Note Switching with Collaboration', () => {
    test('should switch between notes and preserve content correctly', async ({ page }) => {
        // Enable verbose console logging
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.text().includes('Error')) {
                console.log(`[Browser Error] ${msg.text()}`);
            }
            if (msg.text().includes('[Collab]') || msg.text().includes('[Note Editor]')) {
                console.log(`[Browser] ${msg.text()}`);
            }
        });

        // Login
        await loginWithDevToken(page);

        // Create first note
        const note1Title = `Test Note 1 - ${Date.now()}`;
        const note1Content = 'This is the content of the first test note.';
        const note1Id = await createNote(page, note1Title, note1Content);

        // Verify first note content
        let content = await getEditorContent(page);
        expect(content).toContain(note1Title);
        expect(content).toContain(note1Content);
        console.log('✓ First note content verified');

        // Create second note
        const note2Title = `Test Note 2 - ${Date.now()}`;
        const note2Content = 'This is the content of the second test note.';
        const note2Id = await createNote(page, note2Title, note2Content);

        // Verify second note content
        content = await getEditorContent(page);
        expect(content).toContain(note2Title);
        expect(content).toContain(note2Content);
        console.log('✓ Second note content verified');

        // Switch back to first note
        await switchToNote(page, note1Id);

        // Wait for editor to fully load
        await page.waitForTimeout(1000);

        // Verify first note content is still correct
        content = await getEditorContent(page);
        expect(content).toContain(note1Title);
        expect(content).toContain(note1Content);
        expect(content).not.toContain(note2Title);
        expect(content).not.toContain(note2Content);
        console.log('✓ First note content preserved after switching');

        // Switch back to second note
        await switchToNote(page, note2Id);

        // Wait for editor to fully load
        await page.waitForTimeout(1000);

        // Verify second note content is still correct
        content = await getEditorContent(page);
        expect(content).toContain(note2Title);
        expect(content).toContain(note2Content);
        expect(content).not.toContain(note1Title);
        expect(content).not.toContain(note1Content);
        console.log('✓ Second note content preserved after switching');

        // Check for console errors
        const errors = await page.evaluate(() => {
            return window.console['errors'] || [];
        });

        if (errors.length > 0) {
            console.warn(`⚠ Found ${errors.length} console errors`);
        }

        console.log('✅ All note switching tests passed!');
    });

    test('should handle rapid note switching without errors', async ({ page }) => {
        // Enable error logging
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        // Login
        await loginWithDevToken(page);

        // Create 3 notes
        const noteIds: string[] = [];
        for (let i = 1; i <= 3; i++) {
            const title = `Rapid Switch Test ${i} - ${Date.now()}`;
            const content = `Content for rapid switch test note ${i}`;
            const noteId = await createNote(page, title, content);
            noteIds.push(noteId);
            await page.waitForTimeout(500);
        }

        console.log('✓ Created 3 test notes');

        // Rapidly switch between notes
        for (let i = 0; i < 5; i++) {
            for (const noteId of noteIds) {
                await switchToNote(page, noteId);
                await page.waitForTimeout(300); // Short delay
            }
        }

        console.log('✓ Completed rapid switching');

        // Check for errors
        const criticalErrors = errors.filter(
            (err) =>
                !err.includes('Unexpected end of array') && // Known Y.js warning
                !err.includes('ExpressionChangedAfterItHasBeenCheckedError'), // Dev mode warning
        );

        expect(criticalErrors.length).toBe(0);
        console.log('✅ Rapid switching test passed with no critical errors!');
    });

    test('should show collaboration status and handle WebSocket correctly', async ({ page }) => {
        // Y.js WebSocket collaboration has been fixed:
        // - UpdateNoteSchema now includes Y.js fields for persistence
        // - updateNoteInternal() allows Y.js service to save updates
        // - Binary message encoding/decoding is working correctly

        // Login
        await loginWithDevToken(page);

        // Create a note
        const title = `WebSocket Test - ${Date.now()}`;
        const content = 'Testing WebSocket collaboration status';
        const noteId = await createNote(page, title, content);

        // Check browser console for collaboration logs
        const collabLogs: string[] = [];
        page.on('console', (msg) => {
            if (msg.text().includes('[Collab]')) {
                collabLogs.push(msg.text());
            }
        });

        // Wait for WebSocket to connect
        await page.waitForTimeout(2000);

        // Verify we see collaboration initialization
        const hasInitLog = collabLogs.some(
            (log) => log.includes('Initialized IndexedDB') || log.includes('WebSocket provider'),
        );
        expect(hasInitLog).toBe(true);

        // Verify WebSocket connected
        const hasConnectedLog = collabLogs.some((log) => log.includes('connected'));
        expect(hasConnectedLog).toBe(true);

        console.log('✅ WebSocket collaboration test passed!');
    });
});
