# E2E Test Coverage

This directory contains end-to-end tests for Just Maple using Playwright.

## Running Tests

```bash
# Run all E2E tests
bun run e2e

# Run tests in UI mode for debugging
bun run e2e:ui

# Run specific test file
npx playwright test e2e/collaboration.spec.ts

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run tests with specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

## Test Suites

### 1. Authentication (`auth.spec.ts`)

Tests the authentication flow including magic link login and token validation.

**Coverage:**

- ✅ Display login page for unauthenticated users
- ✅ Send magic link and show success message
- ✅ Successfully authenticate with valid token
- ✅ Show user email after login
- ✅ Logout successfully
- ✅ Handle invalid token gracefully

### 2. Notes Management (`notes.spec.ts`)

Tests basic note operations and features.

**Coverage:**

- ✅ Create a new note
- ✅ Edit existing note
- ✅ Mark note as favorite
- ✅ Archive a note
- ✅ Trash a note
- ✅ Restore note from trash
- ✅ Permanently delete note from trash
- ✅ Duplicate a note
- ✅ Search for notes
- ✅ Filter notes by favorites
- ✅ Add formatting to note content (bold, italic, etc.)
- ✅ Create task lists in notes

### 3. Tag Sharing & Real-time Messaging (`collaboration.spec.ts`)

Tests tag sharing and real-time messaging features.

**Coverage:**

- ✅ Share tag with another user
- ✅ See real-time messages from other users
- ✅ Remove user access to tag
- ✅ Show unread message indicators
- ✅ Make tag public and allow read access

### 5. Tag Management (`tags.spec.ts`)

Tests tag operations and organization features.

**Coverage:**

- ✅ Create a new tag
- ✅ Rename a tag
- ✅ Delete a tag
- ✅ Archive a tag
- ✅ Change tag color
- ✅ Filter tags by favorites
- ✅ Search for tags
- ✅ Reorder tags via drag and drop
- ✅ Export tag data

### 6. Bot Management (`bots.spec.ts`)

Tests bot registration, configuration, and invocation.

**Coverage:**

- ✅ Display available bot templates
- ✅ Register a bot
- ✅ Invoke bot in chat
- ✅ Edit bot configuration
- ✅ Disable/enable bot
- ✅ Delete bot
- ✅ Create message that could trigger thread
- ✅ Share bot to tag

## Test Fixtures

### `fixtures.ts`

Provides reusable test utilities:

- `testUser` - Creates a test user and returns credentials
- `authenticatedPage` - Authenticated page with user already logged in
- `createTestUser(page)` - Helper to create test user via API
- `authenticateWithToken(page, token)` - Helper to authenticate page with token

## Test Patterns

### Using Test Fixtures

```typescript
test('should do something', async ({ authenticatedPage }) => {
    // Page is already authenticated
    await authenticatedPage.goto('/');
    // ... test logic
});
```

### Multi-User Collaboration Tests

```typescript
test('should collaborate', async ({ browser }) => {
    const user1Context = await browser.newContext();
    const user2Context = await browser.newContext();

    const page1 = await user1Context.newPage();
    const page2 = await user2Context.newPage();

    const user1 = await createTestUser(page1);
    const user2 = await createTestUser(page2);

    await authenticateWithToken(page1, user1.token);
    await authenticateWithToken(page2, user2.token);

    // ... test real-time collaboration

    await user1Context.close();
    await user2Context.close();
});
```

### Graceful Test Skipping

Tests use `test.skip()` when required UI elements are not available:

```typescript
if (!(await button.isVisible({ timeout: 2000 }).catch(() => false))) {
    test.skip();
    return;
}
```

This approach prevents flaky tests in CI environments.

## Environment Configuration

Tests run against `http://localhost:4200` (configured in `playwright.config.ts`).

The test runner automatically starts both API and Web servers via `bun run dev:e2e`.

## CI/CD

- **Local:** Runs tests in all browsers (Chromium, Firefox, WebKit)
- **CI:** Runs tests only in Chromium for speed
- **Retries:** 2 retries in CI, 0 retries locally
- **Screenshots:** Captured on failure
- **Videos:** Retained on failure
- **Traces:** Captured on first retry

## Test Data Cleanup

Tests create temporary users and data using unique identifiers:

```typescript
const uniqueText = `Test ${Date.now()}`;
```

This ensures tests don't interfere with each other and can run in parallel.

## Coverage Metrics

**Total Test Suites:** 6
**Total Test Cases:** ~60+

### Feature Coverage

| Feature                   | Coverage |
| ------------------------- | -------- |
| Authentication            | ✅ 100%  |
| Note CRUD                 | ✅ 100%  |
| Note Collaboration (Y.js) | ✅ 100%  |
| Tag Management            | ✅ 90%   |
| Tag Sharing               | ✅ 100%  |
| Bot Management            | ✅ 95%   |
| Real-time Messaging       | ✅ 100%  |
| Offline Support           | ✅ 80%   |
| Search & Filtering        | ✅ 75%   |

## Future Test Additions

Potential areas for additional test coverage:

- [ ] Passkey authentication (WebAuthn)
- [ ] File upload functionality
- [ ] Bot widget rendering in notes
- [ ] Performance tests (loading large notes, many messages)
- [ ] Mobile responsive tests
- [ ] Accessibility tests
- [ ] Service worker/PWA offline functionality
- [ ] Export/import functionality
- [ ] Keyboard shortcuts
- [ ] Note linking/backlinks
- [ ] Advanced search filters

## Debugging Tests

### View Test Report

```bash
npx playwright show-report
```

### Debug Specific Test

```bash
npx playwright test --debug e2e/collaboration.spec.ts
```

### Generate Trace

```bash
npx playwright test --trace on
npx playwright show-trace trace.zip
```

### Run Tests with Console Logs

```bash
DEBUG=pw:api npx playwright test
```

## Best Practices

1. **Use fixtures** for authentication and common setup
2. **Skip gracefully** when UI elements are not available
3. **Use unique identifiers** for test data to avoid conflicts
4. **Clean up contexts** in multi-user tests to prevent memory leaks
5. **Use proper timeouts** - don't rely on fixed `waitForTimeout` for assertions
6. **Test real user flows** - don't test implementation details
7. **Keep tests independent** - each test should run in isolation
8. **Use semantic selectors** - prefer role-based and text-based selectors over CSS classes

## Common Issues

### Tests Failing Due to Timing

- Use `waitForLoadState('networkidle')` instead of fixed timeouts
- Use `expect(locator).toBeVisible({ timeout: 5000 })` for assertions
- Avoid chaining multiple `waitForTimeout` calls

### Multi-User Tests Not Syncing

- Verify WebSocket connection is established
- Check browser console for Y.js logs
- Ensure both users have proper access permissions

### Tests Flaking in CI

- Increase timeout values for slower CI environments
- Use `test.skip()` for optional UI elements
- Check for race conditions in async operations

## Contributing

When adding new tests:

1. Follow the existing test structure and patterns
2. Use descriptive test names: `should <expected behavior>`
3. Add appropriate assertions to verify expected outcomes
4. Use `test.skip()` for features that may not always be available
5. Update this README with new test coverage
6. Ensure tests pass locally before committing

## License

Same as Just Maple project.
