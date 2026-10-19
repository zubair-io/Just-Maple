import { test as base, expect, Page } from '@playwright/test';

type TestFixtures = {
    authenticatedPage: Page;
    testUser: { displayName: string; userId: string; token: string };
};

/**
 * Extended test fixtures with authentication helpers
 */
export const test = base.extend<TestFixtures>({
    /**
     * Creates a test user and returns their credentials
     */
    testUser: async ({ page, baseURL, browserName }, use) => {
        base.skip(
            browserName !== 'chromium',
            'Virtual passkey authenticator requires Chromium CDP',
        );
        await use(await createTestUser(page, baseURL));
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
            ({ token, userId, displayName }) => {
                const storageKey = `auth:${window.location.origin}`;
                const authData = {
                    accessToken: token,
                    user: {
                        _id: userId,
                        displayName,
                    },
                };
                localStorage.setItem(storageKey, JSON.stringify(authData));
            },
            { token: testUser.token, userId: testUser.userId, displayName: testUser.displayName },
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
    base.skip(
        page.context().browser()?.browserType().name() !== 'chromium',
        'Virtual passkey authenticator requires Chromium CDP',
    );
    const displayName = `E2E reader ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
    try {
        await page.goto(baseURL);
        await page.evaluate(() => localStorage.clear());
        await page.goto(`${baseURL}/login`);
        await page.getByRole('button', { name: 'New to Just Maple? Create an account' }).click();
        await page.locator('input#displayName').fill(displayName);
        const response = page.waitForResponse((r) =>
            r.url().endsWith('/api/auth/passkey/signup/finish'),
        );
        await page.getByRole('button', { name: 'Create account with a passkey' }).click();
        const result = await response;
        expect(result.ok()).toBeTruthy();
        const data = await result.json();
        await expect(page).not.toHaveURL(/\/login/);
        return { displayName, userId: data.user._id, token: data.accessToken };
    } finally {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
        await cdp.detach();
    }
}

/**
 * Helper to authenticate a page with a given token and user data
 */
export async function authenticateWithToken(
    page: Page,
    token: string,
    userId?: string,
    displayName?: string,
) {
    await page.goto('/');
    await page.evaluate(
        ({ t, uid, e }) => {
            const storageKey = `auth:${window.location.origin}`;
            const authData = {
                accessToken: t,
                user: {
                    _id: uid || 'test-user-id',
                    displayName: e || 'Test reader',
                },
            };
            localStorage.setItem(storageKey, JSON.stringify(authData));
        },
        { t: token, uid: userId, e: displayName },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
}
