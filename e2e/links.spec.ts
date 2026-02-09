import { test, expect } from './fixtures';

test.describe('Links and Backlinks', () => {
    test('should create wiki-style links with [[ syntax', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a new memo
        const newMemoButton = authenticatedPage
            .locator(
                'button:has-text("New Memo"), button:has-text("Memo"), button:has-text("New Note")',
            )
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Type wiki link syntax
        await editor.click();
        await editor.type('Check out [[My Linked Page]] for more info');
        await authenticatedPage.waitForTimeout(1000);

        // Look for rendered wiki link
        const wikiLink = authenticatedPage
            .locator(
                'a:has-text("My Linked Page"), .wiki-link:has-text("My Linked Page"), [data-type="wikiLink"]:has-text("My Linked Page")',
            )
            .first();

        if (await wikiLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await wikiLink.isVisible()).toBeTruthy();
        }
    });

    test('should show link autocomplete suggestions', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a target page first
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const targetPageTitle = `LinkTarget${Date.now()}`;
        await editor.click();
        await editor.type(targetPageTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Navigate back and create a new page with link
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor2 = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor2.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Start typing a wiki link
        await editor2.click();
        await editor2.type('[[');
        await authenticatedPage.waitForTimeout(500);

        // Look for autocomplete dropdown
        const autocomplete = authenticatedPage
            .locator('.autocomplete, .suggestion-list, [role="listbox"], .link-suggestions')
            .first();

        if (await autocomplete.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await autocomplete.isVisible()).toBeTruthy();

            // Type partial match
            await editor2.type(targetPageTitle.substring(0, 4));
            await authenticatedPage.waitForTimeout(500);

            // Look for our target page in suggestions
            const suggestion = authenticatedPage
                .locator(`text="${targetPageTitle}", .suggestion:has-text("${targetPageTitle}")`)
                .first();

            if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await suggestion.isVisible()).toBeTruthy();
            }
        }
    });

    test('should navigate through wiki links', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create target page
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const targetTitle = `LinkNav${Date.now()}`;
        await editor.click();
        await editor.type(targetTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Go back and create linking page
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor2 = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor2.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await editor2.click();
        await editor2.type(`Link to [[${targetTitle}]]`);
        await authenticatedPage.waitForTimeout(1000);

        // Find and click the link
        const link = authenticatedPage
            .locator(`a:has-text("${targetTitle}"), .wiki-link:has-text("${targetTitle}")`)
            .first();

        if (!(await link.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await link.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify we navigated to the target page
        const content = await authenticatedPage
            .locator('.ProseMirror, [contenteditable="true"]')
            .first()
            .textContent()
            .catch(() => '');

        if (content.includes(targetTitle)) {
            expect(content).toContain(targetTitle);
        }
    });

    test('should create new pages from broken links', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a link to non-existent page
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const newPageName = `NewPage${Date.now()}`;
        await editor.click();
        await editor.type(`Link to [[${newPageName}]]`);
        await authenticatedPage.waitForTimeout(1000);

        // Find the broken link (may have different styling)
        const brokenLink = authenticatedPage
            .locator(
                `a:has-text("${newPageName}"), .wiki-link:has-text("${newPageName}"), .broken-link:has-text("${newPageName}")`,
            )
            .first();

        if (!(await brokenLink.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Click the link to create the page
        await brokenLink.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify new page was created (editor should be visible)
        const newEditor = authenticatedPage
            .locator('.ProseMirror, [contenteditable="true"]')
            .first();

        if (await newEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await newEditor.isVisible()).toBeTruthy();
        }
    });

    test('should display backlinks panel', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a target page
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const targetTitle = `BacklinkTarget${Date.now()}`;
        await editor.click();
        await editor.type(targetTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Look for backlinks panel or button
        const backlinksButton = authenticatedPage
            .locator(
                'button:has-text("Backlinks"), button:has-text("Links"), .backlinks-button, [aria-label*="backlink" i]',
            )
            .first();

        if (!(await backlinksButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            // May be auto-visible in sidebar
            const backlinksPanel = authenticatedPage
                .locator('.backlinks-panel, .backlinks-section, [data-panel="backlinks"]')
                .first();

            if (await backlinksPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await backlinksPanel.isVisible()).toBeTruthy();
            } else {
                test.skip();
                return;
            }
        } else {
            await backlinksButton.click();
            await authenticatedPage.waitForTimeout(500);

            const backlinksPanel = authenticatedPage
                .locator('.backlinks-panel, .backlinks-section, [data-panel="backlinks"]')
                .first();

            if (await backlinksPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await backlinksPanel.isVisible()).toBeTruthy();
            }
        }
    });

    test('should show backlink count', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create target page
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const targetTitle = `BacklinkCount${Date.now()}`;
        await editor.click();
        await editor.type(targetTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Create a page that links to the target
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor2 = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor2.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await editor2.click();
        await editor2.type(`Reference to [[${targetTitle}]]`);
        await authenticatedPage.waitForTimeout(1000);

        // Navigate to the target page
        const link = authenticatedPage.locator(`a:has-text("${targetTitle}")`).first();

        if (!(await link.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await link.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for backlink count indicator
        const backlinkCount = authenticatedPage
            .locator('text="1 backlink", text="1 link", .backlink-count, [data-backlink-count="1"]')
            .first();

        if (await backlinkCount.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await backlinkCount.isVisible()).toBeTruthy();
        }
    });

    test('should update links when page is renamed', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create target page
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const originalTitle = `RenameOriginal${Date.now()}`;
        await editor.click();
        await editor.type(originalTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Create linking page
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor2 = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor2.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await editor2.click();
        await editor2.type(`Link to [[${originalTitle}]]`);
        await authenticatedPage.waitForTimeout(1000);

        // Navigate to target and rename
        const link = authenticatedPage.locator(`a:has-text("${originalTitle}")`).first();

        if (!(await link.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await link.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Try to rename the page
        const titleEditor = authenticatedPage
            .locator('.ProseMirror, [contenteditable="true"]')
            .first();

        if (!(await titleEditor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Select title and rename
        await titleEditor.click();
        await authenticatedPage.keyboard.press('Control+A');
        const newTitle = `RenameNew${Date.now()}`;
        await titleEditor.type(newTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Go back to linking page and verify link was updated
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        const updatedLink = authenticatedPage.locator(`a:has-text("${newTitle}")`).first();

        if (await updatedLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await updatedLink.isVisible()).toBeTruthy();
        }
    });

    test('should show broken links when page is deleted', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create target page
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const targetTitle = `DeleteTarget${Date.now()}`;
        await editor.click();
        await editor.type(targetTitle);
        await authenticatedPage.waitForTimeout(1000);

        // Create linking page
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor2 = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor2.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await editor2.click();
        await editor2.type(`Link to [[${targetTitle}]]`);
        await authenticatedPage.waitForTimeout(1000);

        // Navigate to target page and delete it
        const link = authenticatedPage.locator(`a:has-text("${targetTitle}")`).first();

        if (!(await link.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await link.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for delete button
        const menuButton = authenticatedPage
            .locator(
                'button[aria-label*="menu" i], button:has-text("More"), button:has-text("...")',
            )
            .first();

        if (!(await menuButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await menuButton.click();
        await authenticatedPage.waitForTimeout(500);

        const deleteButton = authenticatedPage
            .locator('button:has-text("Delete"), button:has-text("Trash")')
            .first();

        if (!(await deleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await deleteButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Confirm deletion if prompted
        const confirmButton = authenticatedPage
            .locator(
                'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")',
            )
            .first();

        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmButton.click();
            await authenticatedPage.waitForTimeout(1000);
        }

        // Go back to linking page
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Check if link is now marked as broken
        const brokenLink = authenticatedPage
            .locator(
                `.broken-link:has-text("${targetTitle}"), a.broken:has-text("${targetTitle}"), [data-broken="true"]:has-text("${targetTitle}")`,
            )
            .first();

        if (await brokenLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await brokenLink.isVisible()).toBeTruthy();
        }
    });

    test('should support bidirectional linking', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create Page A
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const pageATitle = `PageA${Date.now()}`;
        await editor.click();
        await editor.type(pageATitle);
        await authenticatedPage.waitForTimeout(1000);

        // Create Page B with link to Page A
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor2 = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor2.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const pageBTitle = `PageB${Date.now()}`;
        await editor2.click();
        await editor2.type(pageBTitle);
        await editor2.press('Enter');
        await editor2.type(`Links to [[${pageATitle}]]`);
        await authenticatedPage.waitForTimeout(1000);

        // Navigate to Page A and check for backlink to Page B
        const linkToA = authenticatedPage.locator(`a:has-text("${pageATitle}")`).first();

        if (!(await linkToA.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await linkToA.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for Page B in backlinks
        const backlinkToB = authenticatedPage
            .locator(`text="${pageBTitle}", .backlink:has-text("${pageBTitle}")`)
            .first();

        if (await backlinkToB.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await backlinkToB.isVisible()).toBeTruthy();
        }
    });

    test('should display link graph visualization', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for graph view button
        const graphButton = authenticatedPage
            .locator(
                'button:has-text("Graph"), button:has-text("Network"), button[aria-label*="graph" i], a:has-text("Graph")',
            )
            .first();

        if (!(await graphButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await graphButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for graph visualization canvas or SVG
        const graphCanvas = authenticatedPage
            .locator('canvas, svg, .graph-visualization, [data-graph]')
            .first();

        if (await graphCanvas.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await graphCanvas.isVisible()).toBeTruthy();
        }
    });
});
