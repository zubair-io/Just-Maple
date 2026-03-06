import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createNotebookFixture,
    createPageFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import { createJsonDocument } from '../../repositories/json-document.repo';

// Mock realtime service
vi.mock('../../services/realtime-ws.service', () => ({
    realtimeWSService: {
        sendToUsers: vi.fn(),
    },
}));

describe.runIf(mongoAvailable)('JSON Documents Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    async function getAuthToken(userId: string, email: string) {
        const magicLink = await createMagicLinkFixture({ userId, email });
        const response = await app.handle(
            new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
        );
        const data: any = await response.json();
        return data.accessToken;
    }

    describe('PUT /api/json-documents/:id/description', () => {
        it('should update description', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), accessLevel: 'owner' }],
            });
            const page = await createPageFixture({
                userId: user._id.toString(),
                type: 'json',
                notebookId: notebook._id.toString(),
            });
            await createJsonDocument(page.id, page.id, notebook._id.toString(), {});
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/json-documents/${page.id}/description`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ description: 'My book library' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.document.description).toBe('My book library');
        });

        it('should return 404 for nonexistent page', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/json-documents/nonexistent/description`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ description: 'Test' }),
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should reject description over 500 chars', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
                sharedWith: [{ userId: user._id.toString(), accessLevel: 'owner' }],
            });
            const page = await createPageFixture({
                userId: user._id.toString(),
                type: 'json',
                notebookId: notebook._id.toString(),
            });
            await createJsonDocument(page.id, page.id, notebook._id.toString(), {});
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/json-documents/${page.id}/description`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ description: 'x'.repeat(501) }),
                }),
            );

            // Elysia validates body schema
            expect(response.status).toBe(422);
        });

        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request(`http://localhost/api/json-documents/some-id/description`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: 'Test' }),
                }),
            );

            expect(response.status).toBe(401);
        });
    });
});
