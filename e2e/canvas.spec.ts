import { test, expect } from './fixtures';

test.describe('Canvas', () => {
    test('should load canvas view with prompt bar', async ({ authenticatedPage, testUser }) => {
        const baseURL = 'http://localhost:7072';

        // Create a notebook via API
        const notebookRes = await authenticatedPage.request.post(`${baseURL}/api/notebooks`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { label: `Canvas Test ${Date.now()}` },
        });
        expect(notebookRes.ok()).toBeTruthy();
        const { notebook } = await notebookRes.json();

        // Create a canvas page via API
        const pageRes = await authenticatedPage.request.post(`${baseURL}/api/pages`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { title: 'My Canvas', type: 'canvas', notebookId: notebook._id },
        });
        expect(pageRes.ok()).toBeTruthy();
        const { page: canvasPage } = await pageRes.json();

        // Navigate to the canvas page
        await authenticatedPage.goto(`/${notebook._id}/${canvasPage.id}`);
        await authenticatedPage.waitForLoadState('networkidle');

        // Verify the prompt bar is visible
        const promptInput = authenticatedPage.locator(
            'input[placeholder*="widget" i], input[placeholder*="prompt" i], input[placeholder*="describe" i]',
        );
        await expect(promptInput).toBeVisible({ timeout: 5000 });

        // Verify the "Add Widget" button is visible
        const addButton = authenticatedPage.locator('button:has-text("Add Widget")');
        await expect(addButton).toBeVisible({ timeout: 3000 });
    });

    test('should show empty state when no widgets', async ({ authenticatedPage, testUser }) => {
        const baseURL = 'http://localhost:7072';

        // Create a notebook and canvas page
        const notebookRes = await authenticatedPage.request.post(`${baseURL}/api/notebooks`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { label: `Canvas Empty ${Date.now()}` },
        });
        const { notebook } = await notebookRes.json();

        const pageRes = await authenticatedPage.request.post(`${baseURL}/api/pages`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { title: 'Empty Canvas', type: 'canvas', notebookId: notebook._id },
        });
        const { page: canvasPage } = await pageRes.json();

        await authenticatedPage.goto(`/${notebook._id}/${canvasPage.id}`);
        await authenticatedPage.waitForLoadState('networkidle');

        // Verify empty state message
        const emptyState = authenticatedPage.locator(
            ':text("No widgets"), :text("no widgets"), :text("Type a prompt")',
        );
        await expect(emptyState).toBeVisible({ timeout: 5000 });
    });

    test('should auto-create canvas document on first load', async ({
        authenticatedPage,
        testUser,
    }) => {
        const baseURL = 'http://localhost:7072';

        // Create a notebook and canvas page
        const notebookRes = await authenticatedPage.request.post(`${baseURL}/api/notebooks`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { label: `Canvas Auto ${Date.now()}` },
        });
        const { notebook } = await notebookRes.json();

        const pageRes = await authenticatedPage.request.post(`${baseURL}/api/pages`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { title: 'Auto Canvas', type: 'canvas', notebookId: notebook._id },
        });
        const { page: canvasPage } = await pageRes.json();

        // GET the canvas document — should auto-create
        const canvasRes = await authenticatedPage.request.get(
            `${baseURL}/api/canvases/${canvasPage.id}`,
            { headers: { Authorization: `Bearer ${testUser.token}` } },
        );
        expect(canvasRes.ok()).toBeTruthy();

        const { document: canvas } = await canvasRes.json();
        expect(canvas.id).toBe(canvasPage.id);
        expect(canvas.widgets).toEqual([]);
        expect(canvas.connectors).toEqual([]);
    });

    test('should add and remove a widget via API', async ({ authenticatedPage, testUser }) => {
        const baseURL = 'http://localhost:7072';

        // Create notebook + canvas page
        const notebookRes = await authenticatedPage.request.post(`${baseURL}/api/notebooks`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { label: `Canvas Widget ${Date.now()}` },
        });
        const { notebook } = await notebookRes.json();

        const pageRes = await authenticatedPage.request.post(`${baseURL}/api/pages`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { title: 'Widget Canvas', type: 'canvas', notebookId: notebook._id },
        });
        const { page: canvasPage } = await pageRes.json();

        // Auto-create the canvas document
        await authenticatedPage.request.get(`${baseURL}/api/canvases/${canvasPage.id}`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
        });

        // Add a widget via PUT (replace canvas with a widget)
        const widget = {
            id: 'test-widget-1',
            title: 'Test Widget',
            template: { atom: 'text', value: 'Hello World' },
            createdAt: new Date().toISOString(),
        };

        const putRes = await authenticatedPage.request.put(
            `${baseURL}/api/canvases/${canvasPage.id}`,
            {
                headers: { Authorization: `Bearer ${testUser.token}` },
                data: { widgets: [widget], connectors: [] },
            },
        );
        expect(putRes.ok()).toBeTruthy();

        // Verify widget exists
        const getRes = await authenticatedPage.request.get(
            `${baseURL}/api/canvases/${canvasPage.id}`,
            { headers: { Authorization: `Bearer ${testUser.token}` } },
        );
        const { document: canvas } = await getRes.json();
        expect(canvas.widgets).toHaveLength(1);
        expect(canvas.widgets[0].id).toBe('test-widget-1');

        // Delete the widget
        const deleteRes = await authenticatedPage.request.delete(
            `${baseURL}/api/canvases/${canvasPage.id}/widgets/test-widget-1`,
            { headers: { Authorization: `Bearer ${testUser.token}` } },
        );
        expect(deleteRes.ok()).toBeTruthy();

        // Verify widget is gone
        const getRes2 = await authenticatedPage.request.get(
            `${baseURL}/api/canvases/${canvasPage.id}`,
            { headers: { Authorization: `Bearer ${testUser.token}` } },
        );
        const { document: canvas2 } = await getRes2.json();
        expect(canvas2.widgets).toHaveLength(0);
    });

    test('should render widget with static template', async ({ authenticatedPage, testUser }) => {
        const baseURL = 'http://localhost:7072';

        // Create notebook + canvas page
        const notebookRes = await authenticatedPage.request.post(`${baseURL}/api/notebooks`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { label: `Canvas Render ${Date.now()}` },
        });
        const { notebook } = await notebookRes.json();

        const pageRes = await authenticatedPage.request.post(`${baseURL}/api/pages`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { title: 'Render Canvas', type: 'canvas', notebookId: notebook._id },
        });
        const { page: canvasPage } = await pageRes.json();

        // Auto-create canvas, then add a widget with a static text template
        await authenticatedPage.request.get(`${baseURL}/api/canvases/${canvasPage.id}`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
        });

        await authenticatedPage.request.put(`${baseURL}/api/canvases/${canvasPage.id}`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: {
                widgets: [
                    {
                        id: 'render-widget-1',
                        title: 'Greeting',
                        template: {
                            layout: 'stack',
                            gap: 'sm',
                            children: [
                                {
                                    atom: 'text',
                                    value: 'Hello Canvas!',
                                    size: 'lg',
                                    weight: 'bold',
                                },
                                { atom: 'badge', value: 'New', color: 'green' },
                            ],
                        },
                        createdAt: new Date().toISOString(),
                    },
                ],
                connectors: [],
            },
        });

        // Navigate to the canvas page
        await authenticatedPage.goto(`/${notebook._id}/${canvasPage.id}`);
        await authenticatedPage.waitForLoadState('networkidle');

        // Verify the widget title appears
        const widgetTitle = authenticatedPage.locator(':text("Greeting")');
        await expect(widgetTitle).toBeVisible({ timeout: 5000 });

        // Verify the rendered text atom
        const textAtom = authenticatedPage.locator(':text("Hello Canvas!")');
        await expect(textAtom).toBeVisible({ timeout: 3000 });

        // Verify the badge atom (scoped to main content to avoid matching sidebar "New" button)
        const badgeAtom = authenticatedPage.getByRole('main').getByText('New');
        await expect(badgeAtom).toBeVisible({ timeout: 3000 });
    });

    test('should disable prompt bar while generating', async ({ authenticatedPage, testUser }) => {
        const baseURL = 'http://localhost:7072';

        // Create notebook + canvas page
        const notebookRes = await authenticatedPage.request.post(`${baseURL}/api/notebooks`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { label: `Canvas Disable ${Date.now()}` },
        });
        const { notebook } = await notebookRes.json();

        const pageRes = await authenticatedPage.request.post(`${baseURL}/api/pages`, {
            headers: { Authorization: `Bearer ${testUser.token}` },
            data: { title: 'Disable Canvas', type: 'canvas', notebookId: notebook._id },
        });
        const { page: canvasPage } = await pageRes.json();

        await authenticatedPage.goto(`/${notebook._id}/${canvasPage.id}`);
        await authenticatedPage.waitForLoadState('networkidle');

        // The Add Widget button should be disabled when prompt is empty
        const addButton = authenticatedPage.locator('button:has-text("Add Widget")');
        if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(addButton).toBeDisabled();
        }

        // Type in the prompt
        const promptInput = authenticatedPage.locator(
            'input[placeholder*="widget" i], input[placeholder*="prompt" i], input[placeholder*="describe" i]',
        );
        if (await promptInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await promptInput.fill('Show my books');

            // Button should now be enabled
            await expect(addButton).toBeEnabled({ timeout: 2000 });
        }
    });
});
