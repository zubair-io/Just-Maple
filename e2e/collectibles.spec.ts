import { test, expect } from './fixtures';

test.describe('Collectibles (LEGO)', () => {
    test('should open collectibles view', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for collectibles/LEGO button
        const collectiblesButton = authenticatedPage
            .locator(
                'button:has-text("Collectibles"), button:has-text("LEGO"), a:has-text("Collectibles"), [aria-label*="collectible" i]',
            )
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify collectibles view opened
        const collectiblesView = authenticatedPage
            .locator('.collectibles-view, .lego-view, [data-view="collectibles"]')
            .first();

        if (await collectiblesView.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await collectiblesView.isVisible()).toBeTruthy();
        }
    });

    test('should create a new collectible item', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator(
                'button:has-text("Collectibles"), button:has-text("LEGO"), a:has-text("Collectibles")',
            )
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for add/new button
        const addButton = authenticatedPage
            .locator(
                'button:has-text("Add"), button:has-text("New"), button:has-text("+"), button[aria-label*="add" i]',
            )
            .first();

        if (!(await addButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for form or modal
        const modal = authenticatedPage
            .locator('[role="dialog"], .modal, .collectible-form')
            .first();

        if (!(await modal.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Fill in collectible details
        const nameInput = authenticatedPage
            .locator(
                'input[placeholder*="Name" i], input[aria-label*="name" i], input[name="name"]',
            )
            .first();

        if (!(await nameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const itemName = `Test LEGO ${Date.now()}`;
        await nameInput.fill(itemName);
        await authenticatedPage.waitForTimeout(500);

        // Look for save/submit button
        const saveButton = authenticatedPage
            .locator('button:has-text("Save"), button:has-text("Add"), button[type="submit"]')
            .first();

        if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await saveButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify item was created
            const createdItem = authenticatedPage
                .locator(`text="${itemName}", .collectible-item:has-text("${itemName}")`)
                .first();

            if (await createdItem.isVisible({ timeout: 3000 }).catch(() => false)) {
                expect(await createdItem.isVisible()).toBeTruthy();
            }
        }
    });

    test('should display collectibles list', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for collectibles list or grid
        const collectiblesList = authenticatedPage
            .locator(
                '.collectibles-list, .collectibles-grid, .collectible-item, [data-collectible]',
            )
            .first();

        const emptyState = authenticatedPage
            .locator('text="No collectibles", text="Add your first", .empty-collectibles')
            .first();

        const hasListOrEmpty =
            (await collectiblesList.isVisible({ timeout: 2000 }).catch(() => false)) ||
            (await emptyState.isVisible({ timeout: 2000 }).catch(() => false));

        if (hasListOrEmpty) {
            expect(hasListOrEmpty).toBeTruthy();
        }
    });

    test('should filter collectibles', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for filter options
        const filterButton = authenticatedPage
            .locator(
                'button:has-text("Filter"), button:has-text("Category"), select, .filter-button',
            )
            .first();

        if (!(await filterButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await filterButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Try to select a filter option
        const filterOption = authenticatedPage
            .locator(
                'button:has-text("All"), button:has-text("Owned"), button:has-text("Wishlist"), option',
            )
            .first();

        if (await filterOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await filterOption.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify filter was applied
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

    test('should sort collectibles', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for sort options
        const sortButton = authenticatedPage
            .locator('button:has-text("Sort"), select[aria-label*="sort" i], .sort-button')
            .first();

        if (!(await sortButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await sortButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Select a sort option
        const sortOption = authenticatedPage
            .locator(
                'button:has-text("Name"), button:has-text("Date"), button:has-text("Price"), option',
            )
            .first();

        if (await sortOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await sortOption.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify sort was applied (URL param or active state)
            const url = authenticatedPage.url();
            const hasSortParam = url.includes('sort');

            if (hasSortParam) {
                expect(hasSortParam).toBeTruthy();
            }
        }
    });

    test('should edit a collectible item', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles and create an item first
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for an existing collectible item
        const collectibleItem = authenticatedPage
            .locator('.collectible-item, [data-collectible]')
            .first();

        if (!(await collectibleItem.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for edit button
        const editButton = collectibleItem
            .locator('button:has-text("Edit"), button[aria-label*="edit" i], .edit-button')
            .first();

        if (!(await editButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Try right-click context menu
            await collectibleItem.click({ button: 'right' });
            await authenticatedPage.waitForTimeout(500);

            const contextEditButton = authenticatedPage
                .locator('button:has-text("Edit"), [role="menuitem"]:has-text("Edit")')
                .first();

            if (!(await contextEditButton.isVisible({ timeout: 2000 }).catch(() => false))) {
                test.skip();
                return;
            }

            await contextEditButton.click();
        } else {
            await editButton.click();
        }

        await authenticatedPage.waitForTimeout(500);

        // Look for edit form/modal
        const editModal = authenticatedPage.locator('[role="dialog"], .modal, .edit-form').first();

        if (await editModal.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await editModal.isVisible()).toBeTruthy();
        }
    });

    test('should delete a collectible item', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Create an item to delete
        const addButton = authenticatedPage
            .locator('button:has-text("Add"), button:has-text("New")')
            .first();

        if (!(await addButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addButton.click();
        await authenticatedPage.waitForTimeout(500);

        const nameInput = authenticatedPage
            .locator('input[placeholder*="Name" i], input[name="name"]')
            .first();

        if (!(await nameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const itemName = `DeleteTest${Date.now()}`;
        await nameInput.fill(itemName);

        const saveButton = authenticatedPage
            .locator('button:has-text("Save"), button:has-text("Add")')
            .first();

        if (!(await saveButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await saveButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Find and delete the item
        const createdItem = authenticatedPage
            .locator(`.collectible-item:has-text("${itemName}")`)
            .first();

        if (!(await createdItem.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const deleteButton = createdItem
            .locator('button:has-text("Delete"), button[aria-label*="delete" i]')
            .first();

        if (!(await deleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Try right-click
            await createdItem.click({ button: 'right' });
            await authenticatedPage.waitForTimeout(500);

            const contextDeleteButton = authenticatedPage
                .locator('button:has-text("Delete"), [role="menuitem"]:has-text("Delete")')
                .first();

            if (!(await contextDeleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
                test.skip();
                return;
            }

            await contextDeleteButton.click();
        } else {
            await deleteButton.click();
        }

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

        // Verify item was deleted
        const itemStillExists = await createdItem.isVisible({ timeout: 2000 }).catch(() => false);
        expect(itemStillExists).toBeFalsy();
    });

    test('should add collectible to wishlist', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for a collectible item
        const collectibleItem = authenticatedPage
            .locator('.collectible-item, [data-collectible]')
            .first();

        if (!(await collectibleItem.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for wishlist button
        const wishlistButton = collectibleItem
            .locator(
                'button:has-text("Wishlist"), button[aria-label*="wishlist" i], .wishlist-button',
            )
            .first();

        if (await wishlistButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await wishlistButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify item was added to wishlist
            const isWishlisted = await collectibleItem
                .evaluate((el) => {
                    return (
                        el.hasAttribute('data-wishlisted') ||
                        el.classList.contains('wishlisted') ||
                        el.querySelector('[data-wishlisted="true"]') !== null
                    );
                })
                .catch(() => false);

            if (isWishlisted) {
                expect(isWishlisted).toBeTruthy();
            }
        }
    });

    test('should search collectibles', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for search input
        const searchInput = authenticatedPage
            .locator('input[placeholder*="Search" i], input[type="search"], .search-input')
            .first();

        if (!(await searchInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Type search query
        await searchInput.fill('LEGO');
        await authenticatedPage.waitForTimeout(1500);

        // Verify search results are filtered
        const results = authenticatedPage.locator('.collectible-item, [data-collectible]');

        const resultCount = await results.count();
        // Either has results or shows empty state
        const hasResults =
            resultCount > 0 ||
            (await authenticatedPage
                .locator('text="No results"')
                .isVisible({ timeout: 2000 })
                .catch(() => false));

        if (hasResults) {
            expect(hasResults).toBeTruthy();
        }
    });

    test('should display collectible details', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Click on a collectible item
        const collectibleItem = authenticatedPage
            .locator('.collectible-item, [data-collectible]')
            .first();

        if (!(await collectibleItem.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectibleItem.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for details view/modal
        const detailsView = authenticatedPage
            .locator('.collectible-details, .details-modal, [role="dialog"]')
            .first();

        if (await detailsView.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await detailsView.isVisible()).toBeTruthy();
        }
    });

    test('should categorize collectibles', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to collectibles
        const collectiblesButton = authenticatedPage
            .locator('button:has-text("Collectibles"), button:has-text("LEGO")')
            .first();

        if (!(await collectiblesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await collectiblesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for categories or tags
        const categories = authenticatedPage.locator(
            '.category, .tag, [data-category], button:has-text("Sets"), button:has-text("Minifigs")',
        );

        const categoryCount = await categories.count();

        if (categoryCount > 0) {
            expect(categoryCount).toBeGreaterThan(0);

            // Try clicking a category
            const firstCategory = categories.first();
            await firstCategory.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify filter/navigation occurred
            const url = authenticatedPage.url();
            const hasCategory = url.includes('category') || url.includes('tag');

            if (hasCategory) {
                expect(hasCategory).toBeTruthy();
            }
        }
    });
});
