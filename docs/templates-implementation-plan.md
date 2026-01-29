# Templates Feature - Implementation Plan

This document outlines the implementation plan for the Templates System feature as specified in `docs/product-features-spec.md`.

---

## Overview

The Templates feature allows users to:

- Create notes from pre-built system templates
- Save existing memos as custom templates
- Browse templates in a gallery with previews
- Use template variables (e.g., `{{date}}`, `{{notebook}}`)

---

## Implementation Phases

### Phase 1: Backend Foundation

**Effort: ~2-3 days**

| Task | Description                    | Files                                        |
| ---- | ------------------------------ | -------------------------------------------- |
| 1.1  | Create Template TypeBox schema | `packages/shared/src/schemas/template.ts`    |
| 1.2  | Create Template repository     | `apps/api/src/repositories/template.repo.ts` |
| 1.3  | Create Template routes         | `apps/api/src/routes/templates.ts`           |
| 1.4  | Add database indexes           | `apps/api/src/db/client.ts`                  |
| 1.5  | Seed system templates          | `apps/api/src/db/seeds/templates.ts`         |

### Phase 2: Frontend Service & Gallery

**Effort: ~2-3 days**

| Task | Description                           | Files                                                           |
| ---- | ------------------------------------- | --------------------------------------------------------------- |
| 2.1  | Create Template service               | `apps/web/src/app/services/template.service.ts`                 |
| 2.2  | Create TemplateGalleryModal component | `apps/web/src/app/components/organisms/template-gallery-modal/` |
| 2.3  | Create TemplateCard component         | `apps/web/src/app/components/molecules/template-card/`          |
| 2.4  | Integrate with page creation flow     | `apps/web/src/app/layouts/home/`                                |

### Phase 3: Save as Template

**Effort: ~1-2 days**

| Task | Description                           | Files                                                           |
| ---- | ------------------------------------- | --------------------------------------------------------------- |
| 3.1  | Add "Save as Template" to editor menu | `apps/web/src/app/components/organisms/notebook-editor/`        |
| 3.2  | Create SaveAsTemplateModal component  | `apps/web/src/app/components/organisms/save-as-template-modal/` |

### Phase 4: Template Management

**Effort: ~1-2 days**

| Task | Description                                | Files                               |
| ---- | ------------------------------------------ | ----------------------------------- |
| 4.1  | Create Template management page (optional) | `apps/web/src/app/pages/templates/` |
| 4.2  | Add edit/delete functionality              | Extend gallery modal                |

---

## Detailed Implementation

### 1. Shared Schema (`packages/shared/src/schemas/template.ts`)

```typescript
import { Type, Static } from '@sinclair/typebox';

export const TemplateCategorySchema = Type.Union([
    Type.Literal('work'),
    Type.Literal('personal'),
    Type.Literal('planning'),
    Type.Literal('custom'),
]);

export type TemplateCategory = Static<typeof TemplateCategorySchema>;

export const TemplateSchema = Type.Object({
    id: Type.String(),
    userId: Type.Union([Type.String(), Type.Null()]), // null = system template
    title: Type.String(),
    description: Type.String(),
    category: TemplateCategorySchema,
    content: Type.Object({
        type: Type.String(),
        content: Type.Optional(Type.Array(Type.Any())),
    }),
    icon: Type.Optional(Type.String()), // Emoji or icon name
    isSystem: Type.Boolean(),
    usageCount: Type.Optional(Type.Number()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Template = Static<typeof TemplateSchema>;

export const CreateTemplateSchema = Type.Object({
    title: Type.String({ minLength: 1, maxLength: 255 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    category: Type.Optional(TemplateCategorySchema),
    icon: Type.Optional(Type.String()),
    content: Type.Optional(
        Type.Object({
            type: Type.String(),
            content: Type.Optional(Type.Array(Type.Any())),
        }),
    ),
    pageId: Type.Optional(Type.String()), // Copy content from existing page
});

export type CreateTemplate = Static<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    category: Type.Optional(TemplateCategorySchema),
    icon: Type.Optional(Type.String()),
    content: Type.Optional(
        Type.Object({
            type: Type.String(),
            content: Type.Optional(Type.Array(Type.Any())),
        }),
    ),
});

export type UpdateTemplate = Static<typeof UpdateTemplateSchema>;

export const CreatePageFromTemplateSchema = Type.Object({
    notebookId: Type.String(),
    tagId: Type.String(),
    title: Type.Optional(Type.String()),
});

export type CreatePageFromTemplate = Static<typeof CreatePageFromTemplateSchema>;
```

---

### 2. Repository (`apps/api/src/repositories/template.repo.ts`)

```typescript
import { ObjectId, type Collection, type Document } from 'mongodb';
import { database } from '../db/client';
import type { Template, CreateTemplate, UpdateTemplate } from '@maple/shared';
import { v4 as uuidv4 } from 'uuid';

interface TemplateDocument extends Document {
    _id: ObjectId;
    id: string;
    userId: ObjectId | null;
    title: string;
    description: string;
    category: 'work' | 'personal' | 'planning' | 'custom';
    content: { type: string; content?: any[] };
    icon?: string;
    isSystem: boolean;
    usageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<TemplateDocument> {
    return database.collection<TemplateDocument>('templates');
}

function toResponse(doc: TemplateDocument): Template {
    return {
        id: doc.id,
        userId: doc.userId?.toHexString() ?? null,
        title: doc.title,
        description: doc.description,
        category: doc.category,
        content: doc.content,
        icon: doc.icon,
        isSystem: doc.isSystem,
        usageCount: doc.usageCount,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

// Get all templates (system + user's custom)
export async function findTemplates(userId: string): Promise<Template[]> {
    const collection = getCollection();
    const docs = await collection
        .find({
            $or: [{ isSystem: true }, { userId: new ObjectId(userId) }],
        })
        .sort({ isSystem: -1, updatedAt: -1 })
        .toArray();
    return docs.map(toResponse);
}

// Get template by ID
export async function findTemplateById(id: string): Promise<Template | null> {
    const collection = getCollection();
    const doc = await collection.findOne({ id });
    return doc ? toResponse(doc) : null;
}

// Create custom template
export async function createTemplate(userId: string, data: CreateTemplate): Promise<Template> {
    const collection = getCollection();
    const now = new Date();
    const doc: TemplateDocument = {
        _id: new ObjectId(),
        id: uuidv4(),
        userId: new ObjectId(userId),
        title: data.title,
        description: data.description ?? '',
        category: data.category ?? 'custom',
        content: data.content ?? { type: 'doc', content: [] },
        icon: data.icon,
        isSystem: false,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    await collection.insertOne(doc);
    return toResponse(doc);
}

// Update template (only owner can update)
export async function updateTemplate(
    id: string,
    userId: string,
    data: UpdateTemplate,
): Promise<Template | null> {
    const collection = getCollection();
    const result = await collection.findOneAndUpdate(
        { id, userId: new ObjectId(userId), isSystem: false },
        {
            $set: {
                ...data,
                updatedAt: new Date(),
            },
        },
        { returnDocument: 'after' },
    );
    return result ? toResponse(result) : null;
}

// Delete template (only owner can delete)
export async function deleteTemplate(id: string, userId: string): Promise<boolean> {
    const collection = getCollection();
    const result = await collection.deleteOne({
        id,
        userId: new ObjectId(userId),
        isSystem: false,
    });
    return result.deletedCount === 1;
}

// Increment usage count
export async function incrementUsageCount(id: string): Promise<void> {
    const collection = getCollection();
    await collection.updateOne({ id }, { $inc: { usageCount: 1 } });
}
```

---

### 3. API Routes (`apps/api/src/routes/templates.ts`)

```typescript
import Elysia, { t } from 'elysia';
import { jwtPlugin } from '../middleware/jwt';
import {
    findTemplates,
    findTemplateById,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    incrementUsageCount,
} from '../repositories/template.repo';
import { findMemoByNoteId } from '../repositories/memo.repo';
import { createPage } from '../repositories/page.repo';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';

function checkAuth(auth: any, set: any): boolean {
    if (!auth?.user) {
        set.status = 401;
        return false;
    }
    return true;
}

// Extract ProseMirror JSON from Y.js memo content
function extractContentFromYDoc(state: Buffer): { type: string; content?: any[] } {
    try {
        const yDoc = new Y.Doc();
        Y.applyUpdate(yDoc, new Uint8Array(state));
        const yXmlFragment = yDoc.getXmlFragment('prosemirror');
        const json = yDocToProsemirrorJSON(yDoc, 'prosemirror');
        return json as { type: string; content?: any[] };
    } catch {
        return { type: 'doc', content: [] };
    }
}

// Process template variables
function processTemplateVariables(
    content: { type: string; content?: any[] },
    context: { date: string; notebook: string; title: string },
): { type: string; content?: any[] } {
    const processNode = (node: any): any => {
        if (node.type === 'text' && node.text) {
            let text = node.text as string;
            text = text.replace(/\{\{date\}\}/g, context.date);
            text = text.replace(/\{\{notebook\}\}/g, context.notebook);
            text = text.replace(/\{\{title\}\}/g, context.title);
            return { ...node, text };
        }
        if (node.content) {
            return { ...node, content: node.content.map(processNode) };
        }
        return node;
    };

    return {
        ...content,
        content: content.content?.map(processNode),
    };
}

export const templateRoutes = new Elysia({ prefix: '/api/templates' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request, set }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null };
        }
        const token = authHeader.slice(7);
        const payload = await jwt.verify(token);
        if (!payload) {
            return { auth: null };
        }
        return { auth: { user: payload } };
    })

    // List all templates (system + user's)
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }
        const templates = await findTemplates(auth.user._id);
        return { templates };
    })

    // Get single template
    .get('/:id', async ({ auth, set, params }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }
        const template = await findTemplateById(params.id);
        if (!template) {
            set.status = 404;
            return { error: 'Template not found' };
        }
        return { template };
    })

    // Create template
    .post(
        '/',
        async ({ auth, set, body }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            let content = body.content;

            // If pageId provided, extract content from that page's memo
            if (body.pageId && !content) {
                const memo = await findMemoByNoteId(body.pageId);
                if (memo?.state) {
                    content = extractContentFromYDoc(memo.state);
                }
            }

            const template = await createTemplate(auth.user._id, {
                title: body.title,
                description: body.description,
                category: body.category,
                icon: body.icon,
                content,
            });

            return { template };
        },
        {
            body: t.Object({
                title: t.String({ minLength: 1, maxLength: 255 }),
                description: t.Optional(t.String({ maxLength: 500 })),
                category: t.Optional(
                    t.Union([
                        t.Literal('work'),
                        t.Literal('personal'),
                        t.Literal('planning'),
                        t.Literal('custom'),
                    ]),
                ),
                icon: t.Optional(t.String()),
                content: t.Optional(
                    t.Object({
                        type: t.String(),
                        content: t.Optional(t.Array(t.Any())),
                    }),
                ),
                pageId: t.Optional(t.String()),
            }),
        },
    )

    // Update template
    .patch(
        '/:id',
        async ({ auth, set, params, body }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const template = await updateTemplate(params.id, auth.user._id, body);
            if (!template) {
                set.status = 404;
                return { error: 'Template not found or not authorized' };
            }

            return { template };
        },
        {
            body: t.Object({
                title: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
                description: t.Optional(t.String({ maxLength: 500 })),
                category: t.Optional(
                    t.Union([
                        t.Literal('work'),
                        t.Literal('personal'),
                        t.Literal('planning'),
                        t.Literal('custom'),
                    ]),
                ),
                icon: t.Optional(t.String()),
                content: t.Optional(
                    t.Object({
                        type: t.String(),
                        content: t.Optional(t.Array(t.Any())),
                    }),
                ),
            }),
        },
    )

    // Delete template
    .delete('/:id', async ({ auth, set, params }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const deleted = await deleteTemplate(params.id, auth.user._id);
        if (!deleted) {
            set.status = 404;
            return { error: 'Template not found or not authorized' };
        }

        return { success: true };
    })

    // Create page from template
    .post(
        '/:id/apply',
        async ({ auth, set, params, body }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const template = await findTemplateById(params.id);
            if (!template) {
                set.status = 404;
                return { error: 'Template not found' };
            }

            // Process template variables
            const today = new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
            const processedContent = processTemplateVariables(template.content, {
                date: today,
                notebook: body.notebookName ?? '',
                title: body.title ?? template.title,
            });

            // Create new page with template content
            const page = await createPage({
                userId: auth.user._id,
                notebookId: body.notebookId,
                tagId: body.tagId,
                type: 'memo',
                title: body.title ?? template.title,
                content: processedContent,
            });

            // Track usage
            await incrementUsageCount(params.id);

            return { page };
        },
        {
            body: t.Object({
                notebookId: t.String(),
                tagId: t.String(),
                title: t.Optional(t.String()),
                notebookName: t.Optional(t.String()),
            }),
        },
    );
```

---

### 4. System Templates Seed Data (`apps/api/src/db/seeds/templates.ts`)

```typescript
import { database } from '../client';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

const systemTemplates = [
    {
        id: uuidv4(),
        title: 'Meeting Notes',
        description: 'Structured template for taking meeting notes',
        category: 'work' as const,
        icon: '📝',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: '{{title}}' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '📅 {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Attendees' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Agenda' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Discussion Notes' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Action Items' }],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: false },
                            content: [{ type: 'paragraph', content: [] }],
                        },
                    ],
                },
            ],
        },
    },
    {
        id: uuidv4(),
        title: 'Daily Journal',
        description: 'Daily reflection and planning template',
        category: 'personal' as const,
        icon: '📓',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Journal - {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: "🌅 Today's Focus" }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '🙏 Gratitude' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '📝 Notes' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '🌙 Evening Reflection' }],
                },
                { type: 'paragraph', content: [] },
            ],
        },
    },
    {
        id: uuidv4(),
        title: 'Weekly Review',
        description: 'Weekly planning and review template',
        category: 'planning' as const,
        icon: '📆',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Weekly Review - {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '✅ Accomplishments' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '🎯 Goals for Next Week' }],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: false },
                            content: [{ type: 'paragraph', content: [] }],
                        },
                    ],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '💡 Lessons Learned' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '📊 Metrics' }],
                },
                { type: 'paragraph', content: [] },
            ],
        },
    },
    {
        id: uuidv4(),
        title: 'Project Brief',
        description: 'Project planning and overview template',
        category: 'work' as const,
        icon: '🚀',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: '{{title}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Overview' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Goals & Objectives' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Scope' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Timeline' }],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: false },
                            content: [{ type: 'paragraph', content: [] }],
                        },
                    ],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Stakeholders' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Risks & Mitigations' }],
                },
                { type: 'paragraph', content: [] },
            ],
        },
    },
    {
        id: uuidv4(),
        title: 'Bug Report',
        description: 'Structured bug report template',
        category: 'work' as const,
        icon: '🐛',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: '🐛 Bug: {{title}}' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Reported: {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Description' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Steps to Reproduce' }],
                },
                {
                    type: 'orderedList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Expected Behavior' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Actual Behavior' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Environment' }],
                },
                {
                    type: 'bulletList',
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'OS: ' }],
                                },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Browser: ' }],
                                },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Version: ' }],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
];

export async function seedSystemTemplates(): Promise<void> {
    const collection = database.collection('templates');
    const now = new Date();

    for (const template of systemTemplates) {
        const exists = await collection.findOne({ title: template.title, isSystem: true });
        if (!exists) {
            await collection.insertOne({
                _id: new ObjectId(),
                ...template,
                userId: null,
                isSystem: true,
                usageCount: 0,
                createdAt: now,
                updatedAt: now,
            });
        }
    }

    console.log('System templates seeded');
}
```

---

### 5. Frontend Template Service (`apps/web/src/app/services/template.service.ts`)

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { Template, Page } from '@maple/shared';

interface CreateTemplateInput {
    title: string;
    description?: string;
    category?: 'work' | 'personal' | 'planning' | 'custom';
    icon?: string;
    pageId?: string;
    content?: { type: string; content?: any[] };
}

interface UpdateTemplateInput {
    title?: string;
    description?: string;
    category?: 'work' | 'personal' | 'planning' | 'custom';
    icon?: string;
    content?: { type: string; content?: any[] };
}

interface ApplyTemplateInput {
    notebookId: string;
    tagId: string;
    title?: string;
    notebookName?: string;
}

@Injectable({ providedIn: 'root' })
export class TemplateService {
    private readonly http = inject(HttpClient);

    getTemplates(): Observable<{ templates: Template[] }> {
        return this.http.get<{ templates: Template[] }>('/api/templates');
    }

    getTemplate(id: string): Observable<{ template: Template }> {
        return this.http.get<{ template: Template }>(`/api/templates/${id}`);
    }

    createTemplate(data: CreateTemplateInput): Observable<{ template: Template }> {
        return this.http.post<{ template: Template }>('/api/templates', data);
    }

    updateTemplate(id: string, data: UpdateTemplateInput): Observable<{ template: Template }> {
        return this.http.patch<{ template: Template }>(`/api/templates/${id}`, data);
    }

    deleteTemplate(id: string): Observable<{ success: boolean }> {
        return this.http.delete<{ success: boolean }>(`/api/templates/${id}`);
    }

    applyTemplate(id: string, data: ApplyTemplateInput): Observable<{ page: Page }> {
        return this.http.post<{ page: Page }>(`/api/templates/${id}/apply`, data);
    }
}
```

---

### 6. Template Gallery Modal Component

**File: `apps/web/src/app/components/organisms/template-gallery-modal/template-gallery-modal.component.ts`**

```typescript
import { Component, inject, input, output, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { Template } from '@maple/shared';
import { TemplateService } from '../../../services/template.service';
import { TemplateCardComponent } from '../../molecules/template-card/template-card.component';

type CategoryFilter = 'all' | 'work' | 'personal' | 'planning' | 'custom';

@Component({
    selector: 'app-template-gallery-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, TemplateCardComponent],
    templateUrl: './template-gallery-modal.component.html',
    styleUrl: './template-gallery-modal.component.scss',
})
export class TemplateGalleryModalComponent implements OnInit {
    private readonly templateService = inject(TemplateService);

    readonly notebookId = input.required<string>();
    readonly tagId = input.required<string>();
    readonly notebookName = input<string>('');

    readonly closed = output<void>();
    readonly created = output<{ pageId: string }>();

    readonly templates = signal<Template[]>([]);
    readonly isLoading = signal(true);
    readonly isApplying = signal(false);
    readonly error = signal<string | null>(null);
    readonly selectedCategory = signal<CategoryFilter>('all');
    readonly searchQuery = signal('');

    readonly categories: { value: CategoryFilter; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'work', label: 'Work' },
        { value: 'personal', label: 'Personal' },
        { value: 'planning', label: 'Planning' },
        { value: 'custom', label: 'My Templates' },
    ];

    readonly filteredTemplates = computed(() => {
        let result = this.templates();
        const category = this.selectedCategory();
        const query = this.searchQuery().toLowerCase();

        if (category !== 'all') {
            result = result.filter((t) =>
                category === 'custom' ? !t.isSystem : t.category === category,
            );
        }

        if (query) {
            result = result.filter(
                (t) =>
                    t.title.toLowerCase().includes(query) ||
                    t.description.toLowerCase().includes(query),
            );
        }

        return result;
    });

    readonly systemTemplates = computed(() => this.filteredTemplates().filter((t) => t.isSystem));

    readonly customTemplates = computed(() => this.filteredTemplates().filter((t) => !t.isSystem));

    async ngOnInit(): Promise<void> {
        await this.loadTemplates();
    }

    async loadTemplates(): Promise<void> {
        try {
            this.isLoading.set(true);
            this.error.set(null);
            const response = await firstValueFrom(this.templateService.getTemplates());
            this.templates.set(response.templates);
        } catch (err) {
            this.error.set('Failed to load templates');
            console.error('Error loading templates:', err);
        } finally {
            this.isLoading.set(false);
        }
    }

    async applyTemplate(template: Template): Promise<void> {
        try {
            this.isApplying.set(true);
            this.error.set(null);

            const response = await firstValueFrom(
                this.templateService.applyTemplate(template.id, {
                    notebookId: this.notebookId(),
                    tagId: this.tagId(),
                    notebookName: this.notebookName(),
                }),
            );

            this.created.emit({ pageId: response.page.id });
        } catch (err) {
            this.error.set('Failed to create page from template');
            console.error('Error applying template:', err);
        } finally {
            this.isApplying.set(false);
        }
    }

    async deleteTemplate(template: Template): Promise<void> {
        if (template.isSystem) return;

        try {
            await firstValueFrom(this.templateService.deleteTemplate(template.id));
            this.templates.update((templates) => templates.filter((t) => t.id !== template.id));
        } catch (err) {
            this.error.set('Failed to delete template');
            console.error('Error deleting template:', err);
        }
    }

    close(): void {
        this.closed.emit();
    }

    onBackdropClick(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            this.close();
        }
    }
}
```

**File: `apps/web/src/app/components/organisms/template-gallery-modal/template-gallery-modal.component.html`**

```html
<div class="modal-backdrop" (click)="onBackdropClick($event)">
    <div class="modal-container">
        <div class="modal-header">
            <h2>Choose a Template</h2>
            <button class="close-button" (click)="close()">
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>

        <div class="modal-filters">
            <input
                type="text"
                class="search-input"
                placeholder="Search templates..."
                [ngModel]="searchQuery()"
                (ngModelChange)="searchQuery.set($event)"
            />
            <div class="category-tabs">
                @for (cat of categories; track cat.value) {
                <button
                    class="category-tab"
                    [class.active]="selectedCategory() === cat.value"
                    (click)="selectedCategory.set(cat.value)"
                >
                    {{ cat.label }}
                </button>
                }
            </div>
        </div>

        <div class="modal-content">
            @if (isLoading()) {
            <div class="loading">Loading templates...</div>
            } @else if (error()) {
            <div class="error">{{ error() }}</div>
            } @else { @if (systemTemplates().length > 0) {
            <div class="template-section">
                <h3>System Templates</h3>
                <div class="template-grid">
                    @for (template of systemTemplates(); track template.id) {
                    <app-template-card
                        [template]="template"
                        [isApplying]="isApplying()"
                        (apply)="applyTemplate(template)"
                    />
                    }
                </div>
            </div>
            } @if (customTemplates().length > 0) {
            <div class="template-section">
                <h3>My Templates</h3>
                <div class="template-grid">
                    @for (template of customTemplates(); track template.id) {
                    <app-template-card
                        [template]="template"
                        [isApplying]="isApplying()"
                        [showDelete]="true"
                        (apply)="applyTemplate(template)"
                        (delete)="deleteTemplate(template)"
                    />
                    }
                </div>
            </div>
            } @if (filteredTemplates().length === 0) {
            <div class="empty-state">
                <p>No templates found</p>
            </div>
            } }
        </div>

        <div class="modal-footer">
            <button class="btn-secondary" (click)="close()">Cancel</button>
            <button class="btn-primary" disabled>Start from Blank</button>
        </div>
    </div>
</div>
```

---

### 7. Template Card Component

**File: `apps/web/src/app/components/molecules/template-card/template-card.component.ts`**

```typescript
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Template } from '@maple/shared';

@Component({
    selector: 'app-template-card',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './template-card.component.html',
    styleUrl: './template-card.component.scss',
})
export class TemplateCardComponent {
    readonly template = input.required<Template>();
    readonly isApplying = input(false);
    readonly showDelete = input(false);

    readonly apply = output<void>();
    readonly delete = output<void>();

    getCategoryColor(): string {
        const colors: Record<string, string> = {
            work: 'bg-blue-100 text-blue-800',
            personal: 'bg-green-100 text-green-800',
            planning: 'bg-purple-100 text-purple-800',
            custom: 'bg-orange-100 text-orange-800',
        };
        return colors[this.template().category] ?? 'bg-gray-100 text-gray-800';
    }

    onApply(event: Event): void {
        event.stopPropagation();
        this.apply.emit();
    }

    onDelete(event: Event): void {
        event.stopPropagation();
        this.delete.emit();
    }
}
```

**File: `apps/web/src/app/components/molecules/template-card/template-card.component.html`**

```html
<div class="template-card" (click)="onApply($event)">
    <div class="card-header">
        <span class="icon">{{ template().icon ?? '📄' }}</span>
        @if (showDelete()) {
        <button class="delete-btn" (click)="onDelete($event)" title="Delete template">
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                ></path>
            </svg>
        </button>
        }
    </div>

    <div class="card-body">
        <h4 class="title">{{ template().title }}</h4>
        <p class="description">{{ template().description }}</p>
    </div>

    <div class="card-footer">
        <span class="category-badge" [ngClass]="getCategoryColor()">
            {{ template().category }}
        </span>
        @if (template().usageCount && template().usageCount > 0) {
        <span class="usage-count">Used {{ template().usageCount }} times</span>
        }
    </div>
</div>
```

---

### 8. Integration Points

#### 8.1 Register Routes in Main App (`apps/api/src/index.ts`)

```typescript
import { templateRoutes } from './routes/templates';

// Add to Elysia app
app.use(templateRoutes);
```

#### 8.2 Update Sidebar to Show Template Option

In the sidebar component, add a "New from Template" button alongside the regular "New Page" button:

```typescript
// In sidebar.component.ts
readonly newFromTemplate = output<void>();

onNewFromTemplate(): void {
    this.newFromTemplate.emit();
}
```

#### 8.3 Home Layout Integration

```typescript
// In home.component.ts
showTemplateGallery = signal(false);

onNewFromTemplate(): void {
    this.showTemplateGallery.set(true);
}

onTemplateCreated(event: { pageId: string }): void {
    this.showTemplateGallery.set(false);
    this.router.navigate(['/', this.currentTagId(), event.pageId]);
}
```

---

## Database Indexes

Add to `apps/api/src/db/client.ts`:

```typescript
// In ensureIndexes function
await database.collection('templates').createIndex({ userId: 1, updatedAt: -1 });
await database.collection('templates').createIndex({ isSystem: 1 });
await database.collection('templates').createIndex({ category: 1 });
```

---

## Testing Checklist

### Backend

- [ ] GET /api/templates returns system + user templates
- [ ] POST /api/templates creates custom template
- [ ] POST /api/templates with pageId extracts content from memo
- [ ] PATCH /api/templates/:id updates only user's own templates
- [ ] DELETE /api/templates/:id deletes only user's own templates
- [ ] POST /api/templates/:id/apply creates page with template content
- [ ] Template variables ({{date}}, {{title}}) are substituted

### Frontend

- [ ] Template gallery modal opens from sidebar
- [ ] Templates load and display correctly
- [ ] Category filtering works
- [ ] Search filtering works
- [ ] Clicking template creates new page
- [ ] Navigation to new page works
- [ ] Delete button appears only for custom templates
- [ ] Delete removes template from list

---

## Future Enhancements

1. **Template Preview** - Show content preview on hover
2. **Template Sharing** - Share templates with other users
3. **Template Categories** - Allow custom categories
4. **Template Duplicates** - Duplicate and edit templates
5. **Import/Export** - Export templates as JSON

---

## Success Metrics

| Metric                   | Target                          |
| ------------------------ | ------------------------------- |
| Template usage rate      | 20% of new pages from templates |
| Custom templates created | 2+ per active user              |
| Most popular template    | Track for insights              |
