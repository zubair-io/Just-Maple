/** Synthetic-only keyboard acceptance. No live app, data, provider or iCloud access. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const output = '.build/source-inspector-keyboard-smoke';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await context.addInitScript(syntheticBridge);
const page = await context.newPage(), errors = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.MAPLE_SMOKE_URL || 'http://127.0.0.1:4322';
const dialog = page.getByRole('dialog', { name: 'Source details', exact: true });
async function drawerRoundtrip(opener, label) {
  // Tiptap applies focus after insertion in its next animation frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await opener.focus();
  await expect(opener).toBeFocused();
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(dialog).toContainText('Synthetic captured original');
  // Native modal traps both forward and reverse traversal; source data loading is inert.
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press(i < 12 ? 'Tab' : 'Shift+Tab');
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'Focus must stay in explicit inspector');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY })), scroll);
  passed.push(label);
}
try {
  await page.goto(base + '/#/today');
  const editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
  await expect(editor).toBeVisible();
  await editor.locator('p').filter({ hasText: 'Synthetic review:' }).first().evaluate(element => {
    const text = element.firstChild, range = document.createRange(); range.setStart(text, 10); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); element.closest('[contenteditable]').focus();
  });
  await page.keyboard.type('BEFORE');
  const opener = editor.getByRole('button', { name: 'Open Synthetic proposal — source and processing history', exact: true });
  await drawerRoundtrip(opener, 'Today source drawer traps focus, Escape restores card and scroll.');
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await page.keyboard.type('AFTER');
  await expect(editor).toContainText('BEFOREAFTER');
  passed.push('Escape from source card resumes typing at the exact prior editor caret.');
  await page.getByRole('button', { name: 'Insert a block', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Source reference', exact: true }).focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Add source reference', exact: true });
  await expect(picker.getByRole('searchbox')).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert(await picker.evaluate(el => el.contains(document.activeElement)));
  }
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(editor).toBeFocused();
  passed.push('Keyboard source command focuses the searchable modal picker; Escape restores writing.');


  await page.getByRole('button', { name: 'Insert a block', exact: true }).click();
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Document tools', exact: true });
  await expect(tools.getByRole('button', { name: 'Close document tools', exact: true })).toBeFocused();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press(i < 16 ? 'Tab' : 'Shift+Tab');
    assert(await tools.evaluate(el => el.contains(document.activeElement)));
  }
  await tools.getByRole('button', { name: 'View Markdown', exact: true }).click();
  const markdown = page.getByRole('textbox', { name: 'Daily note editor Markdown source', exact: true });
  await expect(markdown).toBeFocused();
  await page.getByRole('button', { name: 'Document tools', exact: true }).click();
  await tools.getByRole('button', { name: 'Formatted view', exact: true }).click();
  await expect(editor).toBeFocused();
  passed.push('Document tools trap keyboard focus and return to the current Markdown or formatted writing surface.');

  await page.goto(base + '/#/sources');
  const row = page.getByRole('button', { name: /Synthetic proposal Synthetic Dominick/ });
  await expect(row).toBeVisible();
  const count = await page.locator('tbody tr').count();
  await drawerRoundtrip(row, 'Sources row opens same modal and regains keyboard focus when closing routed inspector.');
  assert.equal(await page.locator('tbody tr').count(), count);

  await page.goto(base + '/#/notebooks');
  await page.getByRole('button', { name: /Synthetic notebook.*Open notebook/ }).click();
  await page.getByRole('button', { name: '+ New note', exact: true }).click();
  const naming = page.getByRole('dialog', { name: 'Name your notebook or note', exact: true });
  await expect(naming.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await naming.getByRole('textbox').fill('Unsaved synthetic name');
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
    assert(await naming.evaluate(el => el.contains(document.activeElement)));
  }
  await page.screenshot({ path: output + '/naming-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: output + '/naming-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.keyboard.press('Escape');
  await expect(naming).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ New note', exact: true })).toBeFocused();
  passed.push('Notebook naming is modal, traps Tab in both directions, and Escape returns to its opener without creating a notebook.');
  await page.getByRole('button', { name: /Synthetic notebook note/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note editor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Document tools', exact: true }).first().click();
  await page.getByRole('button', { name: 'Enable source blocks & inline Maple', exact: true }).click();
  const notebook = page.getByRole('textbox', { name: 'Note editor', exact: true });
  await page.getByRole('button', { name: 'Insert a block', exact: true }).click();
  await page.getByRole('button', { name: 'Source reference', exact: true }).click();
  await expect(page.locator('.notebook-source-picker').getByRole('searchbox')).toBeFocused();
  await page.locator('.notebook-source-picker').getByRole('button', { name: /Synthetic proposal/ }).click();
  const notebookOpener = notebook.getByRole('button', { name: 'Open Synthetic proposal — source and processing history', exact: true });
  await drawerRoundtrip(notebookOpener, 'Managed notebooks use the same source modal and restore its opener.');
  await page.keyboard.press('Escape'); await expect(notebook).toBeFocused();

  await notebookOpener.focus(); await page.keyboard.press('Enter');
  await page.screenshot({ path: output + '/drawer-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: output + '/drawer-dark.png' });
  await page.setViewportSize({ width: 500, height: 850 });
  const bounds = await dialog.boundingBox(); assert(bounds && bounds.width <= 501 && bounds.x >= -1);
  await page.screenshot({ path: output + '/drawer-narrow.png' });
  assert.deepEqual(errors, []);
  await fs.writeFile(output + '/results.json', JSON.stringify({ dataset: 'synthetic-only', passed, errors }, null, 2));
  console.log(passed.join('\n'));
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true });
  await fs.writeFile(output + '/results.json', JSON.stringify({ dataset: 'synthetic-only', passed, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
