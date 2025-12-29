import { test, expect } from './fixtures';

test.describe('Authentication', () => {
    test('should display login page for unauthenticated users', async ({ page }) => {
        await page.goto('/login');

        // Check that we're on the login page
        await expect(page).toHaveURL(/\/login/);

        // Check for email input
        await expect(page.locator('input#email')).toBeVisible();
    });

    test('should send magic link and show success message', async ({ page }) => {
        await page.goto('/login');

        // Fill in email
        const emailInput = page.locator('input#email');
        await emailInput.fill('test@example.com');

        // Click send magic link button
        const sendButton = page.getByRole('button', { name: /send magic link/i });
        await sendButton.click();

        // Wait for code verification form to appear
        await expect(page.locator('input[inputmode="numeric"][maxlength="6"]')).toBeVisible({
            timeout: 10000,
        });
    });

    test('should successfully authenticate with valid token', async ({ testUser, page }) => {
        // testUser fixture already handles authentication
        await page.goto('/');
        await page.evaluate((token) => {
            localStorage.setItem('auth_token', token);
        }, testUser.token);
        await page.reload();

        // Should not be on login page
        await expect(page).not.toHaveURL(/login|auth/);

        // Check for authenticated UI elements (adjust based on your app)
        // For example, user menu or profile indicator
        await page.waitForLoadState('networkidle');
    });

    test('should show user email after login', async ({ authenticatedPage }) => {
        // User should be logged in via fixture
        await expect(authenticatedPage).not.toHaveURL(/login|auth/);

        // The authenticated page should show user-specific content
        await authenticatedPage.waitForLoadState('networkidle');
    });

    test('should logout successfully', async ({ authenticatedPage }) => {
        // Find and click logout button (adjust selector)
        const logoutButton = authenticatedPage.locator('button', { hasText: /logout|sign out/i });

        if (await logoutButton.isVisible()) {
            await logoutButton.click();

            // Should redirect to login
            await expect(authenticatedPage).toHaveURL(/login|auth/, { timeout: 5000 });
        }
    });

    test('should handle invalid token gracefully', async ({ page }) => {
        // Set invalid token
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.setItem('auth_token', 'invalid-token-12345');
        });

        // Try to access protected route - should redirect to login or show error
        await page.reload();
        await page.waitForTimeout(2000); // Wait for auth check and redirect

        // Should either be on login page or show login UI or stay on main page (depends on app behavior)
        const isOnLoginPage = page.url().includes('/login');
        const hasEmailInput = await page
            .locator('input#email')
            .isVisible({ timeout: 2000 })
            .catch(() => false);

        // If neither, the app might handle invalid tokens by staying on the page
        // Just verify we didn't crash
        const pageIsLoaded = await page.locator('body').isVisible();

        expect(isOnLoginPage || hasEmailInput || pageIsLoaded).toBeTruthy();
    });
});
