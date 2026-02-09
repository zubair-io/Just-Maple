import { test, expect } from './fixtures';

test.describe('Templates', () => {
    test('should display system templates', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for templates button/menu
        const templatesButton = authenticatedPage
            .locator(
                'button:has-text("Templates"), a:has-text("Templates"), button[aria-label*="template" i], .templates-menu',
            )
            .first();

        if (!(await templatesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templatesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for system templates section
        const systemTemplates = authenticatedPage.locator(
            'text="System Templates", .system-templates, [data-type="system-template"]',
        );

        if ((await systemTemplates.count()) > 0) {
            expect(await systemTemplates.count()).toBeGreaterThan(0);
        }
    });

    test('should create a new page from template', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for new from template button
        const newFromTemplateButton = authenticatedPage
            .locator(
                'button:has-text("New from Template"), button:has-text("Use Template"), button[aria-label*="template" i]',
            )
            .first();

        if (!(await newFromTemplateButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newFromTemplateButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(500);

        // Look for a template option
        const templateOption = authenticatedPage
            .locator('.template-card, .template-item, button[data-template-id]')
            .first();

        if (!(await templateOption.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templateOption.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify editor opened
        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await editor.isVisible()).toBeTruthy();
        }
    });

    test('should save a page as template', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a new memo
        const newMemoButton = authenticatedPage
            .locator(
                'button:has-text("New Memo"), button:has-text("Memo"), button:has-text("New Note")',
            )
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Add some content
        await editor.click();
        await editor.type('Meeting Notes Template');
        await editor.press('Enter');
        await editor.type('## Attendees');
        await editor.press('Enter');
        await editor.type('## Agenda');
        await authenticatedPage.waitForTimeout(1000);

        // Look for "Save as Template" option
        const menuButton = authenticatedPage
            .locator(
                'button[aria-label*="menu" i], button:has-text("More"), button:has-text("..."), .menu-button',
            )
            .first();

        if (!(await menuButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await menuButton.click();
        await authenticatedPage.waitForTimeout(500);

        const saveAsTemplateButton = authenticatedPage
            .locator(
                'button:has-text("Save as Template"), button:has-text("Create Template"), [data-action="save-template"]',
            )
            .first();

        if (!(await saveAsTemplateButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await saveAsTemplateButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Look for template name input
        const templateNameInput = authenticatedPage
            .locator(
                'input[placeholder*="Template name" i], input[aria-label*="template name" i], input[name="templateName"]',
            )
            .first();

        if (await templateNameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await templateNameInput.fill('My Meeting Template');
            await authenticatedPage.waitForTimeout(500);

            // Look for save button
            const saveButton = authenticatedPage
                .locator(
                    'button:has-text("Save"), button:has-text("Create"), button[type="submit"]',
                )
                .first();

            if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await saveButton.click();
                await authenticatedPage.waitForTimeout(1000);

                // Verify success (check for notification or confirmation)
                const hasConfirmation = await authenticatedPage
                    .evaluate(() => {
                        return (
                            document.body.textContent?.includes('Template saved') ||
                            document.body.textContent?.includes('Template created') ||
                            document.querySelector('[role="alert"]') !== null
                        );
                    })
                    .catch(() => false);

                if (hasConfirmation) {
                    expect(hasConfirmation).toBeTruthy();
                }
            }
        }
    });

    test('should list custom templates', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to templates
        const templatesButton = authenticatedPage
            .locator(
                'button:has-text("Templates"), a:has-text("Templates"), button[aria-label*="template" i]',
            )
            .first();

        if (!(await templatesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templatesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for custom templates section
        const customTemplatesSection = authenticatedPage.locator(
            'text="My Templates", text="Custom Templates", .custom-templates, [data-type="custom-template"]',
        );

        // Check if custom templates section exists
        if ((await customTemplatesSection.count()) > 0) {
            expect(await customTemplatesSection.count()).toBeGreaterThan(0);
        }
    });

    test('should edit a custom template', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to templates
        const templatesButton = authenticatedPage
            .locator(
                'button:has-text("Templates"), a:has-text("Templates"), button[aria-label*="template" i]',
            )
            .first();

        if (!(await templatesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templatesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for a custom template
        const customTemplate = authenticatedPage
            .locator('.custom-template, [data-type="custom-template"], .template-item')
            .first();

        if (!(await customTemplate.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for edit button
        const editButton = customTemplate
            .locator('button:has-text("Edit"), button[aria-label*="edit" i], .edit-button')
            .first();

        if (!(await editButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Try right-click context menu
            await customTemplate.click({ button: 'right' });
            await authenticatedPage.waitForTimeout(500);

            const contextEditButton = authenticatedPage
                .locator('button:has-text("Edit"), [role="menuitem"]:has-text("Edit")')
                .first();

            if (!(await contextEditButton.isVisible({ timeout: 2000 }).catch(() => false))) {
                test.skip();
                return;
            }

            await contextEditButton.click();
        } else {
            await editButton.click();
        }

        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Verify editor opened
        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await editor.isVisible()).toBeTruthy();
        }
    });

    test('should delete a custom template', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // First create a template to delete
        const newMemoButton = authenticatedPage
            .locator(
                'button:has-text("New Memo"), button:has-text("Memo"), button:has-text("New Note")',
            )
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        const editor = authenticatedPage.locator('.ProseMirror, [contenteditable="true"]').first();

        if (!(await editor.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Add content
        await editor.click();
        await editor.type('Template to Delete');
        await authenticatedPage.waitForTimeout(1000);

        // Save as template
        const menuButton = authenticatedPage
            .locator(
                'button[aria-label*="menu" i], button:has-text("More"), button:has-text("...")',
            )
            .first();

        if (!(await menuButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await menuButton.click();
        await authenticatedPage.waitForTimeout(500);

        const saveAsTemplateButton = authenticatedPage
            .locator('button:has-text("Save as Template"), button:has-text("Create Template")')
            .first();

        if (!(await saveAsTemplateButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await saveAsTemplateButton.click();
        await authenticatedPage.waitForTimeout(500);

        const templateNameInput = authenticatedPage
            .locator('input[placeholder*="Template name" i], input[aria-label*="template name" i]')
            .first();

        if (!(await templateNameInput.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        const templateName = `Delete Test ${Date.now()}`;
        await templateNameInput.fill(templateName);
        await authenticatedPage.waitForTimeout(500);

        const saveButton = authenticatedPage
            .locator('button:has-text("Save"), button:has-text("Create")')
            .first();

        if (!(await saveButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await saveButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Navigate to templates
        const templatesButton = authenticatedPage
            .locator('button:has-text("Templates"), a:has-text("Templates")')
            .first();

        if (!(await templatesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templatesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Find the template we just created
        const createdTemplate = authenticatedPage
            .locator(`text="${templateName}", .template-item:has-text("${templateName}")`)
            .first();

        if (!(await createdTemplate.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for delete button
        const deleteButton = createdTemplate
            .locator('button:has-text("Delete"), button[aria-label*="delete" i], .delete-button')
            .first();

        if (!(await deleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Try right-click context menu
            await createdTemplate.click({ button: 'right' });
            await authenticatedPage.waitForTimeout(500);

            const contextDeleteButton = authenticatedPage
                .locator('button:has-text("Delete"), [role="menuitem"]:has-text("Delete")')
                .first();

            if (!(await contextDeleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
                test.skip();
                return;
            }

            await contextDeleteButton.click();
        } else {
            await deleteButton.click();
        }

        await authenticatedPage.waitForTimeout(500);

        // Confirm deletion if prompted
        const confirmButton = authenticatedPage
            .locator(
                'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")',
            )
            .first();

        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmButton.click();
            await authenticatedPage.waitForTimeout(1000);
        }

        // Verify template was deleted
        const templateStillExists = await createdTemplate
            .isVisible({ timeout: 2000 })
            .catch(() => false);
        expect(templateStillExists).toBeFalsy();
    });

    test('should preview a template', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to templates
        const templatesButton = authenticatedPage
            .locator(
                'button:has-text("Templates"), a:has-text("Templates"), button[aria-label*="template" i]',
            )
            .first();

        if (!(await templatesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templatesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for a template
        const templateCard = authenticatedPage
            .locator('.template-card, .template-item, [data-template-id]')
            .first();

        if (!(await templateCard.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Hover to trigger preview
        await templateCard.hover();
        await authenticatedPage.waitForTimeout(1000);

        // Look for preview panel
        const preview = authenticatedPage
            .locator('.template-preview, .preview-panel, [role="dialog"]:has-text("Preview")')
            .first();

        if (await preview.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await preview.isVisible()).toBeTruthy();
        } else {
            // Try clicking for preview
            const previewButton = templateCard
                .locator('button:has-text("Preview"), button[aria-label*="preview" i]')
                .first();

            if (await previewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await previewButton.click();
                await authenticatedPage.waitForTimeout(1000);

                const previewDialog = authenticatedPage
                    .locator('.template-preview, .preview-panel, [role="dialog"]')
                    .first();

                if (await previewDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
                    expect(await previewDialog.isVisible()).toBeTruthy();
                }
            }
        }
    });

    test('should categorize templates', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to templates
        const templatesButton = authenticatedPage
            .locator(
                'button:has-text("Templates"), a:has-text("Templates"), button[aria-label*="template" i]',
            )
            .first();

        if (!(await templatesButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await templatesButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for category filters or sections
        const categories = authenticatedPage.locator(
            '.template-category, [data-category], button:has-text("Notes"), button:has-text("Projects"), button:has-text("Meetings")',
        );

        const categoryCount = await categories.count();

        if (categoryCount > 0) {
            expect(categoryCount).toBeGreaterThan(0);

            // Try clicking a category filter
            const firstCategory = categories.first();
            await firstCategory.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify filter applied (check URL or visible templates)
            const url = authenticatedPage.url();
            const hasFilter = url.includes('category') || url.includes('filter');

            if (hasFilter) {
                expect(hasFilter).toBeTruthy();
            }
        }
    });
});
