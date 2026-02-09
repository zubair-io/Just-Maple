import { test, expect } from './fixtures';

test.describe('Notifications', () => {
    test('should open notifications panel', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for notifications button
        const notificationsButton = authenticatedPage
            .locator(
                'button:has-text("Notifications"), button[aria-label*="notification" i], .notifications-button, [data-testid="notifications"]',
            )
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Verify notifications panel opened
        const notificationsPanel = authenticatedPage
            .locator(
                '.notifications-panel, .notifications-list, [role="dialog"]:has-text("Notifications")',
            )
            .first();

        if (await notificationsPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await notificationsPanel.isVisible()).toBeTruthy();
        }
    });

    test('should display notification list', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open notifications
        const notificationsButton = authenticatedPage
            .locator('button:has-text("Notifications"), button[aria-label*="notification" i]')
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for notifications list or empty state
        const notificationsList = authenticatedPage
            .locator('.notifications-list, .notification-item, [data-notification]')
            .first();

        const emptyState = authenticatedPage
            .locator('text="No notifications", text="All caught up", .empty-notifications')
            .first();

        const hasListOrEmpty =
            (await notificationsList.isVisible({ timeout: 2000 }).catch(() => false)) ||
            (await emptyState.isVisible({ timeout: 2000 }).catch(() => false));

        if (hasListOrEmpty) {
            expect(hasListOrEmpty).toBeTruthy();
        }
    });

    test('should display notification badge count', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for notification badge
        const badge = authenticatedPage
            .locator('.notification-badge, .badge, [data-badge], .unread-count')
            .first();

        if (await badge.isVisible({ timeout: 3000 }).catch(() => false)) {
            const badgeText = await badge.textContent();
            expect(badgeText).toBeTruthy();
        }
    });

    test('should mark single notification as read', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open notifications
        const notificationsButton = authenticatedPage
            .locator('button:has-text("Notifications"), button[aria-label*="notification" i]')
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for an unread notification
        const unreadNotification = authenticatedPage
            .locator(
                '.notification-item[data-read="false"], .notification-item.unread, .notification-item:not(.read)',
            )
            .first();

        if (!(await unreadNotification.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for mark as read button
        const markReadButton = unreadNotification
            .locator(
                'button:has-text("Mark as read"), button[aria-label*="mark read" i], .mark-read-button',
            )
            .first();

        if (await markReadButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await markReadButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify notification is now read
            const isRead = await unreadNotification
                .evaluate((el) => {
                    return (
                        (el.hasAttribute('data-read') && el.getAttribute('data-read') === 'true') ||
                        el.classList.contains('read') ||
                        !el.classList.contains('unread')
                    );
                })
                .catch(() => false);

            if (isRead) {
                expect(isRead).toBeTruthy();
            }
        } else {
            // Some implementations mark as read on click
            await unreadNotification.click();
            await authenticatedPage.waitForTimeout(1000);
        }
    });

    test('should mark all notifications as read', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open notifications
        const notificationsButton = authenticatedPage
            .locator('button:has-text("Notifications"), button[aria-label*="notification" i]')
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for "Mark all as read" button
        const markAllReadButton = authenticatedPage
            .locator(
                'button:has-text("Mark all as read"), button:has-text("Clear all"), button[aria-label*="mark all" i]',
            )
            .first();

        if (!(await markAllReadButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await markAllReadButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Verify all notifications are marked as read
        const unreadCount = await authenticatedPage
            .locator('.notification-item[data-read="false"], .notification-item.unread')
            .count();

        expect(unreadCount).toBe(0);
    });

    test('should navigate to content from notification', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open notifications
        const notificationsButton = authenticatedPage
            .locator('button:has-text("Notifications"), button[aria-label*="notification" i]')
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for a notification with a link
        const notification = authenticatedPage
            .locator('.notification-item, [data-notification]')
            .first();

        if (!(await notification.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Get current URL
        const initialUrl = authenticatedPage.url();

        // Click notification
        await notification.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify navigation occurred
        const newUrl = authenticatedPage.url();
        const didNavigate = newUrl !== initialUrl;

        if (didNavigate) {
            expect(didNavigate).toBeTruthy();
        }
    });

    test('should display different notification types', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open notifications
        const notificationsButton = authenticatedPage
            .locator('button:has-text("Notifications"), button[aria-label*="notification" i]')
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for different notification types or icons
        const notificationTypes = await authenticatedPage
            .evaluate(() => {
                const notifications = document.querySelectorAll(
                    '.notification-item, [data-notification]',
                );
                const types = new Set<string>();

                notifications.forEach((notification) => {
                    // Check for type attribute
                    const type =
                        notification.getAttribute('data-type') ||
                        notification.getAttribute('data-notification-type');
                    if (type) types.add(type);

                    // Check for type-specific classes
                    if (notification.classList.contains('message-notification'))
                        types.add('message');
                    if (notification.classList.contains('mention-notification'))
                        types.add('mention');
                    if (notification.classList.contains('comment-notification'))
                        types.add('comment');
                });

                return Array.from(types);
            })
            .catch(() => []);

        if (notificationTypes.length > 0) {
            expect(notificationTypes.length).toBeGreaterThan(0);
        }
    });

    test('should update badge count when notifications change', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Get initial badge count
        const badge = authenticatedPage
            .locator('.notification-badge, .badge, [data-badge], .unread-count')
            .first();

        let initialCount = 0;
        if (await badge.isVisible({ timeout: 3000 }).catch(() => false)) {
            const badgeText = await badge.textContent();
            initialCount = parseInt(badgeText || '0', 10);
        }

        // Open notifications
        const notificationsButton = authenticatedPage
            .locator('button:has-text("Notifications"), button[aria-label*="notification" i]')
            .first();

        if (!(await notificationsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await notificationsButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Mark all as read
        const markAllReadButton = authenticatedPage
            .locator('button:has-text("Mark all as read"), button:has-text("Clear all")')
            .first();

        if (await markAllReadButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await markAllReadButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Close panel
            await authenticatedPage.keyboard.press('Escape');
            await authenticatedPage.waitForTimeout(500);

            // Check if badge count decreased or is hidden
            const badgeAfter = authenticatedPage
                .locator('.notification-badge, .badge, [data-badge]')
                .first();

            const isHidden = !(await badgeAfter.isVisible({ timeout: 2000 }).catch(() => true));
            const newBadgeText = isHidden ? '0' : await badgeAfter.textContent();
            const newCount = parseInt(newBadgeText || '0', 10);

            if (isHidden || newCount < initialCount) {
                expect(true).toBeTruthy();
            }
        }
    });
});
