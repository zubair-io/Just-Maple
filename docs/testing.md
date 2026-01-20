# Testing Guide

This guide covers the testing strategy for Just Maple, including unit tests, integration tests, and end-to-end tests.

## Overview

Just Maple uses a comprehensive testing approach:

| Test Type         | Tool                           | Coverage                        |
| ----------------- | ------------------------------ | ------------------------------- |
| Unit Tests        | Vitest                         | Components, services, utilities |
| Integration Tests | Vitest + MongoDB Memory Server | API routes, repositories        |
| E2E Tests         | Playwright                     | Critical user flows             |

---

## Test Architecture

```
just-maple/
├── vitest.workspace.ts              # Workspace config
├── playwright.config.ts             # E2E config
│
├── packages/
│   └── shared/
│       ├── vitest.config.ts
│       └── src/schemas/__tests__/   # Schema validation tests
│
├── apps/
│   ├── api/
│   │   ├── vitest.config.ts
│   │   └── src/__tests__/           # API tests
│   │       ├── setup.ts             # MongoDB Memory Server
│   │       └── helpers/
│   │
│   └── web/
│       ├── vitest.config.ts
│       └── src/app/**/__tests__/    # Component tests
│
└── e2e/                             # Playwright tests
    ├── tests/
    └── fixtures/
```

---

## Running Tests

### All Tests

```bash
bun run test                  # Run all unit tests
bun run test:watch           # Watch mode
bun run test:coverage        # Coverage report
bun run test:ui              # Vitest UI
```

### By Package

```bash
bun run test:api             # API tests only
bun run test:web             # Web tests only
bun run test:shared          # Shared package tests
```

### E2E Tests

```bash
bun run e2e                  # Run all E2E tests
bun run e2e:ui               # Playwright UI mode
bun run e2e:headed           # Show browser
bun run e2e:debug            # Debug mode
```

---

## Unit Testing

### Vitest Configuration

```typescript
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
    'packages/shared/vitest.config.ts',
    'apps/api/vitest.config.ts',
    'apps/web/vitest.config.ts',
]);
```

### API Config

```typescript
// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        name: 'api',
        environment: 'node',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        include: ['src/**/*.{test,spec}.ts'],
        testTimeout: 30000,
        hookTimeout: 30000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.{test,spec}.ts', 'src/__tests__/**'],
        },
    },
    resolve: {
        alias: {
            '@maple/shared': path.resolve(__dirname, '../../packages/shared/src'),
        },
    },
});
```

### Web Config (Angular + Vitest)

```typescript
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
    plugins: [angular()],
    test: {
        name: 'web',
        globals: true,
        environment: 'jsdom',
        setupFiles: ['src/test-setup.ts'],
        include: ['src/**/*.{test,spec}.ts'],
        exclude: ['e2e/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/app/**/*.ts'],
            exclude: ['src/**/*.{test,spec}.ts'],
        },
    },
});
```

---

## API Testing

### MongoDB Memory Server Setup

```typescript
// apps/api/src/__tests__/setup.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { beforeAll, afterAll, beforeEach } from 'vitest';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
        instance: { dbName: 'maple-test' },
    });

    const uri = mongod.getUri();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('maple-test');

    globalThis.__MONGO_DB__ = db;
    globalThis.__MONGO_CLIENT__ = client;
});

afterAll(async () => {
    await client.close();
    await mongod.stop();
});

beforeEach(async () => {
    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
        await db.collection(collection.name).deleteMany({});
    }
});

declare global {
    var __MONGO_DB__: Db;
    var __MONGO_CLIENT__: MongoClient;
}
```

### Test Fixtures

```typescript
// apps/api/src/__tests__/helpers/fixtures.ts
import { ObjectId } from 'mongodb';
import type { User, Notebook, Page } from '@maple/shared';

export function createTestUser(overrides: Partial<User> = {}): User {
    return {
        _id: new ObjectId().toString(),
        email: `test-${Date.now()}@example.com`,
        displayName: 'Test User',
        pushTokens: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

export function createTestNotebook(userId: string, overrides: Partial<Notebook> = {}): Notebook {
    const id = new ObjectId().toString();
    return {
        _id: id,
        name: 'Test Notebook',
        slug: `test-notebook-${id}`,
        createdBy: userId,
        members: [
            {
                userId,
                role: 'owner',
                addedAt: new Date().toISOString(),
                addedBy: userId,
            },
        ],
        settings: {
            allowMemberInvite: true,
            defaultNotePermission: 'edit',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}
```

### Repository Tests

```typescript
// apps/api/src/repositories/__tests__/user.repo.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as userRepo from '../user.repo';
import { getTestDb } from '../../__tests__/helpers/db';

describe('UserRepository', () => {
    beforeEach(() => {
        // DB is cleaned in setup.ts beforeEach
    });

    describe('create', () => {
        it('should create a new user', async () => {
            const user = await userRepo.create('test@example.com');

            expect(user._id).toBeDefined();
            expect(user.email).toBe('test@example.com');
            expect(user.pushTokens).toEqual([]);
        });

        it('should reject duplicate emails', async () => {
            await userRepo.create('test@example.com');

            await expect(userRepo.create('test@example.com')).rejects.toThrow();
        });
    });

    describe('findByEmail', () => {
        it('should find existing user', async () => {
            const created = await userRepo.create('find@example.com');
            const found = await userRepo.findByEmail('find@example.com');

            expect(found?._id).toBe(created._id);
        });

        it('should return null for non-existent user', async () => {
            const found = await userRepo.findByEmail('nonexistent@example.com');
            expect(found).toBeNull();
        });
    });
});
```

### Route Tests

```typescript
// apps/api/src/routes/__tests__/notebooks.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeader } from '../../__tests__/helpers/app';
import { createTestUser, createTestNotebook } from '../../__tests__/helpers/fixtures';
import { getTestDb } from '../../__tests__/helpers/db';
import jwt from 'jsonwebtoken';

describe('Notebooks Routes', () => {
    let app: Awaited<ReturnType<typeof createTestApp>>;
    let testUser: ReturnType<typeof createTestUser>;
    let authToken: string;

    beforeEach(async () => {
        app = await createTestApp();
        const db = getTestDb();

        testUser = createTestUser();
        await db.collection('users').insertOne(testUser);
        authToken = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET || 'test-secret');
    });

    describe('GET /api/notebooks', () => {
        it('should return empty array when user has no notebooks', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/notebooks', {
                    headers: authHeader(authToken),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data).toEqual([]);
        });

        it('should return user notebooks', async () => {
            const db = getTestDb();
            const notebook = createTestNotebook(testUser._id);
            await db.collection('notebooks').insertOne(notebook);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks', {
                    headers: authHeader(authToken),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data).toHaveLength(1);
            expect(data[0].name).toBe(notebook.name);
        });

        it('should require authentication', async () => {
            const response = await app.handle(new Request('http://localhost/api/notebooks'));

            expect(response.status).toBe(401);
        });
    });

    describe('POST /api/notebooks', () => {
        it('should create a new notebook', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/notebooks', {
                    method: 'POST',
                    headers: {
                        ...authHeader(authToken),
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name: 'My Project',
                        description: 'A test project',
                    }),
                }),
            );

            expect(response.status).toBe(201);
            const data = await response.json();
            expect(data.name).toBe('My Project');
            expect(data.slug).toBe('my-project');
            expect(data.createdBy).toBe(testUser._id);
        });
    });
});
```

---

## Web Testing

### Angular Component Tests

```typescript
// apps/web/src/app/components/__tests__/button.component.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from '../atoms/button/button.component';

describe('ButtonComponent', () => {
    let component: ButtonComponent;
    let fixture: ComponentFixture<ButtonComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ButtonComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(ButtonComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should emit clicked event', () => {
        const clickSpy = vi.fn();
        component.clicked.subscribe(clickSpy);

        const button = fixture.nativeElement.querySelector('button');
        button.click();

        expect(clickSpy).toHaveBeenCalled();
    });

    it('should not emit when disabled', () => {
        const clickSpy = vi.fn();
        component.clicked.subscribe(clickSpy);
        fixture.componentRef.setInput('disabled', true);
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector('button');
        button.click();

        expect(clickSpy).not.toHaveBeenCalled();
    });
});
```

### Service Tests

```typescript
// apps/web/src/app/services/__tests__/notebook.service.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { NotebookService } from '../notebook.service';
import type { Notebook } from '@maple/shared';

describe('NotebookService', () => {
    let service: NotebookService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [NotebookService],
        });

        service = TestBed.inject(NotebookService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getNotebooks', () => {
        it('should fetch notebooks from API', async () => {
            const mockNotebooks: Notebook[] = [
                {
                    _id: '1',
                    name: 'Project A',
                    slug: 'project-a',
                    createdBy: 'user-1',
                    members: [],
                    settings: { allowMemberInvite: true, defaultNotePermission: 'edit' },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ];

            const notebooksPromise = service.getNotebooks();

            const req = httpMock.expectOne('/api/notebooks');
            expect(req.request.method).toBe('GET');
            req.flush(mockNotebooks);

            const notebooks = await notebooksPromise;
            expect(notebooks).toHaveLength(1);
            expect(notebooks[0].name).toBe('Project A');
        });
    });
});
```

---

## E2E Testing

### Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e/tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',

    use: {
        baseURL: 'http://localhost:4200',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
        {
            name: 'Mobile Safari',
            use: { ...devices['iPhone 13'] },
        },
    ],

    webServer: [
        {
            command: 'bun run dev:api',
            url: 'http://localhost:7071/server/info',
            reuseExistingServer: !process.env.CI,
        },
        {
            command: 'bun run dev:web',
            url: 'http://localhost:4200',
            reuseExistingServer: !process.env.CI,
        },
    ],
});
```

### E2E Test Examples

```typescript
// e2e/tests/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
    test('should show login page for unauthenticated users', async ({ page }) => {
        await page.goto('/');

        await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
        await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    });

    test('should request magic link', async ({ page }) => {
        await page.goto('/login');

        await page.getByPlaceholder(/email/i).fill('test@example.com');
        await page.getByRole('button', { name: /send magic link/i }).click();

        await expect(page.getByText(/check your email/i)).toBeVisible();
    });
});
```

```typescript
// e2e/tests/notebooks.spec.ts
import { test, expect } from '../fixtures';

test.describe('Notebooks', () => {
    test('should create a new notebook', async ({ authenticatedPage: page }) => {
        await page.goto('/');

        await page.getByRole('button', { name: /new notebook/i }).click();
        await page.getByPlaceholder(/notebook name/i).fill('My Test Project');
        await page.getByRole('button', { name: /create/i }).click();

        await expect(page.getByText('My Test Project')).toBeVisible();
    });

    test('should work offline', async ({ authenticatedPage: page, context }) => {
        await page.goto('/');

        // Create notebook while online
        await page.getByRole('button', { name: /new notebook/i }).click();
        await page.getByPlaceholder(/notebook name/i).fill('Offline Test');
        await page.getByRole('button', { name: /create/i }).click();
        await page.waitForTimeout(1000);

        // Go offline
        await context.setOffline(true);
        await expect(page.getByTestId('offline-indicator')).toBeVisible();

        // Should still show notebook
        await expect(page.getByText('Offline Test')).toBeVisible();

        // Go back online
        await context.setOffline(false);
        await expect(page.getByTestId('sync-status')).toContainText(/synced/i, { timeout: 10000 });
    });
});
```

---

## Test Fixtures

```typescript
// e2e/fixtures/index.ts
import { test as base, Page } from '@playwright/test';

export const test = base.extend<{
    authenticatedPage: Page;
}>({
    authenticatedPage: async ({ page }, use) => {
        // Create test user via API
        const response = await fetch('http://localhost:7071/test/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `e2e-${Date.now()}@test.com` }),
        });
        const { token } = await response.json();

        // Set auth token
        await page.goto('/');
        await page.evaluate((t) => {
            localStorage.setItem('auth_token', t);
        }, token);

        await page.reload();
        await use(page);
    },
});

export { expect } from '@playwright/test';
```

---

## Coverage Requirements

### Target Coverage

| Package         | Target |
| --------------- | ------ |
| `@maple/shared` | 90%+   |
| `apps/api`      | 80%+   |
| `apps/web`      | 70%+   |

### Generate Coverage Report

```bash
bun run test:coverage
```

View report at `coverage/index.html`.

---

## Best Practices

### Test Naming

```typescript
describe('FeatureName', () => {
    describe('methodName', () => {
        it('should do something when condition', async () => {
            // ...
        });
    });
});
```

### Arrange-Act-Assert

```typescript
it('should update notebook', async () => {
    // Arrange
    const notebook = createTestNotebook(userId);
    await db.collection('notebooks').insertOne(notebook);

    // Act
    const result = await notebookRepo.update(notebook._id, { name: 'Updated' });

    // Assert
    expect(result?.name).toBe('Updated');
});
```

### Avoid Test Interdependence

- Each test should be independent
- Use `beforeEach` to reset state
- Don't rely on test execution order

### Mock External Services

```typescript
import { vi } from 'vitest';

vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: {
            send: vi.fn().mockResolvedValue({ id: 'mock-id' }),
        },
    })),
}));
```

---

## CI Integration

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
    test:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: oven-sh/setup-bun@v1
            - run: bun install
            - run: bun run test:coverage
            - uses: codecov/codecov-action@v4
```

---

## Next Steps

- [Best Practices](./best-practices.md) - Code quality standards
- [Deployment](./deployment.md) - CI/CD setup
- [Architecture](./architecture.md) - System design
