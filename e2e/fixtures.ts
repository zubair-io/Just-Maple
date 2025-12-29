import { test as base, expect, Page } from '@playwright/test';

type TestFixtures = {
    authenticatedPage: Page;
    testUser: { email: string; userId: string; token: string };
};

/**
 * Extended test fixtures with authentication helpers
 */
export const test = base.extend<TestFixtures>({
    /**
     * Creates a test user and returns their credentials
     */
    testUser: async ({ page }, use) => {
        const email = `e2e-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;

        // Request magic link via API
        const response = await page.request.post('http://localhost:7071/api/auth/magic-link', {
            data: { email },
        });

        expect(response.ok()).toBeTruthy();
        const data = await response.json();

        // In dev mode, the API returns a devToken for testing
        const devToken = data.devToken;
        expect(devToken).toBeDefined();

        // Verify the token to get JWT
        const verifyResponse = await page.request.get(
            `http://localhost:7071/api/auth/verify?token=${devToken}`,
        );

        expect(verifyResponse.ok()).toBeTruthy();
        const verifyData = await verifyResponse.json();

        await use({
            email,
            userId: verifyData.user._id,
            token: verifyData.accessToken,
        });
    },

    /**
     * Authenticated page with user already logged in
     */
    authenticatedPage: async ({ page, testUser }, use) => {
        // Navigate to the app
        await page.goto('/');

        // Set the auth token in localStorage
        await page.evaluate((token) => {
            localStorage.setItem('auth_token', token);
        }, testUser.token);

        // Reload to apply the auth state
        await page.reload();

        // Wait for the page to be ready (adjust selector based on your app)
        await page.waitForLoadState('networkidle');

        await use(page);
    },
});

export { expect };

/**
 * Helper to create a test user via API without using fixtures
 */
export async function createTestUser(page: Page) {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;

    const response = await page.request.post('http://localhost:7071/api/auth/magic-link', {
        data: { email },
    });

    const data = await response.json();
    const verifyResponse = await page.request.get(
        `http://localhost:7071/api/auth/verify?token=${data.devToken}`,
    );

    const verifyData = await verifyResponse.json();

    return {
        email,
        userId: verifyData.user._id,
        token: verifyData.accessToken,
    };
}

/**
 * Helper to authenticate a page with a given token
 */
export async function authenticateWithToken(page: Page, token: string) {
    await page.goto('/');
    await page.evaluate((t) => {
        localStorage.setItem('auth_token', t);
    }, token);
    await page.reload();
    await page.waitForLoadState('networkidle');
}
