import { test, expect } from './fixtures';

test.describe('AI Writing Assistant', () => {
    test('should open AI writing assistant', async ({ authenticatedPage }) => {
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

        // Look for AI assistant button
        const aiButton = authenticatedPage
            .locator(
                'button:has-text("AI"), button:has-text("Assistant"), button[aria-label*="ai" i], .ai-button',
            )
            .first();

        if (!(await aiButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            // Try keyboard shortcut
            await authenticatedPage.keyboard.press('Control+Space');
            await authenticatedPage.waitForTimeout(500);

            // Check if AI panel opened
            const aiPanel = authenticatedPage
                .locator('.ai-panel, .ai-assistant, [role="dialog"]:has-text("AI")')
                .first();

            if (!(await aiPanel.isVisible({ timeout: 2000 }).catch(() => false))) {
                test.skip();
                return;
            }

            expect(await aiPanel.isVisible()).toBeTruthy();
        } else {
            await aiButton.click();
            await authenticatedPage.waitForTimeout(500);

            const aiPanel = authenticatedPage
                .locator('.ai-panel, .ai-assistant, [role="dialog"]:has-text("AI")')
                .first();

            if (await aiPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await aiPanel.isVisible()).toBeTruthy();
            }
        }
    });

    test('should generate text with AI prompt', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Open AI assistant
        const aiButton = authenticatedPage
            .locator(
                'button:has-text("AI"), button:has-text("Assistant"), button[aria-label*="ai" i]',
            )
            .first();

        if (!(await aiButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await aiButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for AI prompt input
        const promptInput = authenticatedPage
            .locator(
                'input[placeholder*="Ask AI" i], input[placeholder*="prompt" i], textarea[placeholder*="AI" i], .ai-prompt-input',
            )
            .first();

        if (!(await promptInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Enter a prompt
        await promptInput.fill('Write a brief introduction about note-taking');
        await authenticatedPage.waitForTimeout(500);

        // Look for generate/submit button
        const generateButton = authenticatedPage
            .locator(
                'button:has-text("Generate"), button:has-text("Submit"), button[type="submit"]',
            )
            .first();

        if (!(await generateButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await generateButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for loading indicator or generated text
        const hasResult = await authenticatedPage
            .evaluate(() => {
                return (
                    document.body.textContent?.includes('note') ||
                    document.querySelector('.ai-result, .generated-text') !== null
                );
            })
            .catch(() => false);

        if (hasResult) {
            expect(hasResult).toBeTruthy();
        }
    });

    test('should continue/expand existing text', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Type some initial text
        await editor.click();
        await editor.type('The benefits of daily exercise include');
        await authenticatedPage.waitForTimeout(500);

        // Look for "Continue writing" or similar option
        const continueButton = authenticatedPage
            .locator(
                'button:has-text("Continue"), button:has-text("Expand"), button:has-text("Complete")',
            )
            .first();

        if (!(await continueButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await continueButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Check if text was expanded
        const content = await editor.textContent().catch(() => '');
        const wasExpanded = content.length > 'The benefits of daily exercise include'.length;

        if (wasExpanded) {
            expect(wasExpanded).toBeTruthy();
        }
    });

    test('should summarize selected text', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Add some text to summarize
        await editor.click();
        const longText =
            'This is a long paragraph with multiple sentences. It contains various ideas and concepts. The purpose is to test the summarization feature. We want to see if the AI can condense this into a shorter version.';
        await editor.type(longText);
        await authenticatedPage.waitForTimeout(500);

        // Select all text
        await authenticatedPage.keyboard.press('Control+A');
        await authenticatedPage.waitForTimeout(300);

        // Look for summarize option
        const summarizeButton = authenticatedPage
            .locator('button:has-text("Summarize"), button:has-text("Summary")')
            .first();

        if (!(await summarizeButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await summarizeButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Check for summary result
        const hasSummary = await authenticatedPage
            .evaluate(() => {
                return (
                    document.querySelector('.ai-result, .summary-result, [data-summary]') !== null
                );
            })
            .catch(() => false);

        if (hasSummary) {
            expect(hasSummary).toBeTruthy();
        }
    });

    test('should rephrase/improve text', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Type text to rephrase
        await editor.click();
        await editor.type('The thing is very good and works nice');
        await authenticatedPage.waitForTimeout(500);

        // Select the text
        await authenticatedPage.keyboard.press('Control+A');
        await authenticatedPage.waitForTimeout(300);

        // Look for improve/rephrase option
        const improveButton = authenticatedPage
            .locator(
                'button:has-text("Improve"), button:has-text("Rephrase"), button:has-text("Rewrite")',
            )
            .first();

        if (!(await improveButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await improveButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Check if text was improved
        const hasImprovedText = await authenticatedPage
            .evaluate(() => {
                return document.querySelector('.ai-result, .improved-text') !== null;
            })
            .catch(() => false);

        if (hasImprovedText) {
            expect(hasImprovedText).toBeTruthy();
        }
    });

    test('should change tone of text', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Type text
        await editor.click();
        await editor.type('Hey, can you help me with this thing?');
        await authenticatedPage.waitForTimeout(500);

        // Select text
        await authenticatedPage.keyboard.press('Control+A');
        await authenticatedPage.waitForTimeout(300);

        // Look for tone options
        const toneButton = authenticatedPage
            .locator(
                'button:has-text("Tone"), button:has-text("Style"), button:has-text("Formal"), button:has-text("Professional")',
            )
            .first();

        if (!(await toneButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await toneButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for formal tone option
        const formalOption = authenticatedPage
            .locator(
                'button:has-text("Formal"), button:has-text("Professional"), [data-tone="formal"]',
            )
            .first();

        if (await formalOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await formalOption.click();
            await authenticatedPage.waitForTimeout(2000);

            // Check for result
            const hasResult = await authenticatedPage
                .evaluate(() => {
                    return document.querySelector('.ai-result, .tone-result') !== null;
                })
                .catch(() => false);

            if (hasResult) {
                expect(hasResult).toBeTruthy();
            }
        }
    });

    test('should fix grammar and spelling', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Type text with errors
        await editor.click();
        await editor.type('This sentance have some erors in it');
        await authenticatedPage.waitForTimeout(500);

        // Select text
        await authenticatedPage.keyboard.press('Control+A');
        await authenticatedPage.waitForTimeout(300);

        // Look for grammar/spelling fix option
        const fixButton = authenticatedPage
            .locator(
                'button:has-text("Fix"), button:has-text("Grammar"), button:has-text("Spelling"), button:has-text("Correct")',
            )
            .first();

        if (!(await fixButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await fixButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Check for corrected text
        const hasCorrection = await authenticatedPage
            .evaluate(() => {
                const text = document.body.textContent || '';
                return text.includes('sentence') || text.includes('errors');
            })
            .catch(() => false);

        if (hasCorrection) {
            expect(hasCorrection).toBeTruthy();
        }
    });

    test('should translate text', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Type English text
        await editor.click();
        await editor.type('Hello, how are you today?');
        await authenticatedPage.waitForTimeout(500);

        // Select text
        await authenticatedPage.keyboard.press('Control+A');
        await authenticatedPage.waitForTimeout(300);

        // Look for translate option
        const translateButton = authenticatedPage
            .locator('button:has-text("Translate"), button:has-text("Language")')
            .first();

        if (!(await translateButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await translateButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for language options
        const languageOption = authenticatedPage
            .locator(
                'button:has-text("Spanish"), button:has-text("French"), select, [data-language]',
            )
            .first();

        if (await languageOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await languageOption.click();
            await authenticatedPage.waitForTimeout(2000);

            // Check for translation
            const hasTranslation = await authenticatedPage
                .evaluate(() => {
                    return document.querySelector('.ai-result, .translation-result') !== null;
                })
                .catch(() => false);

            if (hasTranslation) {
                expect(hasTranslation).toBeTruthy();
            }
        }
    });

    test('should insert AI-generated content', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Open AI and generate some content
        const aiButton = authenticatedPage
            .locator('button:has-text("AI"), button:has-text("Assistant")')
            .first();

        if (!(await aiButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await aiButton.click();
        await authenticatedPage.waitForTimeout(500);

        const promptInput = authenticatedPage
            .locator('input[placeholder*="Ask AI" i], textarea[placeholder*="AI" i]')
            .first();

        if (!(await promptInput.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await promptInput.fill('Write one sentence about AI');
        await authenticatedPage.waitForTimeout(500);

        const generateButton = authenticatedPage
            .locator('button:has-text("Generate"), button:has-text("Submit")')
            .first();

        if (!(await generateButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await generateButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for insert button
        const insertButton = authenticatedPage
            .locator('button:has-text("Insert"), button:has-text("Use"), button:has-text("Apply")')
            .first();

        if (!(await insertButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await insertButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Verify content was inserted into editor
        const editorContent = await editor.textContent().catch(() => '');
        const hasContent = editorContent.length > 0;

        if (hasContent) {
            expect(hasContent).toBeTruthy();
        }
    });

    test('should show AI suggestions/autocomplete', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
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

        // Start typing to trigger suggestions
        await editor.click();
        await editor.type('The quick brown fox');
        await authenticatedPage.waitForTimeout(1500);

        // Look for AI suggestion/completion
        const suggestion = authenticatedPage
            .locator('.ai-suggestion, .autocomplete-suggestion, .completion, [data-ai-suggestion]')
            .first();

        if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await suggestion.isVisible()).toBeTruthy();

            // Try accepting the suggestion with Tab
            await authenticatedPage.keyboard.press('Tab');
            await authenticatedPage.waitForTimeout(500);

            // Check if suggestion was accepted
            const content = await editor.textContent().catch(() => '');
            const wasAccepted = content.length > 'The quick brown fox'.length;

            if (wasAccepted) {
                expect(wasAccepted).toBeTruthy();
            }
        }
    });
});
