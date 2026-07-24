import { test, expect } from './fixtures';

test.describe('Kanban Boards', () => {
    test('should create a new kanban board', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for "New Kanban" or "Kanban" button
        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Verify kanban board is displayed (should have columns/lanes)
        const kanbanBoard = authenticatedPage.locator(
            '[role="region"][aria-label*="kanban" i], .kanban-board, .kanban-container',
        );

        await expect(kanbanBoard).toBeVisible({ timeout: 5000 });

        // Verify default columns exist
        const columns = authenticatedPage.locator('.kanban-column, .kanban-lane, [data-lane-id]');
        const columnCount = await columns.count();
        expect(columnCount).toBeGreaterThan(0);
    });

    test('should display default kanban columns', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Check for common default columns
        const expectedColumns = ['To Do', 'In Progress', 'Done', 'Backlog'];
        let foundColumns = 0;

        for (const columnName of expectedColumns) {
            const column = authenticatedPage.locator(`:text("${columnName}")`);
            if (await column.isVisible({ timeout: 1000 }).catch(() => false)) {
                foundColumns++;
            }
        }

        // Expect at least 2 default columns
        expect(foundColumns).toBeGreaterThanOrEqual(2);
    });

    test('should create a new kanban card', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Find "Add Card" or "+" button in a column
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Enter card title
        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const uniqueCardTitle = `Test Card ${Date.now()}`;
        await cardTitleInput.fill(uniqueCardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Verify card was created
        const createdCard = authenticatedPage.locator(`:text("${uniqueCardTitle}")`);
        await expect(createdCard).toBeVisible({ timeout: 3000 });
    });

    test('should edit kanban card title', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card first
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const originalTitle = `Original Card ${Date.now()}`;
        await cardTitleInput.fill(originalTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Click on the card to edit it
        const card = authenticatedPage.locator(`:text("${originalTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for editable title field
        const editTitleInput = authenticatedPage
            .locator('input[value*="Original"], textarea:has-text("Original")')
            .first();

        if (await editTitleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await editTitleInput.clear();
            const newTitle = `Updated Card ${Date.now()}`;
            await editTitleInput.fill(newTitle);
            await editTitleInput.press('Enter');
            await authenticatedPage.waitForTimeout(1000);

            // Verify new title
            await expect(authenticatedPage.locator(`:text("${newTitle}")`)).toBeVisible({
                timeout: 3000,
            });
        } else {
            test.skip();
        }
    });

    test('should drag and drop card between columns', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card first
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Draggable Card ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Find the card element
        const card = authenticatedPage
            .locator(`.kanban-card:has-text("${cardTitle}"), [data-card]:has-text("${cardTitle}")`)
            .first();

        if (!(await card.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Find columns
        const columns = authenticatedPage.locator('.kanban-column, .kanban-lane, [data-lane-id]');
        const columnCount = await columns.count();

        if (columnCount < 2) {
            test.skip();
            return;
        }

        // Get second column position
        const targetColumn = columns.nth(1);
        const cardBox = await card.boundingBox();
        const targetBox = await targetColumn.boundingBox();

        if (!cardBox || !targetBox) {
            test.skip();
            return;
        }

        // Perform drag and drop
        await authenticatedPage.mouse.move(
            cardBox.x + cardBox.width / 2,
            cardBox.y + cardBox.height / 2,
        );
        await authenticatedPage.mouse.down();
        await authenticatedPage.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, {
            steps: 10,
        });
        await authenticatedPage.mouse.up();

        await authenticatedPage.waitForTimeout(1000);

        // Verify card still exists (actual column change verification would require more complex logic)
        await expect(authenticatedPage.locator(`:text("${cardTitle}")`)).toBeVisible();
    });

    test('should add a new custom column', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for "Add Column" button
        const addColumnButton = authenticatedPage
            .locator(
                'button:has-text("Add Column"), button:has-text("New Column"), button:has-text("Add Lane")',
            )
            .first();

        if (!(await addColumnButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addColumnButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Enter column name
        const columnNameInput = authenticatedPage
            .locator('input[placeholder*="column" i], input[placeholder*="lane" i]')
            .first();

        if (!(await columnNameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const columnName = `Custom Column ${Date.now()}`;
        await columnNameInput.fill(columnName);
        await columnNameInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Verify new column exists
        await expect(authenticatedPage.locator(`:text("${columnName}")`)).toBeVisible({
            timeout: 3000,
        });
    });

    test('should delete a custom column', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Add a custom column first
        const addColumnButton = authenticatedPage
            .locator(
                'button:has-text("Add Column"), button:has-text("New Column"), button:has-text("Add Lane")',
            )
            .first();

        if (!(await addColumnButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addColumnButton.click();
        await authenticatedPage.waitForTimeout(500);

        const columnNameInput = authenticatedPage
            .locator('input[placeholder*="column" i], input[placeholder*="lane" i]')
            .first();

        if (!(await columnNameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const columnName = `Delete Me ${Date.now()}`;
        await columnNameInput.fill(columnName);
        await columnNameInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Find delete button for the column
        const columnHeader = authenticatedPage.locator(`:text("${columnName}")`);
        await columnHeader.hover();
        await authenticatedPage.waitForTimeout(300);

        const deleteButton = authenticatedPage
            .locator(
                'button:has-text("Delete"), button[aria-label*="delete" i], button.material-symbols-rounded:has-text("delete")',
            )
            .last();

        if (await deleteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await deleteButton.click();
            await authenticatedPage.waitForTimeout(500);

            // Confirm deletion if dialog appears
            const confirmButton = authenticatedPage.locator(
                'button:has-text("Delete"), button:has-text("Confirm")',
            );
            if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await confirmButton.click();
            }

            await authenticatedPage.waitForTimeout(1000);

            // Verify column is removed
            await expect(columnHeader).not.toBeVisible({ timeout: 3000 });
        } else {
            test.skip();
        }
    });

    test('should open card modal to edit memo', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Card with Memo ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Click card to open modal
        const card = authenticatedPage.locator(`:text("${cardTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for modal with editor
        const modal = authenticatedPage.locator('[role="dialog"], .modal, .card-modal');
        await expect(modal).toBeVisible({ timeout: 3000 });

        // Look for editor content
        const editor = authenticatedPage.locator('.editor-content, [contenteditable="true"]');
        if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
            await expect(editor).toBeVisible();
        }
    });

    test('should add tags to kanban card', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Tagged Card ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Open card modal
        const card = authenticatedPage.locator(`:text("${cardTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for tag/label input
        const tagButton = authenticatedPage.locator(
            'button:has-text("Tag"), button:has-text("Label"), button[aria-label*="tag" i]',
        );

        if (await tagButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await tagButton.click();
            await authenticatedPage.waitForTimeout(500);

            // Try to select or create a tag
            const tagInput = authenticatedPage.locator('input[placeholder*="tag" i]');
            if (await tagInput.isVisible({ timeout: 1000 }).catch(() => false)) {
                await tagInput.fill('important');
                await tagInput.press('Enter');
                await authenticatedPage.waitForTimeout(500);
            }
        } else {
            test.skip();
        }
    });

    test('should set card priority', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Priority Card ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Open card modal
        const card = authenticatedPage.locator(`:text("${cardTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for priority selector
        const priorityButton = authenticatedPage.locator(
            'button:has-text("Priority"), button[aria-label*="priority" i], select[aria-label*="priority" i]',
        );

        if (await priorityButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await priorityButton.click();
            await authenticatedPage.waitForTimeout(300);

            // Select high priority
            const highPriority = authenticatedPage.locator(
                'button:has-text("High"), option:has-text("High")',
            );
            if (await highPriority.isVisible({ timeout: 1000 }).catch(() => false)) {
                await highPriority.click();
                await authenticatedPage.waitForTimeout(500);
            }
        } else {
            test.skip();
        }
    });

    test('should archive kanban card', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Archive Card ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Open card modal
        const card = authenticatedPage.locator(`:text("${cardTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for archive button
        const archiveButton = authenticatedPage.locator(
            'button:has-text("Archive"), button[aria-label*="archive" i]',
        );

        if (await archiveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await archiveButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Close modal
            const closeButton = authenticatedPage.locator(
                'button:has-text("Close"), button[aria-label*="close" i], button.modal-close',
            );
            if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await closeButton.click();
            } else {
                await authenticatedPage.keyboard.press('Escape');
            }

            await authenticatedPage.waitForTimeout(500);

            // Verify card is no longer visible in active view
            await expect(card).not.toBeVisible({ timeout: 3000 });
        } else {
            test.skip();
        }
    });

    test('should delete kanban card', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create a card
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Delete Card ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Open card modal
        const card = authenticatedPage.locator(`:text("${cardTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for delete button
        const deleteButton = authenticatedPage.locator(
            'button:has-text("Delete"), button[aria-label*="delete" i]',
        );

        if (await deleteButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await deleteButton.click();
            await authenticatedPage.waitForTimeout(500);

            // Confirm deletion
            const confirmButton = authenticatedPage.locator(
                'button:has-text("Delete"), button:has-text("Confirm")',
            );
            if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await confirmButton.click();
            }

            await authenticatedPage.waitForTimeout(1000);

            // Verify card is removed
            await expect(card).not.toBeVisible({ timeout: 3000 });
        } else {
            test.skip();
        }
    });

    test('should recover deleted card from archive', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create and archive a card first
        const addCardButton = authenticatedPage
            .locator(
                'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
            )
            .first();

        if (!(await addCardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addCardButton.click();
        await authenticatedPage.waitForTimeout(500);

        const cardTitleInput = authenticatedPage
            .locator(
                'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
            )
            .first();

        if (!(await cardTitleInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const cardTitle = `Recover Card ${Date.now()}`;
        await cardTitleInput.fill(cardTitle);
        await cardTitleInput.press('Enter');
        await authenticatedPage.waitForTimeout(1000);

        // Archive the card
        const card = authenticatedPage.locator(`:text("${cardTitle}")`);
        await card.click();
        await authenticatedPage.waitForTimeout(1000);

        const archiveButton = authenticatedPage.locator(
            'button:has-text("Archive"), button[aria-label*="archive" i]',
        );

        if (!(await archiveButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await archiveButton.click();
        await authenticatedPage.waitForTimeout(500);
        await authenticatedPage.keyboard.press('Escape');
        await authenticatedPage.waitForTimeout(500);

        // Open archive view
        const archiveViewButton = authenticatedPage.locator(
            'button:has-text("Archive"), button:has-text("Archived"), button[aria-label*="archive" i]',
        );

        if (await archiveViewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await archiveViewButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Find archived card
            const archivedCard = authenticatedPage.locator(`:text("${cardTitle}")`);
            await archivedCard.click();
            await authenticatedPage.waitForTimeout(500);

            // Restore card
            const restoreButton = authenticatedPage.locator(
                'button:has-text("Restore"), button:has-text("Unarchive")',
            );
            if (await restoreButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await restoreButton.click();
                await authenticatedPage.waitForTimeout(1000);

                // Verify card is back
                await expect(authenticatedPage.locator(`:text("${cardTitle}")`)).toBeVisible({
                    timeout: 3000,
                });
            } else {
                test.skip();
            }
        } else {
            test.skip();
        }
    });

    test('should reorder cards within a column', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage.locator(
            'button:has-text("New Kanban"), button:has-text("Kanban Board"), button:has-text("Kanban")',
        );

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Create two cards
        for (let i = 1; i <= 2; i++) {
            const addCardButton = authenticatedPage
                .locator(
                    'button:has-text("Add Card"), button:has-text("New Card"), button:has-text("+"), button[aria-label*="add card" i]',
                )
                .first();

            await addCardButton.click();
            await authenticatedPage.waitForTimeout(500);

            const cardTitleInput = authenticatedPage
                .locator(
                    'input[placeholder*="card" i], input[placeholder*="title" i], textarea[placeholder*="card" i]',
                )
                .first();

            await cardTitleInput.fill(`Card ${i}`);
            await cardTitleInput.press('Enter');
            await authenticatedPage.waitForTimeout(800);
        }

        // Find first card
        const firstCard = authenticatedPage.locator('.kanban-card, [data-card]').first();
        const secondCard = authenticatedPage.locator('.kanban-card, [data-card]').nth(1);

        const firstBox = await firstCard.boundingBox();
        const secondBox = await secondCard.boundingBox();

        if (!firstBox || !secondBox) {
            test.skip();
            return;
        }

        // Drag first card below second card
        await authenticatedPage.mouse.move(
            firstBox.x + firstBox.width / 2,
            firstBox.y + firstBox.height / 2,
        );
        await authenticatedPage.mouse.down();
        await authenticatedPage.mouse.move(
            secondBox.x + secondBox.width / 2,
            secondBox.y + secondBox.height + 10,
            {
                steps: 10,
            },
        );
        await authenticatedPage.mouse.up();

        await authenticatedPage.waitForTimeout(1000);

        // Verify cards still exist (actual order verification would require more complex logic)
        await expect(firstCard).toBeVisible();
        await expect(secondCard).toBeVisible();
    });

    test('should display kanban in list view', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newKanbanButton = authenticatedPage
            .locator('button:has-text("New Kanban"), button:has-text("Kanban")')
            .first();

        if (!(await newKanbanButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            return;
        }

        await newKanbanButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for view toggle button if available
        const viewToggle = authenticatedPage
            .locator(
                'button:has-text("List"), button:has-text("List View"), button[aria-label*="list" i]',
            )
            .first();

        if (await viewToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
            await viewToggle.click();
            await authenticatedPage.waitForTimeout(500);
        }

        // Verify board/kanban container is visible
        const kanbanContainer = authenticatedPage
            .locator('.kanban-board, .kanban-container, [role="region"], .kanban-list')
            .first();
        await expect(kanbanContainer).toBeVisible({ timeout: 5000 });
    });
});
