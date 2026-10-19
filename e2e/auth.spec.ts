import { test, expect } from '@playwright/test';

test.describe('Passkey-only authentication', () => {
    test.skip(
        ({ browserName }) => browserName !== 'chromium',
        'Virtual authenticator requires CDP',
    );

    test('creates an email-free account, signs out, and signs in with its discoverable passkey', async ({
        page,
    }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', {
            options: {
                protocol: 'ctap2',
                transport: 'internal',
                hasResidentKey: true,
                hasUserVerification: true,
                isUserVerified: true,
                automaticPresenceSimulation: true,
            },
        });
        await page.goto('/login?returnUrl=%2Fsettings');
        await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
        await expect(page.locator('input[type="email"]')).toHaveCount(0);
        await page.getByRole('button', { name: 'New to Just Maple? Create an account' }).click();
        await page.locator('input#displayName').fill('Passkey reader');
        const signupResponse = page.waitForResponse((r) =>
            r.url().endsWith('/api/auth/passkey/signup/finish'),
        );
        await page.getByRole('button', { name: 'Create account with a passkey' }).click();
        const signup = await signupResponse;
        expect(signup.ok()).toBeTruthy();
        const account = await signup.json();
        expect(account.user.email).toBeUndefined();
        await expect(page).toHaveURL(/\/settings$/);
        await page.getByRole('button', { name: /sign out|log out|logout/i }).click();
        await expect(page).toHaveURL(/\/login/);
        const loginResponse = page.waitForResponse((r) =>
            r.url().endsWith('/api/auth/passkey/login/finish'),
        );
        await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
        const login = await loginResponse;
        expect(login.ok()).toBeTruthy();
        expect((await login.json()).user._id).toBe(account.user._id);
        await expect(page).not.toHaveURL(/\/login/);
        // Old email endpoints cannot issue credentials.
        expect(
            (
                await page.request.post('/api/auth/magic-link', {
                    data: { email: 'old@example.com' },
                })
            ).status(),
        ).toBe(404);
        await cdp.detach();
    });
    test('rejects a registration response for a different origin without signing in', async ({
        page,
    }) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', {
            options: {
                protocol: 'ctap2',
                transport: 'internal',
                hasResidentKey: true,
                hasUserVerification: true,
                isUserVerified: true,
                automaticPresenceSimulation: true,
            },
        });
        await page.route('**/api/auth/passkey/signup/finish', async (route) => {
            const body = route.request().postDataJSON();
            const data = JSON.parse(
                Buffer.from(body.response.clientDataJSON, 'base64url').toString(),
            );
            data.origin = 'https://untrusted.example';
            body.response.clientDataJSON = Buffer.from(JSON.stringify(data)).toString('base64url');
            await route.continue({ postData: JSON.stringify(body) });
        });
        await page.goto('/login');
        await page.getByRole('button', { name: 'New to Just Maple? Create an account' }).click();
        await page.locator('input#displayName').fill('Unverified reader');
        const response = page.waitForResponse((r) =>
            r.url().endsWith('/api/auth/passkey/signup/finish'),
        );
        await page.getByRole('button', { name: 'Create account with a passkey' }).click();
        expect((await response).status()).toBe(400);
        await expect(page.getByRole('alert')).toContainText('Could not create account');
        await expect(page).toHaveURL(/\/login$/);
        expect(
            await page.evaluate(() => localStorage.getItem(`auth:${location.origin}`)),
        ).toBeNull();
        await cdp.detach();
    });
});
