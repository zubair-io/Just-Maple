import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createAuthToken,
    createTemplateFixture,
    createNotebookFixture,
} from '../../__tests__/helpers/fixtures';
import { testDb, mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('Template Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    async function getAuthToken(userId: string, email: string) {
        return createAuthToken(userId, email);
    }

    describe('GET /api/templates', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(new Request('http://localhost/api/templates'));
            expect(response.status).toBe(401);
        });

        it('should return empty array when no templates exist', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/templates', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as { templates: unknown[] };
            expect(data.templates).toEqual([]);
        });

        it('should return user templates and system templates', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            // Create a system template
            await createTemplateFixture({
                title: 'System Template',
                isSystem: true,
                userId: null,
            });

            // Create a user template
            await createTemplateFixture({
                title: 'User Template',
                userId: user._id.toString(),
            });

            // Create another user's template (should not be returned)
            const otherUser = await createUserFixture();
            await createTemplateFixture({
                title: 'Other User Template',
                userId: otherUser._id.toString(),
            });

            const response = await app.handle(
                new Request('http://localhost/api/templates', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as { templates: Array<{ title: string }> };
            expect(data.templates).toHaveLength(2);
            expect(data.templates.map((t) => t.title)).toContain('System Template');
            expect(data.templates.map((t) => t.title)).toContain('User Template');
            expect(data.templates.map((t) => t.title)).not.toContain('Other User Template');
        });

        it('should filter by category when provided', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            await createTemplateFixture({
                title: 'Meeting Template',
                category: 'meeting',
                isSystem: true,
                userId: null,
            });

            await createTemplateFixture({
                title: 'Personal Template',
                category: 'personal',
                isSystem: true,
                userId: null,
            });

            const response = await app.handle(
                new Request('http://localhost/api/templates?category=meeting', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as { templates: Array<{ title: string }> };
            expect(data.templates).toHaveLength(1);
            expect(data.templates[0].title).toBe('Meeting Template');
        });
    });

    describe('GET /api/templates/:id', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/templates/some-id'),
            );
            expect(response.status).toBe(401);
        });

        it('should return 404 for non-existent template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/templates/non-existent-id', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should return template by id', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'Test Template',
                description: 'Test description',
                category: 'work',
                isSystem: true,
                userId: null,
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as { template: { id: string; title: string } };
            expect(data.template.id).toBe(template.id);
            expect(data.template.title).toBe('Test Template');
        });
    });

    describe('POST /api/templates', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'New Template' }),
                }),
            );
            expect(response.status).toBe(401);
        });

        it('should create a custom template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/templates', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: 'My Custom Template',
                        description: 'A custom template',
                        category: 'personal',
                        content: {
                            type: 'doc',
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
                            ],
                        },
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as {
                template: { title: string; isSystem: boolean; userId: string };
            };
            expect(data.template.title).toBe('My Custom Template');
            expect(data.template.isSystem).toBe(false);
            expect(data.template.userId).toBe(user._id.toString());
        });

        it('should require title field', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/templates', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ description: 'No title' }),
                }),
            );

            expect(response.status).toBe(422);
        });
    });

    describe('PATCH /api/templates/:id', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/templates/some-id', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'Updated' }),
                }),
            );
            expect(response.status).toBe(401);
        });

        it('should update own template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'Original Title',
                userId: user._id.toString(),
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ title: 'Updated Title' }),
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as { template: { title: string } };
            expect(data.template.title).toBe('Updated Title');
        });

        it('should not update system template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'System Template',
                isSystem: true,
                userId: null,
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ title: 'Hacked Title' }),
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should not update other user template', async () => {
            const user = await createUserFixture();
            const otherUser = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'Other User Template',
                userId: otherUser._id.toString(),
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ title: 'Stolen Title' }),
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/templates/:id', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/templates/some-id', {
                    method: 'DELETE',
                }),
            );
            expect(response.status).toBe(401);
        });

        it('should delete own template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'To Delete',
                userId: user._id.toString(),
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as { success: boolean };
            expect(data.success).toBe(true);

            // Verify it's actually deleted
            const checkResponse = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );
            expect(checkResponse.status).toBe(404);
        });

        it('should not delete system template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'System Template',
                isSystem: true,
                userId: null,
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('POST /api/templates/:id/apply', () => {
        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/templates/some-id/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notebookId: 'some-notebook' }),
                }),
            );
            expect(response.status).toBe(401);
        });

        it('should create page from template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const notebook = await createNotebookFixture({
                label: 'Test Notebook',
                createdBy: user._id.toString(),
            });

            const template = await createTemplateFixture({
                title: 'Meeting Notes',
                description: 'Template for meeting notes',
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
                            content: [{ type: 'text', text: 'Date: {{date}}' }],
                        },
                    ],
                },
                isSystem: true,
                userId: null,
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}/apply`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        notebookId: notebook._id.toString(),
                        title: 'Team Standup',
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data = (await response.json()) as {
                page: { id: string; title: string; notebookId: string };
            };
            expect(data.page.title).toBe('Team Standup');
            expect(data.page.notebookId).toBe(notebook._id.toString());
            expect(data.page.id).toBeDefined();
        });

        it('should return 404 for non-existent template', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const notebook = await createNotebookFixture({
                label: 'Test Notebook',
                createdBy: user._id.toString(),
            });

            const response = await app.handle(
                new Request('http://localhost/api/templates/non-existent-id/apply', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        notebookId: notebook._id.toString(),
                    }),
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should require notebookId', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const template = await createTemplateFixture({
                title: 'Test Template',
                isSystem: true,
                userId: null,
            });

            const response = await app.handle(
                new Request(`http://localhost/api/templates/${template.id}/apply`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                }),
            );

            expect(response.status).toBe(422);
        });

        it('should increment template usage count', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const notebook = await createNotebookFixture({
                label: 'Test Notebook',
                createdBy: user._id.toString(),
            });

            const template = await createTemplateFixture({
                title: 'Popular Template',
                usageCount: 5,
                isSystem: true,
                userId: null,
            });

            await app.handle(
                new Request(`http://localhost/api/templates/${template.id}/apply`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        notebookId: notebook._id.toString(),
                    }),
                }),
            );

            // Check that usage count incremented
            const updatedTemplate = await testDb!
                .collection('templates')
                .findOne({ id: template.id });
            expect(updatedTemplate?.usageCount).toBe(6);
        });
    });
});
