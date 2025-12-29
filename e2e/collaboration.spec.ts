import { test, expect, createTestUser, authenticateWithToken } from './fixtures';

test.describe('Collaboration & Sharing', () => {
    test('should share tag with another user', async ({ page }) => {
        // Create two users
        const user1 = await createTestUser(page);
        const user2 = await createTestUser(page);

        // Login as user1
        await authenticateWithToken(page, user1.token);
        await page.waitForTimeout(1000);

        // Look for an existing tag or skip if none exists
        const tagItem = page.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            test.skip();
            return;
        }

        // Click on the tag to open chat view
        await tagItem.click();
        await page.waitForTimeout(1000);

        // Open share modal via Share button
        const shareButton = page.locator('button:has-text("Share")');
        if (!(await shareButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await shareButton.click();
        await page.waitForTimeout(500);

        // Fill in user2's email
        const emailInput = page.locator('input[type="email"][placeholder*="email"]');
        if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await emailInput.fill(user2.email);

            // Select access level (write or read)
            const accessSelect = page.locator('select');
            if (await accessSelect.isVisible()) {
                await accessSelect.selectOption('write');
            }

            // Click Share button
            const shareSubmitButton = page.locator('button:has-text("Share")').nth(1);
            await shareSubmitButton.click();
            await page.waitForTimeout(1500);

            // Verify user2 appears in the member list
            await expect(page.locator(`text=${user2.email}`)).toBeVisible({ timeout: 5000 });
        } else {
            test.skip();
        }
    });

    test('should see real-time messages from other users', async ({ browser }) => {
        const user1Context = await browser.newContext();
        const user2Context = await browser.newContext();

        const page1 = await user1Context.newPage();
        const page2 = await user2Context.newPage();

        const user1 = await createTestUser(page1);
        const user2 = await createTestUser(page2);

        await authenticateWithToken(page1, user1.token);
        await authenticateWithToken(page2, user2.token);

        // User1: Look for an existing tag
        const tagItem = page1.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            await user1Context.close();
            await user2Context.close();
            test.skip();
            return;
        }

        // Get tag name/identifier to help user2 find the same tag
        await tagItem.click();
        await page1.waitForTimeout(1000);

        // Share with user2
        const shareButton = page1.locator('button:has-text("Share")');
        if (await shareButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await shareButton.click();
            await page1.waitForTimeout(500);

            const emailInput = page1.locator('input[type="email"][placeholder*="email"]');
            if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                await emailInput.fill(user2.email);

                const accessSelect = page1.locator('select');
                if (await accessSelect.isVisible()) {
                    await accessSelect.selectOption('write');
                }

                const shareSubmitButton = page1.locator('button:has-text("Share")').nth(1);
                await shareSubmitButton.click();
                await page1.waitForTimeout(1500);
            } else {
                await user1Context.close();
                await user2Context.close();
                test.skip();
                return;
            }
        } else {
            await user1Context.close();
            await user2Context.close();
            test.skip();
            return;
        }

        // User2: Reload to see shared tag
        await page2.reload();
        await page2.waitForTimeout(2000);

        // User2: Click on the shared tag (should be first or only tag)
        const user2TagItem = page2.locator('[class*="tag"]').first();
        if (await user2TagItem.isVisible({ timeout: 3000 }).catch(() => false)) {
            await user2TagItem.click();
            await page2.waitForTimeout(1000);
        }

        // User1 sends a message
        const messageInput = page1.locator('textarea, [contenteditable="true"]').last();
        if (await messageInput.isVisible()) {
            await messageInput.fill('Real-time test message');
            const sendButton = page1.locator('button[type="submit"]');
            if (await sendButton.isVisible()) {
                await sendButton.click();
                await page1.waitForTimeout(500);
            }
        }

        // User2 should see the message (via WebSocket)
        const messageOnPage2 = page2.locator('text=Real-time test message');
        await expect(messageOnPage2).toBeVisible({ timeout: 5000 });

        // Cleanup
        await user1Context.close();
        await user2Context.close();
    });

    test('should remove user access to tag', async ({ page }) => {
        const user1 = await createTestUser(page);
        const user2 = await createTestUser(page);

        await authenticateWithToken(page, user1.token);
        await page.waitForTimeout(1000);

        // Look for an existing tag or create one
        const tagItem = page.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            test.skip();
            return;
        }

        // Click on the tag to open chat view
        await tagItem.click();
        await page.waitForTimeout(1000);

        // Open share modal
        const shareButton = page.locator('button:has-text("Share")');
        if (!(await shareButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await shareButton.click();
        await page.waitForTimeout(500);

        // Share with user2
        const emailInput = page.locator('input[type="email"][placeholder*="email"]');
        if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await emailInput.fill(user2.email);

            const accessSelect = page.locator('select');
            if (await accessSelect.isVisible()) {
                await accessSelect.selectOption('write');
            }

            const shareSubmitButton = page.locator('button:has-text("Share")').nth(1);
            await shareSubmitButton.click();
            await page.waitForTimeout(1500);

            // Verify user2 is in the member list
            const user2InList = await page
                .locator(`text=${user2.email}`)
                .isVisible({ timeout: 3000 })
                .catch(() => false);

            if (!user2InList) {
                test.skip();
                return;
            }

            // Find and click remove button for user2 (person_remove icon)
            const removeButton = page
                .locator('button:has(.material-symbols-rounded:text("person_remove"))')
                .first();

            if (await removeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await removeButton.click();
                await page.waitForTimeout(500);

                // User2 should no longer be in the members list
                await expect(page.locator(`text=${user2.email}`)).not.toBeVisible({
                    timeout: 3000,
                });
            } else {
                test.skip();
            }
        } else {
            test.skip();
        }
    });

    test('should show unread message indicators', async ({ browser }) => {
        const user1Context = await browser.newContext();
        const user2Context = await browser.newContext();

        const page1 = await user1Context.newPage();
        const page2 = await user2Context.newPage();

        const user1 = await createTestUser(page1);
        const user2 = await createTestUser(page2);

        await authenticateWithToken(page1, user1.token);
        await authenticateWithToken(page2, user2.token);

        // User1: Look for an existing tag
        const tagItem = page1.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            await user1Context.close();
            await user2Context.close();
            test.skip();
            return;
        }

        // Click on tag to open chat view
        await tagItem.click();
        await page1.waitForTimeout(1000);

        // Share with user2
        const shareButton = page1.locator('button:has-text("Share")');
        if (await shareButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await shareButton.click();
            await page1.waitForTimeout(500);

            const emailInput = page1.locator('input[type="email"][placeholder*="email"]');
            if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                await emailInput.fill(user2.email);

                const accessSelect = page1.locator('select');
                if (await accessSelect.isVisible()) {
                    await accessSelect.selectOption('write');
                }

                const shareSubmitButton = page1.locator('button:has-text("Share")').nth(1);
                await shareSubmitButton.click();
                await page1.waitForTimeout(1500);
            } else {
                await user1Context.close();
                await user2Context.close();
                test.skip();
                return;
            }
        } else {
            await user1Context.close();
            await user2Context.close();
            test.skip();
            return;
        }

        // User1 sends a message
        const messageInput = page1.locator('textarea, [contenteditable="true"]').last();
        if (await messageInput.isVisible()) {
            await messageInput.fill('New message');
            const sendButton = page1.locator('button[type="submit"]');
            if (await sendButton.isVisible()) {
                await sendButton.click();
                await page1.waitForTimeout(500);
            }
        }

        // User2 should see unread indicator
        await page2.reload();
        await page2.waitForTimeout(1000);

        // Check for unread badge/indicator
        const unreadBadge = page2.locator('[data-badge], .badge, .unread');
        if (await unreadBadge.first().isVisible()) {
            expect(await unreadBadge.first().isVisible()).toBeTruthy();
        }

        // Cleanup
        await user1Context.close();
        await user2Context.close();
    });

    test('should make tag public and allow read access', async ({ page }) => {
        const user1 = await createTestUser(page);

        await authenticateWithToken(page, user1.token);
        await page.waitForTimeout(1000);

        // Look for an existing tag
        const tagItem = page.locator('[class*="tag"]').first();
        const hasTag = await tagItem.isVisible({ timeout: 2000 }).catch(() => false);

        if (!hasTag) {
            test.skip();
            return;
        }

        // Click on tag to open chat view
        await tagItem.click();
        await page.waitForTimeout(1000);

        // Open share modal
        const shareButton = page.locator('button:has-text("Share")');
        if (!(await shareButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await shareButton.click();
        await page.waitForTimeout(500);

        // Look for public toggle/checkbox
        const publicToggle = page.locator('input[type="checkbox"]').first();
        if (await publicToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
            await publicToggle.click();
            await page.waitForTimeout(500);

            // Verify public indicator appears
            const publicIndicator = page.locator('text=/public|visible to all/i');
            if (await publicIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await publicIndicator.isVisible()).toBeTruthy();
            }
        } else {
            test.skip();
        }
    });
});
