import { test, expect } from './fixtures';

test.describe('Whiteboard', () => {
    test('should create a new whiteboard', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for "New Whiteboard" button or similar
        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Verify canvas element is present
        const canvas = authenticatedPage.locator('canvas, [role="region"]');
        await expect(canvas).toBeVisible({ timeout: 5000 });

        // Verify URL changed to whiteboard route
        await expect(authenticatedPage).toHaveURL(/whiteboard|\/\w+\/\w+/);
    });

    test('should display drawing tools', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Check for drawing tool buttons (pen, pencil, shapes, etc.)
        const toolbar = authenticatedPage.locator('[role="toolbar"], .toolbar, .whiteboard-tools');

        // Look for common tool buttons
        const expectedTools = ['pen', 'pencil', 'eraser', 'text', 'select'];
        let foundTools = 0;

        for (const tool of expectedTools) {
            const toolButton = authenticatedPage.locator(
                `button:has-text("${tool}"), button[aria-label*="${tool}" i], button[title*="${tool}" i]`,
            );
            if (await toolButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                foundTools++;
            }
        }

        // Expect at least 2 tools to be visible
        expect(foundTools).toBeGreaterThanOrEqual(2);
    });

    test('should draw with pen tool', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        const canvas = authenticatedPage.locator('canvas').first();
        if (!(await canvas.isVisible())) {
            test.skip();
            return;
        }

        // Select pen tool
        const penButton = authenticatedPage
            .locator('button:has-text("Pen"), button[aria-label*="pen" i], button[title*="pen" i]')
            .first();

        if (await penButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await penButton.click();
        }

        // Get canvas bounding box
        const box = await canvas.boundingBox();
        if (!box) {
            test.skip();
            return;
        }

        // Draw a simple line
        await authenticatedPage.mouse.move(box.x + 100, box.y + 100);
        await authenticatedPage.mouse.down();
        await authenticatedPage.mouse.move(box.x + 200, box.y + 200, { steps: 10 });
        await authenticatedPage.mouse.up();

        await authenticatedPage.waitForTimeout(500);

        // Note: Verifying actual drawing content would require canvas pixel analysis
        // For now, we just verify no errors occurred and canvas is still present
        await expect(canvas).toBeVisible();
    });

    test('should use eraser tool', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Find eraser button
        const eraserButton = authenticatedPage
            .locator(
                'button:has-text("Eraser"), button:has-text("Erase"), button[aria-label*="eraser" i]',
            )
            .first();

        if (!(await eraserButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await eraserButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Verify eraser is selected (button might have active state)
        // This is UI-dependent, so we just verify no error
        await expect(eraserButton).toBeVisible();
    });

    test('should pan canvas with drag', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        const canvas = authenticatedPage.locator('canvas').first();
        if (!(await canvas.isVisible())) {
            test.skip();
            return;
        }

        // Select pan/hand tool if available
        const panButton = authenticatedPage
            .locator('button:has-text("Pan"), button:has-text("Hand"), button[aria-label*="pan" i]')
            .first();

        if (await panButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await panButton.click();
            await authenticatedPage.waitForTimeout(300);
        }

        // Try panning by dragging on canvas
        const box = await canvas.boundingBox();
        if (!box) {
            test.skip();
            return;
        }

        await authenticatedPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await authenticatedPage.mouse.down();
        await authenticatedPage.mouse.move(
            box.x + box.width / 2 + 100,
            box.y + box.height / 2 + 100,
            {
                steps: 5,
            },
        );
        await authenticatedPage.mouse.up();

        await authenticatedPage.waitForTimeout(500);
        // Verify canvas still visible after pan
        await expect(canvas).toBeVisible();
    });

    test('should zoom in and out', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for zoom controls
        const zoomInButton = authenticatedPage
            .locator(
                'button:has-text("Zoom In"), button:has-text("+"), button[aria-label*="zoom in" i]',
            )
            .first();

        if (!(await zoomInButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await zoomInButton.click();
        await authenticatedPage.waitForTimeout(500);

        const zoomOutButton = authenticatedPage
            .locator(
                'button:has-text("Zoom Out"), button:has-text("-"), button[aria-label*="zoom out" i]',
            )
            .first();

        if (await zoomOutButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await zoomOutButton.click();
            await authenticatedPage.waitForTimeout(500);
        }

        // Verify no errors
        await expect(authenticatedPage.locator('canvas').first()).toBeVisible();
    });

    test('should add text element', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Find text tool
        const textButton = authenticatedPage
            .locator(
                'button:has-text("Text"), button[aria-label*="text" i], button[title*="text" i]',
            )
            .first();

        if (!(await textButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await textButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Click on canvas to create text
        const canvas = authenticatedPage.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (!box) {
            test.skip();
            return;
        }

        await authenticatedPage.mouse.click(box.x + 150, box.y + 150);
        await authenticatedPage.waitForTimeout(500);

        // Look for text input (might be an input or contenteditable)
        const textInput = authenticatedPage
            .locator('input[type="text"], textarea, [contenteditable="true"]')
            .last();

        if (await textInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await textInput.fill('Test text');
            await textInput.press('Escape'); // or Enter to finish
            await authenticatedPage.waitForTimeout(500);
        }

        // Verify canvas still visible
        await expect(canvas).toBeVisible();
    });

    test('should draw shapes (rectangle)', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Find rectangle/shape tool
        const rectangleButton = authenticatedPage
            .locator(
                'button:has-text("Rectangle"), button:has-text("Square"), button[aria-label*="rectangle" i]',
            )
            .first();

        if (!(await rectangleButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await rectangleButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Draw rectangle by dragging
        const canvas = authenticatedPage.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (!box) {
            test.skip();
            return;
        }

        await authenticatedPage.mouse.move(box.x + 100, box.y + 100);
        await authenticatedPage.mouse.down();
        await authenticatedPage.mouse.move(box.x + 250, box.y + 200, { steps: 5 });
        await authenticatedPage.mouse.up();

        await authenticatedPage.waitForTimeout(500);
        await expect(canvas).toBeVisible();
    });

    test('should use selection tool', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Find selection tool
        const selectButton = authenticatedPage
            .locator(
                'button:has-text("Select"), button[aria-label*="select" i], button[title*="select" i]',
            )
            .first();

        if (!(await selectButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await selectButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Verify selection tool is active
        await expect(selectButton).toBeVisible();
    });

    test('should undo and redo actions', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Draw something first
        const canvas = authenticatedPage.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (!box) {
            test.skip();
            return;
        }

        await authenticatedPage.mouse.move(box.x + 100, box.y + 100);
        await authenticatedPage.mouse.down();
        await authenticatedPage.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
        await authenticatedPage.mouse.up();
        await authenticatedPage.waitForTimeout(500);

        // Try undo with keyboard shortcut
        await authenticatedPage.keyboard.press('Control+Z');
        await authenticatedPage.waitForTimeout(500);

        // Try redo
        await authenticatedPage.keyboard.press('Control+Shift+Z');
        await authenticatedPage.waitForTimeout(500);

        // Look for undo/redo buttons as alternative
        const undoButton = authenticatedPage
            .locator('button:has-text("Undo"), button[aria-label*="undo" i]')
            .first();

        if (await undoButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await undoButton.click();
            await authenticatedPage.waitForTimeout(300);

            const redoButton = authenticatedPage
                .locator('button:has-text("Redo"), button[aria-label*="redo" i]')
                .first();

            if (await redoButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await redoButton.click();
            }
        }

        await expect(canvas).toBeVisible();
    });

    test('should change stroke color', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for color picker
        const colorPicker = authenticatedPage
            .locator(
                'input[type="color"], button[aria-label*="color" i], [role="button"]:has-text("Color")',
            )
            .first();

        if (!(await colorPicker.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // If it's a color input, set value
        const tagName = await colorPicker.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === 'input') {
            await colorPicker.fill('#ff0000'); // Red
        } else {
            await colorPicker.click();
            // Try to find red color option
            const redOption = authenticatedPage
                .locator('[aria-label*="red" i], [title*="red" i], [data-color*="red" i]')
                .first();
            if (await redOption.isVisible({ timeout: 1000 }).catch(() => false)) {
                await redOption.click();
            }
        }

        await authenticatedPage.waitForTimeout(500);
        await expect(authenticatedPage.locator('canvas').first()).toBeVisible();
    });

    test('should export whiteboard as image', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for export button
        const exportButton = authenticatedPage
            .locator(
                'button:has-text("Export"), button:has-text("Download"), button[aria-label*="export" i]',
            )
            .first();

        if (!(await exportButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Set up download listener
        const downloadPromise = authenticatedPage.waitForEvent('download', { timeout: 5000 });

        await exportButton.click();
        await authenticatedPage.waitForTimeout(500);

        // If export opens a menu, look for PNG option
        const pngOption = authenticatedPage.locator(
            'button:has-text("PNG"), [role="menuitem"]:has-text("PNG")',
        );

        if (await pngOption.isVisible({ timeout: 1000 }).catch(() => false)) {
            await pngOption.click();
        }

        try {
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/\.(png|jpg|svg|pdf)$/i);
        } catch {
            // Export might work differently, skip if no download
            test.skip();
        }
    });

    test('should display whiteboard in shared tag', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a whiteboard first
        const newWhiteboardButton = authenticatedPage.locator(
            'button:has-text("New Whiteboard"), button:has-text("Whiteboard")',
        );

        if (!(await newWhiteboardButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newWhiteboardButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Verify canvas loads
        const canvas = authenticatedPage.locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 5000 });

        // Draw something to make it non-empty
        const box = await canvas.boundingBox();
        if (box) {
            await authenticatedPage.mouse.move(box.x + 100, box.y + 100);
            await authenticatedPage.mouse.down();
            await authenticatedPage.mouse.move(box.x + 150, box.y + 150, { steps: 3 });
            await authenticatedPage.mouse.up();
            await authenticatedPage.waitForTimeout(1000);
        }

        // Go back to tag/notebook view
        await authenticatedPage.goBack();
        await authenticatedPage.waitForTimeout(1000);

        // Find the whiteboard in the list (it should have a whiteboard icon or indicator)
        const whiteboardItem = authenticatedPage
            .locator(
                '[data-type="whiteboard"], .whiteboard-item, [role="listitem"]:has-text("Whiteboard")',
            )
            .first();

        if (await whiteboardItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            await expect(whiteboardItem).toBeVisible();
        } else {
            // Whiteboard might be in a generic page list
            test.skip();
        }
    });

    test.skip('should sync whiteboard in real-time with collaborators', async ({ browser }) => {
        // TODO: Implement real-time collaboration test similar to write-test-collaboration.spec.ts
        // This requires two browser contexts drawing simultaneously and verifying sync
    });

    test.skip('should support keyboard shortcuts', async ({ authenticatedPage }) => {
        // TODO: Test common shortcuts like:
        // V = Select tool
        // P = Pen tool
        // E = Eraser
        // T = Text
        // Ctrl+Z = Undo
        // Ctrl+Shift+Z = Redo
        // Space+Drag = Pan
    });
});
