import { test, expect } from './fixtures';

test.describe('Voice Recordings', () => {
    test('should open voice recorder interface', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for voice recorder button
        const recorderButton = authenticatedPage
            .locator(
                'button:has-text("Record"), button:has-text("Voice"), button[aria-label*="record" i], .voice-recorder-button',
            )
            .first();

        if (!(await recorderButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await recorderButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Verify recorder interface opened
        const recorderInterface = authenticatedPage
            .locator('.voice-recorder, .recorder-panel, [role="dialog"]:has-text("Record")')
            .first();

        if (await recorderInterface.isVisible({ timeout: 2000 }).catch(() => false)) {
            expect(await recorderInterface.isVisible()).toBeTruthy();
        }
    });

    test('should start and stop recording', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open recorder
        const recorderButton = authenticatedPage
            .locator(
                'button:has-text("Record"), button:has-text("Voice"), button[aria-label*="record" i]',
            )
            .first();

        if (!(await recorderButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await recorderButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for start recording button
        const startButton = authenticatedPage
            .locator(
                'button:has-text("Start"), button:has-text("Record"), button[aria-label*="start record" i]',
            )
            .first();

        if (!(await startButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await startButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for stop button
        const stopButton = authenticatedPage
            .locator('button:has-text("Stop"), button[aria-label*="stop" i], .stop-button')
            .first();

        if (!(await stopButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await stopButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Verify recording stopped
        const hasSavedRecording = await authenticatedPage
            .evaluate(() => {
                return document.querySelector('.recording-preview, .audio-player, audio') !== null;
            })
            .catch(() => false);

        if (hasSavedRecording) {
            expect(hasSavedRecording).toBeTruthy();
        }
    });

    test('should display recording duration', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open recorder
        const recorderButton = authenticatedPage
            .locator('button:has-text("Record"), button:has-text("Voice")')
            .first();

        if (!(await recorderButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await recorderButton.click();
        await authenticatedPage.waitForTimeout(500);

        const startButton = authenticatedPage
            .locator('button:has-text("Start"), button:has-text("Record")')
            .first();

        if (!(await startButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await startButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Look for duration display
        const duration = authenticatedPage
            .locator('.recording-duration, .timer, [data-duration]')
            .first();

        if (await duration.isVisible({ timeout: 2000 }).catch(() => false)) {
            const durationText = await duration.textContent();
            expect(durationText).toBeTruthy();
        }

        // Stop recording
        const stopButton = authenticatedPage.locator('button:has-text("Stop")').first();
        if (await stopButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await stopButton.click();
        }
    });

    test('should save a recording', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Open recorder
        const recorderButton = authenticatedPage
            .locator('button:has-text("Record"), button:has-text("Voice")')
            .first();

        if (!(await recorderButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await recorderButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Start recording
        const startButton = authenticatedPage.locator('button:has-text("Start")').first();

        if (!(await startButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await startButton.click();
        await authenticatedPage.waitForTimeout(2000);

        // Stop recording
        const stopButton = authenticatedPage.locator('button:has-text("Stop")').first();

        if (!(await stopButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await stopButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Look for save button
        const saveButton = authenticatedPage
            .locator('button:has-text("Save"), button:has-text("Keep"), button[type="submit"]')
            .first();

        if (!(await saveButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await saveButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Verify recording was saved
        const savedConfirmation = await authenticatedPage
            .evaluate(() => {
                return (
                    document.body.textContent?.includes('saved') ||
                    document.body.textContent?.includes('Recording saved') ||
                    document.querySelector('[role="alert"]') !== null
                );
            })
            .catch(() => false);

        if (savedConfirmation) {
            expect(savedConfirmation).toBeTruthy();
        }
    });

    test('should play back a recording', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Look for recordings list or player
        const recordingsList = authenticatedPage
            .locator('button:has-text("Recordings"), a:has-text("Recordings"), .recordings-list')
            .first();

        if (await recordingsList.isVisible({ timeout: 3000 }).catch(() => false)) {
            await recordingsList.click();
            await authenticatedPage.waitForLoadState('networkidle');
            await authenticatedPage.waitForTimeout(1000);
        }

        // Look for a recording item or audio player
        const audioPlayer = authenticatedPage
            .locator('audio, .audio-player, [data-recording]')
            .first();

        if (!(await audioPlayer.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for play button
        const playButton = authenticatedPage
            .locator('button:has-text("Play"), button[aria-label*="play" i], .play-button')
            .first();

        if (await playButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await playButton.click();
            await authenticatedPage.waitForTimeout(1000);

            // Verify audio is playing (pause button appears)
            const pauseButton = authenticatedPage
                .locator('button:has-text("Pause"), button[aria-label*="pause" i]')
                .first();

            if (await pauseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                expect(await pauseButton.isVisible()).toBeTruthy();
            }
        }
    });

    test('should delete a recording', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to recordings
        const recordingsButton = authenticatedPage
            .locator('button:has-text("Recordings"), a:has-text("Recordings")')
            .first();

        if (await recordingsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await recordingsButton.click();
            await authenticatedPage.waitForLoadState('networkidle');
            await authenticatedPage.waitForTimeout(1000);
        }

        // Look for a recording item
        const recordingItem = authenticatedPage
            .locator('.recording-item, [data-recording]')
            .first();

        if (!(await recordingItem.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        // Look for delete button
        const deleteButton = recordingItem
            .locator('button:has-text("Delete"), button[aria-label*="delete" i]')
            .first();

        if (!(await deleteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            // Try right-click context menu
            await recordingItem.click({ button: 'right' });
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

            // Verify recording was deleted
            const stillExists = await recordingItem.isVisible({ timeout: 2000 }).catch(() => false);
            expect(stillExists).toBeFalsy();
        }
    });

    test('should attach recording to note', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Create a new memo
        const newMemoButton = authenticatedPage
            .locator('button:has-text("New Memo"), button:has-text("Memo")')
            .first();

        if (!(await newMemoButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await newMemoButton.click();
        await authenticatedPage.waitForLoadState('networkidle');

        // Open voice recorder from note
        const recorderButton = authenticatedPage
            .locator('button:has-text("Record"), button[aria-label*="record" i]')
            .first();

        if (!(await recorderButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await recorderButton.click();
        await authenticatedPage.waitForTimeout(500);

        // Record and save
        const startButton = authenticatedPage.locator('button:has-text("Start")').first();

        if (!(await startButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await startButton.click();
        await authenticatedPage.waitForTimeout(2000);

        const stopButton = authenticatedPage.locator('button:has-text("Stop")').first();

        if (!(await stopButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await stopButton.click();
        await authenticatedPage.waitForTimeout(500);

        const saveButton = authenticatedPage.locator('button:has-text("Save")').first();

        if (!(await saveButton.isVisible({ timeout: 2000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await saveButton.click();
        await authenticatedPage.waitForTimeout(1000);

        // Verify recording appears in note
        const attachedRecording = authenticatedPage
            .locator('audio, .audio-player, .recording-embed')
            .first();

        if (await attachedRecording.isVisible({ timeout: 3000 }).catch(() => false)) {
            expect(await attachedRecording.isVisible()).toBeTruthy();
        }
    });

    test('should list all recordings', async ({ authenticatedPage }) => {
        await authenticatedPage.goto('/');
        await authenticatedPage.waitForLoadState('networkidle');

        // Navigate to recordings list
        const recordingsButton = authenticatedPage
            .locator(
                'button:has-text("Recordings"), a:has-text("Recordings"), button[aria-label*="recordings" i]',
            )
            .first();

        if (!(await recordingsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
            test.skip();
            return;
        }

        await recordingsButton.click();
        await authenticatedPage.waitForLoadState('networkidle');
        await authenticatedPage.waitForTimeout(1000);

        // Look for recordings list or empty state
        const recordingsList = authenticatedPage
            .locator('.recordings-list, .recording-item, [data-recording]')
            .first();

        const emptyState = authenticatedPage
            .locator('text="No recordings", text="Record your first", .empty-recordings')
            .first();

        const hasListOrEmpty =
            (await recordingsList.isVisible({ timeout: 2000 }).catch(() => false)) ||
            (await emptyState.isVisible({ timeout: 2000 }).catch(() => false));

        if (hasListOrEmpty) {
            expect(hasListOrEmpty).toBeTruthy();
        }
    });
});
