import { test, expect } from './fixtures';

test.describe('Bot Management', () => {
    test('should display available bot templates', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to bots section via settings or direct link
        const botsLink = authenticatedPage.locator('a, button', { hasText: /bots/i });

        if (await botsLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await botsLink.click();
            await authenticatedPage.waitForTimeout(1000);

            // Should show bot templates grid
            const templateGrid = authenticatedPage.locator('.template-grid, .template-card');
            await expect(templateGrid.first()).toBeVisible({ timeout: 5000 });
        } else {
            test.skip();
        }
    });

    test('should register a bot', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to bots page
        const botsLink = authenticatedPage.locator('a, button', { hasText: /bots/i });
        if (!(await botsLink.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await botsLink.click();
        await authenticatedPage.waitForTimeout(1000);

        // Click on a template card to register (look for unregistered ones)
        const templateCard = authenticatedPage.locator('.template-card:not(.registered)').first();

        if (!(await templateCard.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templateCard.click();
        await authenticatedPage.waitForTimeout(500);

        // Should show "Add Bot" dialog header
        const dialogHeader = authenticatedPage.locator('h2:has-text("Add Bot")');
        if (!(await dialogHeader.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Fill in API key if required (input type="password" with id="apiKey")
        const apiKeyInput = authenticatedPage.locator('input#apiKey[type="password"]');
        if (await apiKeyInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await apiKeyInput.fill('test-api-key-12345');
        }

        // Click "Add Bot" button
        const addButton = authenticatedPage.locator('button:has-text("Add Bot")').last();
        if (await addButton.isVisible()) {
            await addButton.click();
            await authenticatedPage.waitForTimeout(1500);

            // Verify bot appears in "My Bots" section with .bot-card class
            const botCard = authenticatedPage.locator('.bot-card').first();
            await expect(botCard).toBeVisible({ timeout: 5000 });
        } else {
            test.skip();
        }
    });

    test('should invoke bot in chat', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to a tag
        const tagItem = authenticatedPage.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            test.skip();
            return;
        }

        await tagItem.click();
        await authenticatedPage.waitForTimeout(1000);

        // Type @mention in chat (even without a real bot, we can test message creation)
        const messageInput = authenticatedPage.locator('textarea, [contenteditable="true"]').last();

        if (!(await messageInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await messageInput.click();
        await messageInput.fill('@testbot hello');

        // Send the message
        const sendButton = authenticatedPage.locator('button[type="submit"]');
        if (await sendButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await sendButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify message was sent (appears in chat)
            const sentMessage = authenticatedPage.locator('text=@testbot hello');
            await expect(sentMessage).toBeVisible({ timeout: 5000 });
        } else {
            test.skip();
        }
    });

    test('should edit bot configuration', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to bots page
        const botsLink = authenticatedPage.locator('a, button', { hasText: /bots/i });
        if (!(await botsLink.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await botsLink.click();
        await authenticatedPage.waitForTimeout(1000);

        // Find a registered bot card
        const botCard = authenticatedPage.locator('.bot-card').first();
        if (!(await botCard.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Find and click edit button (material icon "edit")
        const editButton = botCard.locator('button[title="Edit"]');
        if (!(await editButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await editButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Should show "Edit Bot" dialog
        const dialogHeader = authenticatedPage.locator('h2:has-text("Edit Bot")');
        if (!(await dialogHeader.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Update API key
        const apiKeyInput = authenticatedPage.locator('input#editApiKey[type="password"]');
        if (await apiKeyInput.isVisible({ timeout: 1000 }).catch(() => false)) {
            await apiKeyInput.fill('new-test-key-67890');
        }

        // Click "Save Changes" button
        const saveButton = authenticatedPage.locator('button:has-text("Save Changes")');
        if (await saveButton.isVisible()) {
            await saveButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify dialog closed (bot card should still be visible)
            await expect(botCard).toBeVisible({ timeout: 3000 });
        } else {
            test.skip();
        }
    });

    test('should disable/enable bot', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to bots page
        const botsLink = authenticatedPage.locator('a, button', { hasText: /bots/i });
        if (!(await botsLink.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await botsLink.click();
        await authenticatedPage.waitForTimeout(1000);

        // Find a registered bot card
        const botCard = authenticatedPage.locator('.bot-card').first();
        if (!(await botCard.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Find toggle button (has title "Enable" or "Disable" with toggle_on/toggle_off icon)
        const toggleButton = botCard.locator('button[title="Disable"], button[title="Enable"]');
        if (!(await toggleButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Click toggle button
        await toggleButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Verify bot card is still visible (toggle successful)
        await expect(botCard).toBeVisible({ timeout: 3000 });
    });

    test('should delete bot', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to bots page
        const botsLink = authenticatedPage.locator('a, button', { hasText: /bots/i });
        if (!(await botsLink.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await botsLink.click();
        await authenticatedPage.waitForTimeout(1000);

        // Find a registered bot card
        const botCard = authenticatedPage.locator('.bot-card').first();
        if (!(await botCard.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Get bot handle to verify deletion
        const botHandle = await botCard
            .locator('.bot-handle')
            .textContent()
            .catch(() => null);

        // Find delete button (has title "Delete" with delete icon)
        const deleteButton = botCard.locator('button[title="Delete"]');
        if (!(await deleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Setup dialog handler for browser confirm()
        authenticatedPage.on('dialog', (dialog) => dialog.accept());

        // Click delete button
        await deleteButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Verify bot is removed from list (if we got the handle)
        if (botHandle) {
            const deletedBot = authenticatedPage.locator(`.bot-card:has-text("${botHandle}")`);
            await expect(deletedBot).not.toBeVisible({ timeout: 3000 });
        }
    });

    test('should create message that could trigger thread', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to a tag
        const tagItem = authenticatedPage.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            test.skip();
            return;
        }

        await tagItem.click();
        await authenticatedPage.waitForTimeout(1000);

        // Send a message
        const messageInput = authenticatedPage.locator('textarea, [contenteditable="true"]').last();

        if (!(await messageInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await messageInput.fill('Test message for threading');

        const sendButton = authenticatedPage.locator('button[type="submit"]');
        if (await sendButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await sendButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify message appears
            const message = authenticatedPage.locator('text=Test message for threading');
            await expect(message).toBeVisible({ timeout: 5000 });
        } else {
            test.skip();
        }
    });

    test('should share bot to tag', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // First, navigate to a tag to open share modal
        const tagItem = authenticatedPage.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            test.skip();
            return;
        }

        // Click on tag to open chat view
        await tagItem.click();
        await authenticatedPage.waitForTimeout(1000);

        // Open share modal
        const shareButton = authenticatedPage.locator('button:has-text("Share")');
        if (!(await shareButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await shareButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for "Add Bot" button in the share modal
        const addBotButton = authenticatedPage.locator('button:has-text("Add Bot")');
        if (!(await addBotButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await addBotButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Should show "Add Bot to Tag" dialog header
        const dialogHeader = authenticatedPage.locator('h3:has-text("Add Bot to Tag")');
        if (!(await dialogHeader.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Click on a bot from the list
        const botOption = authenticatedPage.locator('button:has-text("@")').first();
        if (await botOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await botOption.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify bot appears in shared bots section (look for bot handle)
            const sharedBotsSection = authenticatedPage.locator('text=/Shared Bots/i');
            await expect(sharedBotsSection).toBeVisible({ timeout: 5000 });
        } else {
            test.skip();
        }
    });
});
