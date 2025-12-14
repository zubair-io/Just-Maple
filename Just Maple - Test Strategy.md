# Just Maple - Test Strategy

## Overview

This document outlines a unified testing strategy using:

- **Vitest** - Unit & integration tests (Backend + Frontend + Shared)
- **MongoDB Memory Server** - In-memory MongoDB for backend tests
- **Playwright** - End-to-end browser tests

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
│       └── src/
│           └── schemas/
│               └── __tests__/       # Schema validation tests
│
├── apps/
│   ├── api/                         # PaperbarkMaple
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── __tests__/
│   │       │   ├── setup.ts         # MongoDB Memory Server setup
│   │       │   └── helpers/
│   │       ├── routes/
│   │       │   └── __tests__/       # Route tests
│   │       └── repositories/
│   │           └── __tests__/       # Repository tests
│   │
│   └── web/                         # SugarMaple
│       ├── vitest.config.ts
│       └── src/
│           └── app/
│               ├── components/
│               │   └── __tests__/   # Component tests
│               └── services/
│                   └── __tests__/   # Service tests
│
└── e2e/                             # Playwright tests
    ├── tests/
    │   ├── auth.spec.ts
    │   ├── documents.spec.ts
    │   └── chat.spec.ts
    └── fixtures/
```

---

## Part 1: Vitest Configuration

### Root Workspace Config

```typescript
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
    'packages/shared/vitest.config.ts',
    'apps/api/vitest.config.ts',
    'apps/web/vitest.config.ts',
]);
```

### Backend Config (PaperbarkMaple)

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
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.{test,spec}.ts', 'src/__tests__/**'],
        },
        testTimeout: 30000, // MongoDB operations can be slow
        hookTimeout: 30000,
    },
    resolve: {
        alias: {
            '@maple/shared': path.resolve(__dirname, '../../packages/shared/src'),
        },
    },
});
```

### Frontend Config (SugarMaple with Angular)

Angular + Vitest requires the Analog adapter or Angular's experimental builder:

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
            exclude: ['src/**/*.{test,spec}.ts', 'src/app/**/*.module.ts', 'src/main.ts'],
        },
    },
    resolve: {
        alias: {
            '@maple/shared': '../../packages/shared/src',
        },
    },
});
```

```typescript
// apps/web/src/test-setup.ts
import '@analogjs/vitest-angular/setup-zone';
import { getTestBed } from '@angular/core/testing';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
```

### Shared Package Config

```typescript
// packages/shared/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'shared',
        globals: true,
        include: ['src/**/*.{test,spec}.ts'],
    },
});
```

---

## Part 2: MongoDB Memory Server Setup

### Installation

```bash
bun add -D mongodb-memory-server vitest
```

### Test Setup File

```typescript
// apps/api/src/__tests__/setup.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

// Start MongoDB Memory Server before all tests
beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
        instance: {
            dbName: 'maple-test',
        },
    });

    const uri = mongod.getUri();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('maple-test');

    // Make db available globally for tests
    globalThis.__MONGO_DB__ = db;
    globalThis.__MONGO_CLIENT__ = client;
});

// Clean up after all tests
afterAll(async () => {
    await client.close();
    await mongod.stop();
});

// Clear collections between tests for isolation
beforeEach(async () => {
    const collections = await db.listCollections().toArray();
    for (const collection of collections) {
        await db.collection(collection.name).deleteMany({});
    }
});

// Declare global types
declare global {
    var __MONGO_DB__: Db;
    var __MONGO_CLIENT__: MongoClient;
}

export { db, client };
```

### Test Helpers

```typescript
// apps/api/src/__tests__/helpers/db.ts
import { Db } from 'mongodb';

export function getTestDb(): Db {
    return globalThis.__MONGO_DB__;
}

// apps/api/src/__tests__/helpers/fixtures.ts
import { ObjectId } from 'mongodb';
import type { User, Tag, Note } from '@maple/shared';

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

export function createTestTag(userId: string, overrides: Partial<Tag> = {}): Tag {
    const id = new ObjectId().toString();
    return {
        _id: id,
        name: 'Test Tag',
        slug: `test-tag-${id}`,
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

export function createTestNote(tagId: string, userId: string, overrides: Partial<Note> = {}): Note {
    return {
        _id: new ObjectId().toString(),
        tagId,
        userId,
        title: 'Test Note',
        doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
        },
        syncStatus: 'synced',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

// apps/api/src/__tests__/helpers/app.ts
import { Elysia } from 'elysia';
import { getTestDb } from './db';

// Create a test instance of the Elysia app
export async function createTestApp() {
    const db = getTestDb();

    // Import your actual app and inject test db
    const { createApp } = await import('../../server');
    return createApp({ db });
}

// Helper for making authenticated requests
export function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
}
```

---

## Part 3: Backend Test Examples

### Repository Tests

```typescript
// apps/api/src/repositories/__tests__/user.repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { UserRepository } from '../user.repo';
import { getTestDb } from '../../__tests__/helpers/db';
import { createTestUser } from '../../__tests__/helpers/fixtures';

describe('UserRepository', () => {
    let repo: UserRepository;

    beforeEach(() => {
        repo = new UserRepository(getTestDb());
    });

    describe('create', () => {
        it('should create a new user', async () => {
            const user = await repo.create('test@example.com');

            expect(user._id).toBeDefined();
            expect(user.email).toBe('test@example.com');
            expect(user.pushTokens).toEqual([]);
        });

        it('should reject duplicate emails', async () => {
            await repo.create('test@example.com');

            await expect(repo.create('test@example.com')).rejects.toThrow('User already exists');
        });
    });

    describe('findByEmail', () => {
        it('should find existing user', async () => {
            const created = await repo.create('find@example.com');
            const found = await repo.findByEmail('find@example.com');

            expect(found?._id).toBe(created._id);
        });

        it('should return null for non-existent user', async () => {
            const found = await repo.findByEmail('nonexistent@example.com');
            expect(found).toBeNull();
        });
    });

    describe('addPushToken', () => {
        it('should add push token to user', async () => {
            const user = await repo.create('push@example.com');

            await repo.addPushToken(user._id, {
                token: 'device-token-123',
                platform: 'ios',
                createdAt: new Date().toISOString(),
            });

            const updated = await repo.findById(user._id);
            expect(updated?.pushTokens).toHaveLength(1);
            expect(updated?.pushTokens[0].platform).toBe('ios');
        });
    });
});
```

### Route Tests (Integration)

```typescript
// apps/api/src/routes/__tests__/tags.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeader } from '../../__tests__/helpers/app';
import { createTestUser, createTestTag } from '../../__tests__/helpers/fixtures';
import { getTestDb } from '../../__tests__/helpers/db';
import jwt from 'jsonwebtoken';

describe('Tags Routes', () => {
    let app: Awaited<ReturnType<typeof createTestApp>>;
    let testUser: ReturnType<typeof createTestUser>;
    let authToken: string;

    beforeEach(async () => {
        app = await createTestApp();
        const db = getTestDb();

        // Create test user
        testUser = createTestUser();
        await db.collection('users').insertOne(testUser);

        // Generate auth token
        authToken = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET || 'test-secret');
    });

    describe('GET /tags', () => {
        it('should return empty array when user has no tags', async () => {
            const response = await app.handle(
                new Request('http://localhost/tags', {
                    headers: authHeader(authToken),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data).toEqual([]);
        });

        it('should return user tags', async () => {
            const db = getTestDb();
            const tag = createTestTag(testUser._id);
            await db.collection('tags').insertOne(tag);

            const response = await app.handle(
                new Request('http://localhost/tags', {
                    headers: authHeader(authToken),
                }),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data).toHaveLength(1);
            expect(data[0].name).toBe(tag.name);
        });

        it('should not return tags user is not a member of', async () => {
            const db = getTestDb();
            const otherUser = createTestUser({ email: 'other@example.com' });
            const otherTag = createTestTag(otherUser._id);
            await db.collection('tags').insertOne(otherTag);

            const response = await app.handle(
                new Request('http://localhost/tags', {
                    headers: authHeader(authToken),
                }),
            );

            const data = await response.json();
            expect(data).toEqual([]);
        });
    });

    describe('POST /tags', () => {
        it('should create a new tag', async () => {
            const response = await app.handle(
                new Request('http://localhost/tags', {
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
            expect(data.members[0].role).toBe('owner');
        });

        it('should reject duplicate slugs', async () => {
            const db = getTestDb();
            const existingTag = createTestTag(testUser._id, { slug: 'my-project' });
            await db.collection('tags').insertOne(existingTag);

            const response = await app.handle(
                new Request('http://localhost/tags', {
                    method: 'POST',
                    headers: {
                        ...authHeader(authToken),
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ name: 'My Project' }),
                }),
            );

            expect(response.status).toBe(409);
        });

        it('should require authentication', async () => {
            const response = await app.handle(
                new Request('http://localhost/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Unauthorized' }),
                }),
            );

            expect(response.status).toBe(401);
        });
    });

    describe('DELETE /tags/:id', () => {
        it('should allow owner to delete tag', async () => {
            const db = getTestDb();
            const tag = createTestTag(testUser._id);
            await db.collection('tags').insertOne(tag);

            const response = await app.handle(
                new Request(`http://localhost/tags/${tag._id}`, {
                    method: 'DELETE',
                    headers: authHeader(authToken),
                }),
            );

            expect(response.status).toBe(204);

            const deleted = await db.collection('tags').findOne({ _id: tag._id });
            expect(deleted).toBeNull();
        });

        it('should not allow non-owners to delete tag', async () => {
            const db = getTestDb();
            const owner = createTestUser({ email: 'owner@example.com' });
            await db.collection('users').insertOne(owner);

            const tag = createTestTag(owner._id, {
                members: [
                    {
                        userId: owner._id,
                        role: 'owner',
                        addedAt: new Date().toISOString(),
                        addedBy: owner._id,
                    },
                    {
                        userId: testUser._id,
                        role: 'member',
                        addedAt: new Date().toISOString(),
                        addedBy: owner._id,
                    },
                ],
            });
            await db.collection('tags').insertOne(tag);

            const response = await app.handle(
                new Request(`http://localhost/tags/${tag._id}`, {
                    method: 'DELETE',
                    headers: authHeader(authToken),
                }),
            );

            expect(response.status).toBe(403);
        });
    });
});
```

### Auth Route Tests

```typescript
// apps/api/src/routes/__tests__/auth.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import { getTestDb } from '../../__tests__/helpers/db';

// Mock Resend email service
vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: {
            send: vi.fn().mockResolvedValue({ id: 'mock-email-id' }),
        },
    })),
}));

describe('Auth Routes', () => {
    let app: Awaited<ReturnType<typeof createTestApp>>;

    beforeEach(async () => {
        app = await createTestApp();
    });

    describe('POST /auth/magic-link', () => {
        it('should create user and send magic link for new email', async () => {
            const response = await app.handle(
                new Request('http://localhost/auth/magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'new@example.com' }),
                }),
            );

            expect(response.status).toBe(200);

            const db = getTestDb();
            const user = await db.collection('users').findOne({ email: 'new@example.com' });
            expect(user).toBeDefined();

            const magicLink = await db.collection('magic_links').findOne({ userId: user?._id });
            expect(magicLink).toBeDefined();
            expect(magicLink?.token).toBeDefined();
        });

        it('should reject invalid email', async () => {
            const response = await app.handle(
                new Request('http://localhost/auth/magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'not-an-email' }),
                }),
            );

            expect(response.status).toBe(400);
        });
    });

    describe('GET /auth/verify', () => {
        it('should verify valid token and return JWT', async () => {
            const db = getTestDb();

            // Create user and magic link
            const userId = 'test-user-id';
            await db.collection('users').insertOne({
                _id: userId,
                email: 'verify@example.com',
                pushTokens: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const token = 'valid-token-123';
            await db.collection('magic_links').insertOne({
                userId,
                token,
                expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
            });

            const response = await app.handle(
                new Request(`http://localhost/auth/verify?token=${token}`),
            );

            expect(response.status).toBe(200);
            const data = await response.json();
            expect(data.token).toBeDefined();
            expect(data.user.email).toBe('verify@example.com');

            // Magic link should be deleted after use
            const usedLink = await db.collection('magic_links').findOne({ token });
            expect(usedLink).toBeNull();
        });

        it('should reject expired token', async () => {
            const db = getTestDb();

            await db.collection('magic_links').insertOne({
                userId: 'test-user',
                token: 'expired-token',
                expiresAt: new Date(Date.now() - 1000), // Already expired
            });

            const response = await app.handle(
                new Request('http://localhost/auth/verify?token=expired-token'),
            );

            expect(response.status).toBe(401);
        });
    });
});
```

---

## Part 4: Frontend Test Examples (Angular + Vitest)

### Service Tests

```typescript
// apps/web/src/app/services/__tests__/tag.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TagService } from '../tag.service';
import type { Tag } from '@maple/shared';

describe('TagService', () => {
    let service: TagService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [TagService],
        });

        service = TestBed.inject(TagService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('getTags', () => {
        it('should fetch tags from API', async () => {
            const mockTags: Tag[] = [
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

            const tagsPromise = service.getTags();

            const req = httpMock.expectOne('/api/tags');
            expect(req.request.method).toBe('GET');
            req.flush(mockTags);

            const tags = await tagsPromise;
            expect(tags).toHaveLength(1);
            expect(tags[0].name).toBe('Project A');
        });
    });

    describe('createTag', () => {
        it('should POST new tag', async () => {
            const newTag = { name: 'New Project', description: 'Test' };
            const mockResponse: Tag = {
                _id: '2',
                name: 'New Project',
                slug: 'new-project',
                description: 'Test',
                createdBy: 'user-1',
                members: [],
                settings: { allowMemberInvite: true, defaultNotePermission: 'edit' },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const createPromise = service.createTag(newTag);

            const req = httpMock.expectOne('/api/tags');
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual(newTag);
            req.flush(mockResponse);

            const created = await createPromise;
            expect(created.slug).toBe('new-project');
        });
    });
});
```

### Component Tests

```typescript
// apps/web/src/app/components/sidebar/__tests__/sidebar.component.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SidebarComponent } from '../sidebar.component';
import { TagService } from '../../../services/tag.service';

describe('SidebarComponent', () => {
    let component: SidebarComponent;
    let fixture: ComponentFixture<SidebarComponent>;
    let mockTagService: Partial<TagService>;

    beforeEach(async () => {
        mockTagService = {
            tags: signal([
                {
                    _id: '1',
                    name: 'Project Alpha',
                    slug: 'project-alpha',
                    createdBy: 'user-1',
                    members: [],
                    settings: { allowMemberInvite: true, defaultNotePermission: 'edit' },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ]),
            selectedTagId: signal<string | null>(null),
            selectTag: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [SidebarComponent],
            providers: [{ provide: TagService, useValue: mockTagService }],
        }).compileComponents();

        fixture = TestBed.createComponent(SidebarComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should render tag list', () => {
        const tagItems = fixture.nativeElement.querySelectorAll('.tag-item');
        expect(tagItems).toHaveLength(1);
        expect(tagItems[0].textContent).toContain('Project Alpha');
    });

    it('should call selectTag when tag is clicked', () => {
        const tagItem = fixture.nativeElement.querySelector('.tag-item');
        tagItem.click();

        expect(mockTagService.selectTag).toHaveBeenCalledWith('1');
    });

    it('should highlight selected tag', () => {
        (mockTagService.selectedTagId as any).set('1');
        fixture.detectChanges();

        const selectedTag = fixture.nativeElement.querySelector('.tag-item.selected');
        expect(selectedTag).toBeDefined();
    });
});
```

### Store Tests (Elf)

```typescript
// apps/web/src/app/stores/__tests__/document.store.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, withProps, select } from '@ngneat/elf';
import {
    withEntities,
    selectAllEntities,
    setEntities,
    updateEntities,
    selectEntity,
} from '@ngneat/elf-entities';
import type { Note } from '@maple/shared';

interface DocumentState {
    selectedId: string | null;
    syncStatus: 'idle' | 'syncing' | 'error';
}

describe('DocumentStore', () => {
    let store: ReturnType<typeof createDocumentStore>;

    function createDocumentStore() {
        return createStore(
            { name: 'documents' },
            withEntities<Note, '_id'>({ idKey: '_id' }),
            withProps<DocumentState>({ selectedId: null, syncStatus: 'idle' }),
        );
    }

    beforeEach(() => {
        store = createDocumentStore();
    });

    it('should initialize with empty entities', () => {
        let entities: Note[] = [];
        store.pipe(selectAllEntities()).subscribe((e) => (entities = e));

        expect(entities).toEqual([]);
    });

    it('should set entities', () => {
        const notes: Note[] = [
            {
                _id: '1',
                tagId: 'tag-1',
                userId: 'user-1',
                title: 'Test Note',
                doc: { type: 'doc', content: [] },
                syncStatus: 'synced',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];

        store.update(setEntities(notes));

        let entities: Note[] = [];
        store.pipe(selectAllEntities()).subscribe((e) => (entities = e));

        expect(entities).toHaveLength(1);
        expect(entities[0].title).toBe('Test Note');
    });

    it('should update entity sync status', () => {
        const note: Note = {
            _id: '1',
            tagId: 'tag-1',
            userId: 'user-1',
            title: 'Test Note',
            doc: { type: 'doc', content: [] },
            syncStatus: 'synced',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        store.update(setEntities([note]));
        store.update(updateEntities('1', { syncStatus: 'pending' }));

        let updated: Note | undefined;
        store.pipe(selectEntity('1')).subscribe((e) => (updated = e));

        expect(updated?.syncStatus).toBe('pending');
    });
});
```

---

## Part 5: Shared Package Tests

```typescript
// packages/shared/src/schemas/__tests__/tag.test.ts
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { TagSchema, TagMemberSchema } from '../tag';

describe('TagSchema', () => {
    const validTag = {
        _id: '507f1f77bcf86cd799439011',
        name: 'Test Tag',
        slug: 'test-tag',
        createdBy: '507f1f77bcf86cd799439012',
        members: [
            {
                userId: '507f1f77bcf86cd799439012',
                role: 'owner',
                addedAt: '2024-01-01T00:00:00Z',
                addedBy: '507f1f77bcf86cd799439012',
            },
        ],
        settings: {
            allowMemberInvite: true,
            defaultNotePermission: 'edit',
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should validate correct tag', () => {
        expect(Value.Check(TagSchema, validTag)).toBe(true);
    });

    it('should reject tag without required fields', () => {
        const { name, ...tagWithoutName } = validTag;
        expect(Value.Check(TagSchema, tagWithoutName)).toBe(false);
    });

    it('should accept optional fields', () => {
        const tagWithOptional = {
            ...validTag,
            description: 'A test description',
            color: '#ff0000',
            icon: '📁',
        };
        expect(Value.Check(TagSchema, tagWithOptional)).toBe(true);
    });

    it('should reject invalid member role', () => {
        const tagWithBadRole = {
            ...validTag,
            members: [
                {
                    ...validTag.members[0],
                    role: 'superadmin', // Invalid role
                },
            ],
        };
        expect(Value.Check(TagSchema, tagWithBadRole)).toBe(false);
    });
});

describe('TagMemberSchema', () => {
    it('should validate all role types', () => {
        const roles = ['owner', 'admin', 'member', 'viewer'];

        for (const role of roles) {
            const member = {
                userId: 'user-123',
                role,
                addedAt: '2024-01-01T00:00:00Z',
                addedBy: 'user-456',
            };
            expect(Value.Check(TagMemberSchema, member)).toBe(true);
        }
    });
});
```

---

## Part 6: Playwright E2E Tests

### Configuration

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

### Test Fixtures

```typescript
// e2e/fixtures/index.ts
import { test as base, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';

// Extend base test with custom fixtures
export const test = base.extend<{
    authenticatedPage: Page;
    testUser: { email: string; token: string };
}>({
    // Create authenticated page fixture
    authenticatedPage: async ({ page }, use) => {
        // Create test user via API
        const response = await fetch('http://localhost:7071/test/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `e2e-${Date.now()}@test.com` }),
        });
        const { token } = await response.json();

        // Set auth cookie/token
        await page.goto('/');
        await page.evaluate((t) => {
            localStorage.setItem('auth_token', t);
        }, token);

        await page.reload();
        await use(page);
    },

    testUser: async ({}, use) => {
        const email = `e2e-${Date.now()}@test.com`;
        const response = await fetch('http://localhost:7071/test/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const { token } = await response.json();

        await use({ email, token });
    },
});

export { expect };
```

### E2E Test Examples

```typescript
// e2e/tests/auth.spec.ts
import { test, expect } from '../fixtures';

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

    test('should redirect authenticated users to dashboard', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/login');

        // Should redirect to main app
        await expect(authenticatedPage).toHaveURL('/');
        await expect(authenticatedPage.getByTestId('sidebar')).toBeVisible();
    });
});
```

```typescript
// e2e/tests/documents.spec.ts
import { test, expect } from '../fixtures';

test.describe('Documents', () => {
    test('should create a new tag', async ({ authenticatedPage: page }) => {
        await page.goto('/');

        // Click new tag button
        await page.getByRole('button', { name: /new tag/i }).click();

        // Fill form
        await page.getByPlaceholder(/tag name/i).fill('My Test Project');
        await page.getByRole('button', { name: /create/i }).click();

        // Verify tag appears in sidebar
        await expect(page.getByText('My Test Project')).toBeVisible();
    });

    test('should create a new note in tag', async ({ authenticatedPage: page }) => {
        await page.goto('/');

        // Create tag first
        await page.getByRole('button', { name: /new tag/i }).click();
        await page.getByPlaceholder(/tag name/i).fill('Notes Test');
        await page.getByRole('button', { name: /create/i }).click();

        // Select the tag
        await page.getByText('Notes Test').click();

        // Create note
        await page.keyboard.press('Meta+n'); // Cmd+N shortcut

        // Should open editor
        await expect(page.getByRole('textbox', { name: /title/i })).toBeVisible();

        // Type title and content
        await page.getByRole('textbox', { name: /title/i }).fill('My First Note');
        await page.getByTestId('editor-content').click();
        await page.keyboard.type('This is the note content.');

        // Note should appear in sidebar
        await expect(page.getByText('My First Note')).toBeVisible();
    });

    test('should show sync status indicator', async ({ authenticatedPage: page }) => {
        await page.goto('/');

        // Create and edit a note
        await page.getByRole('button', { name: /new tag/i }).click();
        await page.getByPlaceholder(/tag name/i).fill('Sync Test');
        await page.getByRole('button', { name: /create/i }).click();
        await page.getByText('Sync Test').click();

        await page.keyboard.press('Meta+n');
        await page.getByRole('textbox', { name: /title/i }).fill('Sync Note');

        // Should show syncing indicator
        await expect(page.getByTestId('sync-status')).toContainText(/syncing|pending/i);

        // Wait for sync to complete
        await expect(page.getByTestId('sync-status')).toContainText(/synced/i, { timeout: 5000 });
    });

    test('should work offline', async ({ authenticatedPage: page, context }) => {
        await page.goto('/');

        // Create initial data while online
        await page.getByRole('button', { name: /new tag/i }).click();
        await page.getByPlaceholder(/tag name/i).fill('Offline Test');
        await page.getByRole('button', { name: /create/i }).click();
        await page.getByText('Offline Test').click();

        // Wait for sync
        await page.waitForTimeout(1000);

        // Go offline
        await context.setOffline(true);

        // Should show offline indicator
        await expect(page.getByTestId('offline-indicator')).toBeVisible();

        // Create note while offline
        await page.keyboard.press('Meta+n');
        await page.getByRole('textbox', { name: /title/i }).fill('Offline Note');
        await page.getByTestId('editor-content').click();
        await page.keyboard.type('Created while offline');

        // Note should be saved locally
        await expect(page.getByText('Offline Note')).toBeVisible();
        await expect(page.getByTestId('sync-status')).toContainText(/pending/i);

        // Go back online
        await context.setOffline(false);

        // Should sync
        await expect(page.getByTestId('sync-status')).toContainText(/synced/i, { timeout: 10000 });
    });
});
```

```typescript
// e2e/tests/chat.spec.ts
import { test, expect } from '../fixtures';

test.describe('Chat', () => {
    test('should send and receive messages', async ({ authenticatedPage: page }) => {
        await page.goto('/');

        // Create tag
        await page.getByRole('button', { name: /new tag/i }).click();
        await page.getByPlaceholder(/tag name/i).fill('Chat Test');
        await page.getByRole('button', { name: /create/i }).click();

        // Select tag (opens chat)
        await page.getByText('Chat Test').click();

        // Type message
        const messageInput = page.getByPlaceholder(/type a message/i);
        await messageInput.fill('Hello, world!');
        await messageInput.press('Enter');

        // Message should appear
        await expect(page.getByText('Hello, world!')).toBeVisible();
    });
});
```

---

## Part 7: Package.json Scripts

```json
{
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest",
        "test:ui": "vitest --ui",
        "test:coverage": "vitest run --coverage",

        "test:api": "vitest run --project api",
        "test:web": "vitest run --project web",
        "test:shared": "vitest run --project shared",

        "e2e": "playwright test",
        "e2e:ui": "playwright test --ui",
        "e2e:headed": "playwright test --headed",
        "e2e:debug": "playwright test --debug",

        "test:ci": "vitest run --coverage && playwright test"
    }
}
```

---

## Part 8: CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Test

on:
    push:
        branches: [main]
    pull_request:
        branches: [main]

jobs:
    unit-tests:
        runs-on: ubuntu-latest

        steps:
            - uses: actions/checkout@v4

            - uses: oven-sh/setup-bun@v1
              with:
                  bun-version: latest

            - name: Install dependencies
              run: bun install

            - name: Run unit tests
              run: bun run test:coverage

            - name: Upload coverage
              uses: codecov/codecov-action@v4
              with:
                  files: ./coverage/lcov.info

    e2e-tests:
        runs-on: ubuntu-latest

        steps:
            - uses: actions/checkout@v4

            - uses: oven-sh/setup-bun@v1
              with:
                  bun-version: latest

            - name: Install dependencies
              run: bun install

            - name: Install Playwright browsers
              run: bunx playwright install --with-deps

            - name: Start MongoDB
              uses: supercharge/mongodb-github-action@v1.10.0
              with:
                  mongodb-version: '7.0'

            - name: Run E2E tests
              run: bun run e2e
              env:
                  MONGODB_URI: mongodb://localhost:27017/maple-test
                  JWT_SECRET: test-secret

            - name: Upload test results
              if: always()
              uses: actions/upload-artifact@v4
              with:
                  name: playwright-report
                  path: playwright-report/
```

---

## Summary

| Test Layer            | Tool                           | Coverage Target                |
| --------------------- | ------------------------------ | ------------------------------ |
| **Unit (Shared)**     | Vitest                         | Schema validation, type guards |
| **Unit (API)**        | Vitest + MongoDB Memory Server | Repositories, services         |
| **Integration (API)** | Vitest + MongoDB Memory Server | Route handlers, auth flows     |
| **Unit (Web)**        | Vitest + @analogjs             | Components, services, stores   |
| **E2E**               | Playwright                     | Critical user flows            |

**Key Benefits of This Stack:**

1. **Unified runner** - Vitest for all unit/integration tests
2. **Fast feedback** - MongoDB Memory Server = no external DB needed
3. **Type-safe** - Same TypeBox schemas validate in tests
4. **Realistic E2E** - Playwright covers the full stack
5. **CI-ready** - All tests run in GitHub Actions
