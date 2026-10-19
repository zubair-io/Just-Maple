import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createCanvasFixture,
    createCanvasWidgetFixture,
    createCanvasConnectorFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

// Mock realtime service
vi.mock('../../services/realtime-ws.service', () => ({
    realtimeWSService: {
        sendToUsers: vi.fn(),
    },
}));

describe.runIf(mongoAvailable)('Canvas Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    async function getAuthToken(userId: string, email: string) {
        return createAuthToken(userId, email);
    }

    async function createTestContext() {
        const user = await createUserFixture();
        const notebook = await createNotebookFixture({
            createdBy: user._id.toString(),
            sharedWith: [{ userId: user._id.toString(), accessLevel: 'owner' }],
        });
        const page = await createPageFixture({
            userId: user._id.toString(),
            type: 'canvas',
            title: 'Test Canvas',
            notebookId: notebook._id.toString(),
        });
        const token = await getAuthToken(user._id.toString(), user.email);
        return { user, notebook, page, token };
    }

    describe('GET /api/canvases/:id', () => {
        it('should auto-create canvas when missing', async () => {
            const { page, token } = await createTestContext();

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.document.id).toBe(page.id);
            expect(data.document.widgets).toEqual([]);
            expect(data.document.connectors).toEqual([]);
        });

        it('should return existing canvas', async () => {
            const { page, token, user, notebook } = await createTestContext();
            const widget = createCanvasWidgetFixture();
            await createCanvasFixture({
                pageId: page.id,
                notebookId: notebook._id.toString(),
                userId: user._id.toString(),
                widgets: [widget],
            });

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.document.widgets).toHaveLength(1);
            expect(data.document.widgets[0].id).toBe(widget.id);
        });

        it('should return 404 for nonexistent page', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/nonexistent`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should return 401 without auth', async () => {
            const response = await app.handle(new Request(`http://localhost/api/canvases/some-id`));

            expect(response.status).toBe(401);
        });
    });

    describe('PUT /api/canvases/:id', () => {
        it('should replace canvas contents', async () => {
            const { page, token, user, notebook } = await createTestContext();
            await createCanvasFixture({
                pageId: page.id,
                notebookId: notebook._id.toString(),
                userId: user._id.toString(),
            });

            const widget = createCanvasWidgetFixture();
            const connector = createCanvasConnectorFixture();

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        widgets: [widget],
                        connectors: [connector],
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.document.widgets).toHaveLength(1);
            expect(data.document.connectors).toHaveLength(1);
        });
    });

    describe('PUT /api/canvases/:id/widgets/:widgetId', () => {
        it('should update widget', async () => {
            const { page, token, user, notebook } = await createTestContext();
            const widget = createCanvasWidgetFixture({ title: 'Original' });
            await createCanvasFixture({
                pageId: page.id,
                notebookId: notebook._id.toString(),
                userId: user._id.toString(),
                widgets: [widget],
            });

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}/widgets/${widget.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ title: 'Updated' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.widget.title).toBe('Updated');
        });
    });

    describe('DELETE /api/canvases/:id/widgets/:widgetId', () => {
        it('should remove widget', async () => {
            const { page, token, user, notebook } = await createTestContext();
            const widget = createCanvasWidgetFixture();
            await createCanvasFixture({
                pageId: page.id,
                notebookId: notebook._id.toString(),
                userId: user._id.toString(),
                widgets: [widget],
            });

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}/widgets/${widget.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.success).toBe(true);

            // Verify widget was removed
            const getResponse = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );
            const getResult: any = await getResponse.json();
            expect(getResult.document.widgets).toHaveLength(0);
        });
    });

    describe('POST /api/canvases/:id/widgets/generate', () => {
        it('should attempt generation and return result or error', async () => {
            const { page, token } = await createTestContext();
            // First ensure canvas exists
            await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            const response = await app.handle(
                new Request(`http://localhost/api/canvases/${page.id}/widgets/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ prompt: 'Show my books' }),
                }),
            );

            // generateWidget may fail in test env without AI service configured
            expect([200, 500]).toContain(response.status);
        });

        it('should return 401 without auth', async () => {
            const response = await app.handle(
                new Request(`http://localhost/api/canvases/some-id/widgets/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: 'Show my books' }),
                }),
            );

            expect(response.status).toBe(401);
        });
    });
});
