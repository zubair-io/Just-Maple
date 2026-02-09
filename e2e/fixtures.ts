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
    testUser: async ({ page, baseURL }, use) => {
        const email = `e2e-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;

        // Request magic link via API using baseURL
        const apiBaseUrl = baseURL || 'http://localhost:7072';
        const response = await page.request.post(`${apiBaseUrl}/api/auth/magic-link`, {
            data: { email },
        });

        expect(response.ok()).toBeTruthy();
        const data = await response.json();

        // In dev mode, the API returns a devToken for testing
        const devToken = data.devToken;
        expect(devToken).toBeDefined();

        // Verify the token to get JWT
        const verifyResponse = await page.request.get(
            `${apiBaseUrl}/api/auth/verify?token=${devToken}`,
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

        // Set the auth data in localStorage using the correct key format
        // AuthService uses `auth:${origin}` as the key and stores { accessToken, user }
        await page.evaluate(
            ({ token, userId, email }) => {
                const storageKey = `auth:${window.location.origin}`;
                const authData = {
                    accessToken: token,
                    user: {
                        _id: userId,
                        email: email,
                    },
                };
                localStorage.setItem(storageKey, JSON.stringify(authData));
            },
            { token: testUser.token, userId: testUser.userId, email: testUser.email },
        );

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
export async function createTestUser(page: Page, baseURL: string = 'http://localhost:7072') {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;

    const response = await page.request.post(`${baseURL}/api/auth/magic-link`, {
        data: { email },
    });

    const data = await response.json();
    const verifyResponse = await page.request.get(
        `${baseURL}/api/auth/verify?token=${data.devToken}`,
    );

    const verifyData = await verifyResponse.json();

    return {
        email,
        userId: verifyData.user._id,
        token: verifyData.accessToken,
    };
}

/**
 * Helper to authenticate a page with a given token and user data
 */
export async function authenticateWithToken(
    page: Page,
    token: string,
    userId?: string,
    email?: string,
) {
    await page.goto('/');
    await page.evaluate(
        ({ t, uid, e }) => {
            const storageKey = `auth:${window.location.origin}`;
            const authData = {
                accessToken: t,
                user: {
                    _id: uid || 'test-user-id',
                    email: e || 'test@example.com',
                },
            };
            localStorage.setItem(storageKey, JSON.stringify(authData));
        },
        { t: token, uid: userId, e: email },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
}
