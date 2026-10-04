/** Synthetic CompositionEvent acceptance only; does not certify an OS input method or native WKWebView. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output = '.build/editor-composition-smoke';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(syntheticBridge);
await context.addInitScript(() => {
  const handler = window.webkit.messageHandlers.maple, original = handler.postMessage.bind(handler);
  const fixture = window.__compositionFixture = { submissions: [], arrivals: false, proposalCalls: 0, replyCalls: 0 };
  handler.postMessage = async body => {
    if (body.action === 'mapleSubmit') fixture.submissions.push(body.text);
    if (body.action === 'mapleResponseProposal') fixture.replyCalls++;
    if (body.action === 'documentAutomaticProposal') {
      fixture.proposalCalls++;
      const store = JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1'));
      return { documentID: body.documentID, revision: store.revision, removals: [], groups: fixture.arrivals ? [{ headingID: 'composition-fyi', title: 'Synthetic composition arrivals', createHeading: true, blocks: [{ blockID: 'composition-source', markdown: '<!-- maple:block {"v":1,"id":"composition-source"} -->\n```maple-ref\n{"v":1,"kind":"message","eventID":"synthetic-message","label":"Synthetic composition message"}\n```\n' }] }] : [] };
    }
    return original(body);
  };
});
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
const state = () => page.evaluate(() => window.__compositionFixture);
const persisted = () => page.evaluate(() => JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')));
const begin = async paragraph => paragraph.evaluate(el => {
  const surface = el.closest('[contenteditable=true]'); surface.focus();
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
});
const endWith = async (paragraph, suffix) => paragraph.evaluate((el, suffix) => {
  const surface = el.closest('[contenteditable=true]'), text = el.firstChild;
  text.textContent += suffix;
  window.getSelection().collapse(text, text.textContent.length);
  surface.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: suffix, isComposing: true }));
  surface.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: suffix }));
}, suffix);
try {
  await page.goto((process.env.MAPLE_SMOKE_URL || 'http://127.0.0.1:4323') + '/#/today');
  await expect(editor).toBeVisible();
  await editor.evaluate(el => window.__compositionEditor = el);
  const request = editor.locator('.maple-request p').first();
  await begin(request);
  await editor.locator('.maple-run-button:not([hidden])').evaluate(button => button.click());
  await editor.evaluate(el => {
    for (const key of ['metaKey', 'ctrlKey']) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', [key]: true, bubbles: true, cancelable: true, isComposing: true }));
  });
  const before = (await state()).proposalCalls;
  await expect.poll(async () => (await state()).proposalCalls).toBeGreaterThan(before);
  assert.deepEqual((await state()).submissions, []);
  await endWith(request, ' 東京');
  await expect.poll(async () => (await persisted()).content).toContain('Dominick. 東京');
  await editor.locator('.maple-run-button:not([hidden])').click();
  await expect.poll(async () => (await state()).submissions.length).toBe(1);
  assert.equal((await state()).submissions[0], 'Find all my emails from Dominick. 東京');
  results.push('Synthetic composition blocks Ask Maple click and Meta/Control+Enter; explicit post-composition click submits final text once.');
  const writing = editor.locator('.maple-paragraph p').filter({ hasText: 'Synthetic review:' }).first();
  await begin(writing);
  await page.evaluate(() => window.__compositionFixture.arrivals = true);
  const proposals = (await state()).proposalCalls;
  await expect.poll(async () => (await state()).proposalCalls).toBeGreaterThan(proposals);
  await expect.poll(async () => (await state()).replyCalls).toBeGreaterThan(0);
  await expect(editor).not.toContainText('Synthetic composition arrivals');
  await expect(editor).not.toContainText('Synthetic Maple reply');
  await endWith(writing, ' 京都の予定');
  await expect(editor).toContainText('Synthetic composition arrivals', { timeout: 10000 });
  await expect(editor).toContainText('Synthetic Maple reply', { timeout: 10000 });
  assert.equal(await editor.evaluate(el => el === window.__compositionEditor), true);
  const selection = await page.evaluate(() => ({ text: window.getSelection().anchorNode?.textContent, offset: window.getSelection().anchorOffset }));
  assert.match(selection.text, /京都の予定$/);
  assert.equal(selection.offset, selection.text.length);
  await expect.poll(async () => (await persisted()).run?.appliedRevision).toBeTruthy();
  await expect.poll(async () => (await persisted()).content).toContain('京都の予定');
  const repeat = (await state()).proposalCalls;
  await expect.poll(async () => (await state()).proposalCalls).toBeGreaterThan(repeat);
  assert.equal(await editor.locator('.maple-reply').count(), 1);
  results.push('Source and reply polling defer during composition, replay exactly once afterward, preserve editor/caret/final text and save durable reply acknowledgement.');
  await page.screenshot({ path: output + '/synthetic-composition.png', fullPage: true });
  await page.reload();
  await expect(editor).toContainText('京都の予定');
  await expect(editor).toContainText('Synthetic Maple reply');
  assert.equal(await editor.locator('.maple-reply').count(), 1);
  results.push('Saved composed text and inline reply survive reload.');
  assert.deepEqual(errors, []);
  await fs.writeFile(output + '/results.json', JSON.stringify({ fixture: 'Synthetic bridge + synthetic DOM composition events. No OS IME or WKWebView claim.', results, errors }, null, 2));
  console.log(JSON.stringify({ status: 'pass', results, output }, null, 2));
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
