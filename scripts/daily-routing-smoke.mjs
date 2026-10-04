/** Real editor routing regression; all native data is explicitly synthetic. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import { syntheticBridge } from './today-synthetic-bridge.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ timezoneId: 'America/New_York' });
  function datedBridge() {
    const bridge = window.webkit.messageHandlers.maple;
    const fallback = bridge.postMessage.bind(bridge);
    const documents = {};
    window.syntheticDailyCalls = [];
    bridge.postMessage = async body => {
      window.syntheticDailyCalls.push(body);
      if (body.action === 'todayOpen') {
        const id = 'synthetic-' + body.day;
        if (!documents[id]) {
          const template = await fallback(body);
          documents[id] = { ...template, documentID: id, day: body.day,
            path: body.day.slice(0, 4) + '/' + body.day.slice(5, 7) + '/' + body.day + '.md',
            content: `---\nmaple:\n  format: 1\n  document: "${id}"\n  day: "${body.day}"\n---\n\n<!-- maple:block {"v":1,"id":"synthetic-prose"} -->\nSynthetic dated writing ${body.day}.\n` };
        }
        return documents[id];
      }
      if (body.action === 'documentCommit') {
        const doc = documents[body.documentID];
        if (doc.revision !== body.expectedRevision) throw Error('Synthetic revision conflict');
        doc.content = body.content;
        doc.revision = 'r' + (Number(doc.revision.slice(1)) + 1);
        return { ...doc, state: 'committed', commandID: body.commandID };
      }
      if (body.action === 'documentAutoRefresh') return { document: documents[body.documentID] };
      if (body.action === 'documentOpen') return documents[body.documentID];
      return fallback(body);
    };
  }
  await context.addInitScript({ content: `(${syntheticBridge.toString()})();(${datedBridge.toString()})();` });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-09-27T23:59:50-04:00') });
  await page.clock.pauseAt(new Date('2026-09-27T23:59:59-04:00'));
  await page.goto(process.env.MAPLE_TEST_URL || 'http://127.0.0.1:4320/');
  const editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
  await page.clock.runFor(100);
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/daily\/2026-09-27$/);
  await expect(page.locator('.day-rail [aria-current="page"]')).toHaveText('Today');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Keep writing across midnight.');
  await editor.evaluate(node => {
    window.syntheticEditor = node;
    const selection = window.getSelection();
    window.syntheticSelection = { node: selection.anchorNode, offset: selection.anchorOffset };
  });
  await page.clock.runFor(1000);
  await expect(page.locator('.day-rail [aria-current="page"]')).toHaveText('Yesterday');
  await expect(page.locator('.date-chip')).toHaveText('Yesterday');
  await expect(page).toHaveURL(/\/daily\/2026-09-27$/);
  await expect(editor).toContainText('Keep writing across midnight.');
  assert.equal(await editor.evaluate(node => node === window.syntheticEditor &&
    window.getSelection().anchorNode === window.syntheticSelection.node &&
    window.getSelection().anchorOffset === window.syntheticSelection.offset), true);
  assert.equal(await page.evaluate(() => window.syntheticDailyCalls.filter(c => c.action === 'todayOpen').length), 1);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.clock.runFor(100);
  await expect(page).toHaveURL(/\/daily\/2026-09-28$/);
  await expect(editor).toContainText('Synthetic dated writing 2026-09-28.');
  await page.getByRole('link', { name: 'Tomorrow', exact: true }).click();
  await page.clock.runFor(100);
  await expect(page).toHaveURL(/\/daily\/2026-09-29$/);
  await expect(editor).toContainText('Synthetic dated writing 2026-09-29.');
  await page.getByRole('link', { name: 'Yesterday', exact: true }).click();
  await page.clock.runFor(100);
  await expect(page).toHaveURL(/\/daily\/2026-09-27$/);
  await expect(editor).toContainText('Keep writing across midnight.');
  assert.deepEqual(errors, []);
  console.log('PASS: synthetic real-editor midnight preserves URL, editor, selection and writing; relative links resolve new dates; writing survives return.');
} finally {
  await browser.close();
}
