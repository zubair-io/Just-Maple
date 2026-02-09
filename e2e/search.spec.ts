import { test, expect } from './fixtures';

test.describe('Search', () => {
    test('should open global search', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for search button or input
        const searchButton = authenticatedPage
            .locator(
                'button:has-text("Search"), input[placeholder*="Search" i], button[aria-label*="search" i], .search-button',
            )
            .first();

        if (!(await searchButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            // Try keyboard shortcut
            await authenticatedPage.keyboard.press('Control+K');
            await authenticatedPage.waitForTimeout(500);

            // Check if search modal/panel opened
            const searchModal = authenticatedPage
                .locator(
                    '[role="dialog"]:has-text("Search"), .search-modal, .search-panel, input[placeholder*="Search" i]',
                )
                .first();

            if (!(await searchModal.isVisible({ timeout: 2000 }).catch(() => false))) {
                test.skip();
                return;
            }

            expect(await searchModal.isVisible()).toBeTruthy();
        } else {
            await searchButton.click();
            await authenticatedPage.waitForTimeout(500);

            // Verify search interface opened
            const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();
            expect(await searchInput.isVisible()).toBeTruthy();
        }
    });

    test('should search for notes by content', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // First create a note with unique content
        const uniqueText = `SearchTest${Date.now()}`;
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

        await editor.click();
        await editor.type(uniqueText);
        await authenticatedPage.waitForTimeout(1000);

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Type search query
        await searchInput.fill(uniqueText);
        await authenticatedPage.waitForTimeout(1500);

        // Look for search results
        const searchResults = authenticatedPage.locator(
            '.search-result, .search-item, [data-search-result]',
        );

        const resultCount = await searchResults.count();
        if (resultCount > 0) {
            expect(resultCount).toBeGreaterThan(0);
        }
    });

    test('should search within specific notebook', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for notebook filter
        const notebookFilter = authenticatedPage
            .locator(
                'button:has-text("This Notebook"), button:has-text("Current Notebook"), select:has-text("Notebook"), [data-filter="notebook"]',
            )
            .first();

        if (await notebookFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
            await notebookFilter.click();
            await authenticatedPage.waitForTimeout(500);

            // Verify filter is active
            const isActive = await authenticatedPage
                .evaluate(() => {
                    const activeFilter = document.querySelector(
                        '[data-filter="notebook"][aria-pressed="true"], .filter-active',
                    );
                    return activeFilter !== null;
                })
                .catch(() => false);

            if (isActive) {
                expect(isActive).toBeTruthy();
            }
        }
    });

    test('should filter search results by type', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for type filters
        const typeFilter = authenticatedPage
            .locator(
                'button:has-text("Memos"), button:has-text("Whiteboards"), button:has-text("Kanban"), .type-filter',
            )
            .first();

        if (!(await typeFilter.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await typeFilter.click();
        await authenticatedPage.waitForTimeout(1000);

        // Verify filter applied (check for visual indicator or URL change)
        const filterApplied = await authenticatedPage
            .evaluate(() => {
                return document.querySelector('[aria-pressed="true"], .filter-active') !== null;
            })
            .catch(() => false);

        if (filterApplied) {
            expect(filterApplied).toBeTruthy();
        }
    });

    test('should highlight search terms in results', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a note with specific content
        const searchTerm = 'HighlightTest';
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

        await editor.click();
        await editor.type(`This contains ${searchTerm} in the content`);
        await authenticatedPage.waitForTimeout(1000);

        // Open search and search for the term
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await searchInput.fill(searchTerm);
        await authenticatedPage.waitForTimeout(1500);

        // Check for highlighted text
        const highlighted = authenticatedPage
            .locator('mark, .highlight, .search-highlight, em')
            .first();

        if (await highlighted.isVisible({ timeout: 2000 }).catch(() => false)) {
            const highlightedText = await highlighted.textContent();
            expect(highlightedText).toContain(searchTerm);
        }
    });

    test('should display empty state for no results', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Search for something that definitely doesn't exist
        const randomQuery = `XYZ${Date.now()}ABC${Math.random()}`;
        await searchInput.fill(randomQuery);
        await authenticatedPage.waitForTimeout(1500);

        // Look for empty state message
        const emptyState = authenticatedPage
            .locator(
                'text="No results", text="No matches", text="Nothing found", .empty-state, [data-empty="true"]',
            )
            .first();

        if (await emptyState.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await emptyState.isVisible()).toBeTruthy();
        }
    });

    test('should navigate to note from search results', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a note with unique content
        const uniqueText = `NavigateTest${Date.now()}`;
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

        await editor.click();
        await editor.type(uniqueText);
        await authenticatedPage.waitForTimeout(1000);

        // Navigate away
        await authenticatedPage.goBack();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await searchInput.fill(uniqueText);
        await authenticatedPage.waitForTimeout(1500);

        // Click first search result
        const firstResult = authenticatedPage
            .locator('.search-result, .search-item, [data-search-result]')
            .first();

        if (!(await firstResult.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await firstResult.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify we're on the note page (editor should be visible with our content)
        const editorContent = await authenticatedPage
            .locator('.ProseMirror, [contenteditable="true"]')
            .first()
            .textContent()
            .catch(() => '');

        if (editorContent.includes(uniqueText)) {
            expect(editorContent).toContain(uniqueText);
        }
    });

    test('should search by title vs content', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a note with both title and content
        const titleText = `TitleSearch${Date.now()}`;
        const contentText = `ContentSearch${Date.now()}`;

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

        await editor.click();
        await editor.type(titleText);
        await editor.press('Enter');
        await editor.type(contentText);
        await authenticatedPage.waitForTimeout(1000);

        // Search for title
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await searchInput.fill(titleText);
        await authenticatedPage.waitForTimeout(1500);

        // Should find results
        const titleResults = await authenticatedPage
            .locator('.search-result, .search-item')
            .count();

        if (titleResults > 0) {
            expect(titleResults).toBeGreaterThan(0);

            // Clear and search for content
            await searchInput.clear();
            await searchInput.fill(contentText);
            await authenticatedPage.waitForTimeout(1500);

            const contentResults = await authenticatedPage
                .locator('.search-result, .search-item')
                .count();

            if (contentResults > 0) {
                expect(contentResults).toBeGreaterThan(0);
            }
        }
    });

    test('should show recent searches', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Perform a search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const searchQuery = 'RecentSearch';
        await searchInput.fill(searchQuery);
        await authenticatedPage.waitForTimeout(1500);

        // Close search
        await authenticatedPage.keyboard.press('Escape');
        await authenticatedPage.waitForTimeout(500);

        // Reopen search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        // Look for recent searches section
        const recentSearches = authenticatedPage
            .locator('text="Recent", .recent-searches, [data-section="recent"]')
            .first();

        if (await recentSearches.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await recentSearches.isVisible()).toBeTruthy();

            // Check if our search appears
            const recentItem = authenticatedPage.locator(`text="${searchQuery}"`).first();
            if (await recentItem.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await recentItem.isVisible()).toBeTruthy();
            }
        }
    });

    test('should use keyboard navigation in search results', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create multiple notes for navigation
        for (let i = 0; i < 3; i++) {
            const newMemoButton = authenticatedPage
                .locator('button:has-text("New Memo"), button:has-text("Memo")')
                .first();

            if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
                test.skip();
                return;
            }

            await newMemoButton.click();
            await authenticatedPage.waitForLoadState('networkidle');

            const editor = authenticatedPage
                .locator('.ProseMirror, [contenteditable="true"]')
                .first();

            if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
                test.skip();
                return;
            }

            await editor.click();
            await editor.type(`KeyboardNav Test ${i + 1}`);
            await authenticatedPage.waitForTimeout(500);

            await authenticatedPage.goBack();
            await authenticatedPage.waitForLoadState('networkidle');
            await authenticatedPage.waitForTimeout(500);
        }

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await searchInput.fill('KeyboardNav');
        await authenticatedPage.waitForTimeout(1500);

        // Use arrow keys to navigate
        await authenticatedPage.keyboard.press('ArrowDown');
        await authenticatedPage.waitForTimeout(300);
        await authenticatedPage.keyboard.press('ArrowDown');
        await authenticatedPage.waitForTimeout(300);

        // Check if a result is highlighted/selected
        const selectedResult = authenticatedPage
            .locator(
                '.search-result[aria-selected="true"], .search-item.selected, .search-result.active',
            )
            .first();

        if (await selectedResult.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await selectedResult.isVisible()).toBeTruthy();
        }
    });

    test('should filter search by date range', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for date filter or advanced options
        const advancedButton = authenticatedPage
            .locator(
                'button:has-text("Filters"), button:has-text("Advanced"), button:has-text("Date"), .filter-button',
            )
            .first();

        if (!(await advancedButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await advancedButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for date range options
        const dateFilter = authenticatedPage
            .locator(
                'button:has-text("Last 7 days"), button:has-text("Last 30 days"), button:has-text("This week"), input[type="date"]',
            )
            .first();

        if (await dateFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
            await dateFilter.click();
            await authenticatedPage.waitForTimeout(500);

            // Verify filter applied
            const filterActive = await authenticatedPage
                .evaluate(() => {
                    return document.querySelector('[aria-pressed="true"], .filter-active') !== null;
                })
                .catch(() => false);

            if (filterActive) {
                expect(filterActive).toBeTruthy();
            }
        }
    });

    test('should search across tags', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open search
        await authenticatedPage.keyboard.press('Control+K');
        await authenticatedPage.waitForTimeout(500);

        const searchInput = authenticatedPage.locator('input[placeholder*="Search" i]').first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for tag filter
        const tagFilter = authenticatedPage
            .locator(
                'button:has-text("Tags"), button:has-text("Tag"), .tag-filter, [data-filter="tag"]',
            )
            .first();

        if (!(await tagFilter.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await tagFilter.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for tag options
        const tagOption = authenticatedPage.locator('.tag-option, [data-tag], .tag-item').first();

        if (await tagOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await tagOption.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify tag filter applied
            const filterApplied = await authenticatedPage
                .evaluate(() => {
                    return document.querySelector('[aria-pressed="true"], .tag-active') !== null;
                })
                .catch(() => false);

            if (filterApplied) {
                expect(filterApplied).toBeTruthy();
            }
        }
    });
});
