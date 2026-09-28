/** Real Angular editor acceptance with visibly synthetic source evidence.
 * No native user files, production sources, or live providers are accessed.
 * Run npm start --prefix src/web -- --port 4320, then node this file.
 */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';

const output = '.build/writing-source-journey';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: 'America/New_York' });
function seedJourney() {
  if (localStorage.getItem('maple.writing-journey.seeded')) return;
  const key = 'maple.today.sources.smoke.v1';
  const day = new Intl.DateTimeFormat('en-CA').format(new Date());
  const store = { revision: 'r1', calls: [], run: null };
  const frontmatter = '---\nmaple:\n  format: 1\n  document: "synthetic-document"\n  day: "' + day + '"\n---\n\n';
  const marker = id => '<!-- maple:block ' + JSON.stringify({ v: 1, id }) + ' -->\n';
  store.content = frontmatter + marker('synthetic-opening') + '# Synthetic morning review\n\n' + marker('synthetic-intro') + 'Synthetic writing and evidence acceptance. No live sources or provider calls.\n';
  localStorage.setItem(key, JSON.stringify(store));
  localStorage.setItem('maple.writing-journey.seeded', 'true');
}
function nativeSourceTypes() {
  const handler = window.webkit.messageHandlers.maple;
  const original = handler.postMessage;
  const row = value => ({ ...value, type: value.connector === 'home_assistant' ? 'home.observed' : 'message.received', ...(value.connector === 'home_assistant' ? { observedState: 'open', sender: 'Synthetic front door' } : {}) });
  handler.postMessage = async body => {
    const result = await original(body);
    if (body.action === 'sourceList') return { ...result, items: result.items.map(row) };
    if (body.action === 'sourceDetail') return { ...result, row: row(result.row) };
    return result;
  };
}
await context.addInitScript({ content: '(' + seedJourney.toString() + ')();(' + syntheticBridge.toString() + ')();(' + nativeSourceTypes.toString() + ')();' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')));
const sourceSpecs = [
  ['Synthetic proposal', 'synthetic-email', 'email', 'email'],
  ['Synthetic message', 'synthetic-message', 'imessage', 'message'],
  ['Synthetic door: closed → open', 'synthetic-home', 'ha', 'home'],
];
const end = async editor => editor.evaluate(el => {
  el.focus();
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
});
const persist = async text => expect.poll(async () => (await store()).content).toContain(text);
const insertSource = async (editor, label, notebook = false) => {
  await end(editor);
  await page.getByRole('button', { name: 'Insert a block', exact: true }).click();
  await page.getByRole('button', { name: 'Source reference', exact: true }).click();
  const picker = page.locator(notebook ? '.notebook-source-picker' : '.source-picker');
  await picker.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await expect(editor.getByRole('button', { name: label, exact: true })).toBeVisible();
};
const assertSourceReferences = markdown => {
  const references = [...markdown.matchAll(/```maple-ref\n(.*?)\n```/gs)].map(match => JSON.parse(match[1]));
  for (const [, id, , kind] of sourceSpecs) {
    const reference = references.find(value => value.eventID === id);
    assert(reference, 'Captured evidence ID must survive: ' + id);
    assert.equal(reference.kind, kind, 'Source kind should use native connector and event type');
  }
};
const uniqueIDs = markdown => {
  const ids = [...markdown.matchAll(/<!-- maple:block (.*?) -->/g)].map(match => JSON.parse(match[1]).id);
  assert.equal(ids.length, new Set(ids).size, 'Each persisted top-level block must have a unique identity');
  return ids;
};
try {
  await page.goto((process.env.MAPLE_SMOKE_URL || 'http://127.0.0.1:4320') + '/#/today');
  let editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
  await expect(editor).toBeVisible();
  const dock = page.getByRole('toolbar', { name: 'Note formatting', exact: true });
  await expect(dock).toBeVisible();
  await end(editor); await editor.press('Enter');
  await editor.pressSequentially('## Synthetic follow ups'); await editor.press('Enter');
  await expect(editor.getByRole('heading', { name: 'Synthetic follow ups', exact: true })).toBeVisible();
  await editor.pressSequentially('Draft a clear response with **synthetic emphasis**.');
  await expect(editor.locator('strong')).toHaveText('synthetic emphasis');
  await editor.press('Enter'); await editor.pressSequentially('[ ] Review synthetic evidence');
  const task = editor.getByRole('listitem').filter({ hasText: 'Review synthetic evidence' });
  await expect(task).toBeVisible();
  await task.getByRole('checkbox').check();
  await expect(task.getByRole('checkbox')).toBeChecked();
  await end(editor); await editor.press('Enter'); await editor.press('Enter');
  await editor.pressSequentially('/heading 2');
  await expect(page.getByRole('option', { name: 'Heading 2', exact: true })).toBeVisible();
  await editor.press('Enter'); await editor.pressSequentially('Synthetic source material'); await editor.press('Enter');
  await editor.pressSequentially('The following cards retain their captured evidence.');
  for (const [label, id] of sourceSpecs) {
    await insertSource(editor, label);
    await persist(id);
  }
  // The source cards are local document references; the original captured source and
  // provider response remain inspectable through the same source inspector.
  for (const [label] of sourceSpecs) {
    const card = editor.locator('.source-card').filter({ has: page.getByRole('button', { name: label, exact: true }) });
    await card.getByRole('button', { name: 'State & history ↗', exact: true }).click();
    const details = page.getByRole('region', { name: 'Source details', exact: true });
    await expect(details).toContainText('Synthetic captured original');
    await details.getByRole('button', { name: 'Responses', exact: true }).click();
    await details.getByRole('button', { name: /classification · response/ }).click();
    await expect(details.locator('pre')).toContainText('"synthetic": true');
    await details.getByRole('button', { name: 'History', exact: true }).click();
    await expect(details).toContainText('running → succeeded');
    await details.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await end(editor); await editor.press('Enter'); await editor.pressSequentially('Synthetic undo checkpoint');
  await persist('Synthetic undo checkpoint');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor).not.toContainText('Synthetic undo checkpoint');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(editor).toContainText('Synthetic undo checkpoint');
  await persist('Synthetic undo checkpoint');
  const beforeReload = (await store()).content;
  const ids = uniqueIDs(beforeReload);
  assertSourceReferences(beforeReload);
  await page.reload(); await expect(editor).toContainText('Synthetic undo checkpoint');
  for (const [label] of sourceSpecs) await expect(editor.getByRole('button', { name: label, exact: true })).toBeVisible();
  await expect(editor.locator('strong')).toHaveText('synthetic emphasis');
  await expect(editor.getByRole('checkbox')).toBeChecked();
  assert.deepEqual(uniqueIDs((await store()).content), ids, 'Reopening must preserve block identities');

  // Heading dots collapse sections without changing authored Markdown or source IDs.
  const station = page.getByRole('button', { name: 'Collapse section: Synthetic source material', exact: true });
  await expect(station).toBeVisible();
  const beforeFold = (await store()).content;
  await station.click();
  const expandedStation = page.getByRole('button', { name: 'Expand section: Synthetic source material', exact: true });
  await expect(expandedStation).toHaveAttribute('aria-expanded', 'false');
  for (const [label] of sourceSpecs) await expect(editor.getByRole('button', { name: label, exact: true })).toBeHidden();
  assert.equal((await store()).content, beforeFold, 'Folding must not rewrite the document');
  await expandedStation.focus(); await expandedStation.press('Enter');
  await expect(station).toHaveAttribute('aria-expanded', 'true');
  for (const [label] of sourceSpecs) await expect(editor.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insert a block', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapsible section', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Insert a block', exact: true }).click();
  await editor.locator('p').first().click();
  await page.mouse.move(15, 15);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.screenshot({ path: output + '/today-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: output + '/today-dark.png', fullPage: true });
  await page.setViewportSize({ width: 620, height: 900 });
  await expect(dock).toBeVisible();
  const bounds = await dock.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 621 && bounds.y + bounds.height <= 901, 'Dock must fit narrow screens');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Document must not overflow narrow screens');
  await page.screenshot({ path: output + '/today-narrow.png', fullPage: true });

  // An ordinary notebook uses the identical shared editing surface and toolbar.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'All notebooks', exact: true }).click();
  await page.locator('.memo-cover').first().click();
  await page.locator('.note-list button').first().click();
  editor = page.locator('.note-paper .tiptap');
  await expect(editor).toBeVisible();
  await expect(page.locator('.note-paper maple-editor')).toHaveCount(1);
  await expect(dock).toBeVisible();
  await end(editor); await editor.press('Enter');
  await editor.pressSequentially('## Synthetic notebook sources'); await editor.press('Enter');
  await editor.pressSequentially('Shared editor writing stays in this notebook.');
  await editor.press('Enter');
  await editor.evaluate(el => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '**Synthetic pasted emphasis**\n\n- First synthetic pasted item\n- Second synthetic pasted item');
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor.locator('strong')).toHaveText('Synthetic pasted emphasis');
  await expect(editor.getByRole('listitem')).toHaveCount(2);
  assert.notEqual(await editor.locator('ul').evaluate(el => getComputedStyle(el).listStyleType), 'none', 'Pasted bullet list must retain visible markers');
  await expect.poll(async () => (await store()).generic.content).toContain('Synthetic pasted emphasis');
  assert(!(await store()).generic.content.includes('maple:block'), 'Plain notebook writing must stay ordinary Markdown before explicit source enablement');
  await page.locator('.note-tools-toggle').click();
  await page.getByRole('button', { name: 'Enable source blocks & inline Maple', exact: true }).click();
  await expect.poll(async () => (await store()).generic.managed).toBe(true);
  const noteTools = page.locator('.note-document-tools');
  if (await noteTools.isVisible()) await noteTools.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toContainText('Synthetic pasted emphasis');
  for (const [label] of sourceSpecs) await insertSource(editor, label, true);
  await expect.poll(async () => (await store()).generic.content).toContain('synthetic-home');
  const notebookBefore = (await store()).generic.content;
  uniqueIDs(notebookBefore);
  assertSourceReferences(notebookBefore);
  await page.getByRole('button', { name: 'Collapse section: Synthetic notebook sources', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Synthetic message', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Expand section: Synthetic notebook sources', exact: true }).click();
  await page.screenshot({ path: output + '/notebook-light.png', fullPage: true });
  await page.reload();
  await page.locator('.memo-cover').first().click();
  await page.locator('.note-list button').first().click();
  await expect(editor).toContainText('Shared editor writing stays in this notebook.');
  for (const [label, id] of sourceSpecs) {
    await expect(editor.getByRole('button', { name: label, exact: true })).toBeVisible();
    assert((await store()).generic.content.includes(id));
  }
  assert.equal((await store()).generic.content, notebookBefore, 'Notebook reopen preserves source references and authored Markdown');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: output + '/notebook-dark.png', fullPage: true });
  // Near-limit synthetic writing with frequent headings also exercises outline decorations.
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  const largeBytes = await page.evaluate(() => {
    const key = 'maple.today.sources.smoke.v1', value = JSON.parse(localStorage.getItem(key));
    let content = '---\nmaple:\n  format: 1\n  document: "synthetic-document"\n---\n\n';
    let index = 0;
    while (content.length < 248000) {
      content += '<!-- maple:block ' + JSON.stringify({ v: 1, id: 'synthetic-large-' + index }) + ' -->\n';
      content += index % 10 === 0 ? '## Synthetic section ' + index + '\n\n' : 'Synthetic performance paragraph keeps local writing responsive while preserving stable identity and readable Markdown.\n\n';
      index++;
    }
    value.content = content; value.revision = 'r10000'; value.run = null;
    localStorage.setItem(key, JSON.stringify(value));
    return new TextEncoder().encode(content).length;
  });
  await page.reload();
  editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
  await expect(editor).toBeVisible();
  await end(editor); await editor.press('ArrowRight');
  await page.evaluate(() => {
    window.__writingLatency = [];
    document.querySelector('.tiptap').addEventListener('beforeinput', () => {
      const start = performance.now();
      requestAnimationFrame(() => window.__writingLatency.push(performance.now() - start));
    });
  });
  await editor.pressSequentially('Synthetic large-note typing measurement.', { delay: 60 });
  const samples = await page.evaluate(() => window.__writingLatency);
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)];
  assert(samples.length > 20, 'Writing latency measurement should collect real input samples');
  await fs.writeFile(output + '/performance.json', JSON.stringify({ fixture: 'Synthetic near-limit managed Markdown with a heading every ten blocks', bytes: largeBytes, samples: samples.length, p95Milliseconds: p95, targetMilliseconds: 50, method: 'beforeinput to next requestAnimationFrame; browser integration estimate, not native latency' }, null, 2));
  console.log('Near-limit input-to-frame p95: ' + p95.toFixed(1) + ' ms (' + largeBytes + ' bytes)');
  assert.deepEqual(errors, []);
  const calls = (await store()).calls.map(c => c.action);
  assert(!calls.includes('mapleSubmit'), 'Acceptance must not request live classification or agent execution');
  await fs.writeFile(output + '/report.json', JSON.stringify({ ok: true, fixture: 'Explicitly synthetic writing/source evidence; no native persistence or live model validation', sources: sourceSpecs.map(([, id, type]) => ({ id, type })), checks: ['Markdown heading and bold input rules', 'Interactive checklist save/reopen', 'Searchable slash heading', 'Undo/redo', 'Email/iMessage/HA picker insertion', 'Original evidence, provider response and history inspector', 'Stable unique block IDs after reopen', 'Heading rail station click and keyboard expansion', 'Fold does not change Markdown', 'No standalone collapsible insert block', 'Shared notebook editor and source save/reopen', 'Smart Markdown paste keeps bold and list structure', 'Light/dark and narrow layout'], errors }, null, 2));
  await Promise.all(['failure.png', 'failure.txt', 'failure-state.json'].map(name => fs.rm(output + '/' + name, { force: true })));
  console.log('Writing/source journey passed; artifacts: ' + output);
} catch (error) {
  await fs.writeFile(output + '/failure-state.json', JSON.stringify(await store(), null, 2));
  await page.screenshot({ path: output + '/failure.png', fullPage: true });
  await fs.writeFile(output + '/failure.txt', String(error) + '\n' + await page.locator('body').innerText());
  throw error;
} finally {
  await context.close(); await browser.close();
}
