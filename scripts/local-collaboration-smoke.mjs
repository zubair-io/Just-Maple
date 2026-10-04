/** Synthetic browser acceptance only: no real inbox, provider, iCloud, or native app data. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output = '.build/local-collaboration-smoke';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/New_York' });
await context.addInitScript(syntheticBridge);
await context.addInitScript(() => {
  const handler = window.webkit.messageHandlers.maple;
  const original = handler.postMessage.bind(handler);
  const fixture = window.__collaborationFixture = { queue: [], proposalCalls: 0, holdCommit: false, heldCommit: false, release: null };
  const store = () => JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1'));
  handler.postMessage = async body => {
    if (body.action === 'documentAutomaticProposal') {
      fixture.proposalCalls++;
      return { documentID: body.documentID, revision: store().revision, groups: fixture.queue.length ? [{ headingID: 'synthetic-fyi', title: 'Synthetic incoming context', createHeading: true, blocks: fixture.queue }] : [], removals: [] };
    }
    if (body.action === 'documentCommit' && fixture.holdCommit) {
      fixture.heldCommit = true;
      await new Promise(resolve => fixture.release = resolve);
      fixture.holdCommit = false;
      fixture.heldCommit = false;
    }
    if (body.action === 'sourceDetail' && body.eventID.startsWith('collaboration-')) {
      const kind = body.eventID.split('-')[1];
      return { row: { id: body.eventID, type: kind, connector: kind === 'calendar' ? 'apple_calendar' : kind === 'home' ? 'home_assistant' : kind === 'message' ? 'messages' : 'gmail', sender: 'Synthetic collaborator', subject: 'Synthetic ' + kind + ' arrival', preview: 'Explicitly synthetic evidence for live editor acceptance.', status: 'complete', occurredAt: Date.now() / 1000, ...(kind === 'calendar' ? { calendar: { name: 'Synthetic calendar', start: Date.now() / 1000, end: Date.now() / 1000 + 1800, allDay: false, timeZone: 'America/New_York', location: 'Synthetic room' } } : {}) }, content: 'Synthetic evidence only.' };
    }
    return original(body);
  };
});
const page = await context.newPage();
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
const persisted = () => page.evaluate(() => JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')));
const addArrival = kind => page.evaluate(kind => {
  const blockID = 'collaboration-' + kind;
  const referenceKind = ['email', 'message', 'home', 'calendar', 'recording'].includes(kind) ? kind : 'email';
  const markdown = '<!-- maple:block ' + JSON.stringify({ v: 1, id: blockID }) + ' -->\n```maple-ref\n' + JSON.stringify({ v: 1, kind: referenceKind, eventID: blockID, label: 'Synthetic ' + kind + ' arrival' }) + '\n```\n';
  window.__collaborationFixture.queue.push({ blockID, markdown });
}, kind);
const placeInWriting = () => editor.locator('.maple-paragraph').filter({ hasText: 'Synthetic review:' }).first().evaluate(el => {
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); el.closest('[contenteditable]').focus();
});
const caret = () => page.evaluate(() => {
  const s = window.getSelection();
  return { text: s.anchorNode?.textContent, offset: s.anchorOffset, focusText: s.focusNode?.textContent, focusOffset: s.focusOffset, collapsed: s.isCollapsed };
});
const sameEditor = () => editor.evaluate(el => el === window.__originalEditor);
const toggleMarkdown = async label => {
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
};
try {
  await page.goto((process.env.MAPLE_SMOKE_URL || 'http://127.0.0.1:4321') + '/#/today');
  await expect(editor).toBeVisible();
  await editor.evaluate(el => window.__originalEditor = el);
  await placeInWriting();
  await page.keyboard.type(' Synthetic keyboard typing before arrivals.');
  for (const kind of ['email', 'message', 'home', 'calendar']) {
    await addArrival(kind);
    // Continue native keyboard editing while the 2-second proposal poll runs.
    await page.keyboard.type(' User keeps typing through ' + kind + ' arrival.', { delay: 70 });
    await expect(editor).toContainText('Synthetic ' + kind + ' arrival', { timeout: 10000 });
    assert.ok(await sameEditor(), kind + ' must preserve the mounted editor');
    assert.equal((await caret()).collapsed, true);
    assert.match((await caret()).text, /Synthetic review:/);
  }
  await expect.poll(async () => (await persisted()).content).toContain('User keeps typing through calendar arrival.');
  results.push('Keyboard typing continued during email, iMessage, Home Assistant, and same-day calendar arrivals; editor identity and caret retained.');

  // Retried proposals are delivered unchanged while the same IDs are already live.
  const calls = await page.evaluate(() => window.__collaborationFixture.proposalCalls);
  await expect.poll(() => page.evaluate(() => window.__collaborationFixture.proposalCalls), { timeout: 6000 }).toBeGreaterThan(calls);
  assert.equal(await editor.locator('.source-card').count(), 5);
  const beforeSelection = await caret();
  for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowLeft');
  const selected = await caret();
  await addArrival('selected');
  await expect(editor).toContainText('Synthetic selected arrival', { timeout: 10000 });
  assert.deepEqual(await caret(), selected, 'Insertion must preserve a non-collapsed selection');
  const retryCalls = await page.evaluate(() => window.__collaborationFixture.proposalCalls);
  await expect.poll(() => page.evaluate(() => window.__collaborationFixture.proposalCalls), { timeout: 6000 }).toBeGreaterThan(retryCalls);
  assert.deepEqual(await caret(), selected, 'Retries must preserve a non-collapsed selection');
  await page.keyboard.press('ArrowRight');
  assert.equal((await caret()).offset, beforeSelection.offset);
  results.push('Repeated delivery produced no duplicate blocks; a new insertion and retries preserved text selection.');

  await page.waitForTimeout(600);
  await page.keyboard.type(' Synthetic undo segment.');
  await page.keyboard.press('Meta+z');
  await expect(editor).not.toContainText('Synthetic undo segment.');
  assert.equal(await editor.locator('.source-card').count(), 6);
  results.push('User undo removed only user typing and preserved Maple insertions.');

  // A native commit may acknowledge an older snapshot while Maple adds to the live one.
  await page.evaluate(() => window.__collaborationFixture.holdCommit = true);
  await page.keyboard.type(' Synthetic in-flight commit typing.');
  await expect.poll(() => page.evaluate(() => window.__collaborationFixture.heldCommit)).toBe(true);
  await addArrival('recording');
  await page.keyboard.type(' More typing while save is pending.');
  await expect(editor).toContainText('Synthetic recording arrival', { timeout: 10000 });
  assert.ok(await sameEditor());
  await page.evaluate(() => window.__collaborationFixture.release());
  await expect.poll(async () => (await persisted()).content).toContain('More typing while save is pending.');
  await expect.poll(async () => (await persisted()).content).toContain('collaboration-recording');
  results.push('Arrival during an in-flight commit merged with newer typing and persisted in the next revision.');

  await toggleMarkdown('View Markdown');
  const raw = page.getByRole('textbox', { name: 'Daily note editor Markdown source', exact: true });
  await expect(raw).toBeVisible();
  await addArrival('raw-deferred');
  const beforeRaw = await raw.inputValue();
  const rawCalls = await page.evaluate(() => window.__collaborationFixture.proposalCalls);
  await expect.poll(() => page.evaluate(() => window.__collaborationFixture.proposalCalls), { timeout: 6000 }).toBeGreaterThan(rawCalls);
  assert.equal(await raw.inputValue(), beforeRaw);
  await toggleMarkdown('Formatted view');
  await expect(editor).toContainText('Synthetic raw arrival', { timeout: 10000 });
  results.push('Raw Markdown deferred automatic insertion until formatted view resumed.');

  await editor.locator('.maple-paragraph').filter({ hasText: '@maple Find all my emails from Dominick.' }).getByRole('button', { name: 'Ask Maple ↵', exact: true }).click();
  await placeInWriting();
  await page.keyboard.type(' Synthetic typing while Maple answers.', { delay: 90 });
  await expect(editor).toContainText('Synthetic Maple reply with captured evidence.', { timeout: 10000 });
  await expect.poll(async () => (await persisted()).run?.status).toBe('succeeded');
  assert.ok((await persisted()).run.appliedRevision);
  await expect.poll(async () => (await persisted()).content).toContain('Synthetic typing while Maple answers.');
  results.push('@maple reply inserted during keyboard typing and was acknowledged only after the merged document commit.');

  await page.reload();
  await expect(editor).toContainText('Synthetic typing while Maple answers.');
  await expect(editor).toContainText('Synthetic Maple reply with captured evidence.');
  assert.equal(await editor.locator('.source-card').count(), 8);
  results.push('Reload retained user prose, all eight source references, and the inline reply.');
  await page.screenshot({ path: output + '/collaboration-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: output + '/collaboration-dark.png', fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(output + '/results.json', JSON.stringify({ fixture: 'Synthetic only; no real messages or live provider quality assertions.', passed: results, errors }, null, 2));
  await fs.rm(output + '/failure.json', { force: true });
  await fs.rm(output + '/failure.png', { force: true });
  console.log(results.join('\n'));
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  await fs.writeFile(output + '/failure.json', JSON.stringify({ error: String(error), passed: results, errors }, null, 2));
  throw error;
} finally {
  await context.close(); await browser.close();
}
