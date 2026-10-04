/** Synthetic-only browser acceptance. No real messages, recordings, providers or iCloud writes. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';

const output = '.build/note-feature-acceptance';
await fs.mkdir(output, { recursive: true });
// Quiet three-second PCM tone, constructed locally solely for media transport/playback testing.
const samples = 8000 * 3, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 8000) * 200), 44 + i * 2);
function seed(wavBase64) {
  window.__syntheticWav = wavBase64;
  const key = 'maple.today.sources.smoke.v1';
  if (localStorage.getItem(key)) return;
  const day = new Intl.DateTimeFormat('en-CA').format(new Date());
  const marker = (id, extra = {}) => '<!-- maple:block ' + JSON.stringify({ v: 1, id, ...extra }) + ' -->\n';
  const recording = (id, attachmentID) => marker(id) + '```maple-ref\n' + JSON.stringify({ v: 1, kind: 'recording', eventID: id, label: 'Synthetic ' + id, ...(attachmentID ? { attachmentID } : {}) }) + '\n```\n\n';
  const content = '---\nmaple:\n  format: 1\n  document: "synthetic-document"\n  day: "' + day + '"\n---\n\n' +
    marker('heading') + '## Synthetic feature acceptance\n\n' +
    marker('prose') + 'Synthetic writing: preserve this note during navigation.\n\n' +
    marker('linked-task', { taskID: 'task:synthetic-task' }) + '- [ ] Synthetic review task\n\n' +
    recording('recording-ready', 'Attachments/' + 'a'.repeat(64) + '.wav') +
    recording('recording-missing', 'Attachments/' + 'b'.repeat(64) + '.wav') +
    recording('recording-attach') +
    marker('request', { kind: 'maple-request', requestID: 'synthetic-request' }) + '@maple Find all my emails from Synthetic Dominick.\n';
  localStorage.setItem(key, JSON.stringify({ content, revision: 'r1', calls: [], run: {
    runID: 'synthetic-run', status: 'succeeded', requestBlockID: 'request', request: { text: 'Find all my emails from Synthetic Dominick.' },
    text: 'Synthetic saved search. All results are test fixtures.', eventIDs: [], total: 30, hasMore: true, appliedRevision: 'r1',
  } }));
}
function extendBridge() {
  const handler = window.webkit.messageHandlers.maple, original = handler.postMessage.bind(handler);
  const fixture = window.__noteFeatureFixture = { calls: [], failCommits: false, missingAvailable: false };
  const task = { id: 'synthetic-task', ownerID: 'local', title: 'Synthetic review task', description: 'Synthetic task detail with captured provenance.', status: 'open', waitingReason: '', assignee: 'Synthetic user', place: '', people: [], priority: 0, conditions: [], evidenceIDs: ['synthetic-email'], activityIDs: [], version: 1, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000 };
  const world = { revision: 1, asOf: Date.now() / 1000, activities: [], tasks: [task], states: [], suggestions: [], series: [], attention: [], history: [], properties: [] };
  const row = id => ({ id, type: id.startsWith('recording-') ? 'recording' : 'email', connector: id.startsWith('recording-') ? 'recording' : 'gmail', account: 'synthetic-work', externalID: id, revision: '1', sender: 'Synthetic Dominick', subject: id.startsWith('recording-') ? 'Synthetic ' + id : 'Synthetic result ' + id.split('-').at(-1), preview: 'Synthetic evidence for browser acceptance only.', status: 'complete', occurredAt: Date.now() / 1000, receivedAt: Date.now() / 1000, stateVersion: 1 });
  handler.postMessage = async body => {
    fixture.calls.push(body);
    if (body.action === 'documentCommit' && fixture.failCommits) throw Error('Synthetic storage failure for navigation-guard verification.');
    if (body.action === 'attachmentRead') {
      if (body.ref.includes('b'.repeat(64)) && !fixture.missingAvailable) return { status: 'missing' };
      return { status: 'ready', dataURL: 'data:audio/wav;base64,' + window.__syntheticWav, byteCount: atob(window.__syntheticWav).length };
    }
    if (body.action === 'attachmentImport') return { ref: 'Attachments/' + 'c'.repeat(64) + '.wav', name: body.name, mimeType: body.mimeType, byteCount: atob(body.base64).length, kind: 'file' };
    if (body.action === 'mapleSearchPage') {
      if (body.runID !== 'synthetic-run') throw Error('Unexpected synthetic search identity.');
      const offset = body.cursor?.offset ?? 0;
      return { schemaVersion: 1, runID: body.runID, availability: 'available', intent: { type: 'email', sender: 'Synthetic Dominick', query: '' },
        items: Array.from({ length: Math.min(25, 30 - offset) }, (_, i) => { const n = offset + i + 1; return { eventID: 'search-result-' + n, availability: 'available', type: 'email', connector: 'gmail', account: 'synthetic-work', title: 'Synthetic result ' + n, excerpt: 'Synthetic captured matching source ' + n }; }),
        total: 30, capturedCount: 30, offset, ...(offset === 0 ? { nextCursor: { runID: body.runID, offset: 25, fingerprint: 'synthetic-fixed-search' } } : {}), hasMoreMatches: false, asOf: '2026-09-30T00:00:00Z' };
    }
    if (body.action === 'sourceDetail' && /^(recording-|search-result-)/.test(body.eventID)) return {
      schemaVersion: 1, row: row(body.eventID), content: body.eventID.startsWith('recording-') ? 'Synthetic transcript <img src=x onerror="window.__unsafeTranscript=true"> & ordinary words.' : 'Synthetic original evidence for ' + body.eventID,
      truncated: false, subjects: [], stages: [], artifacts: [], relatedRevisions: [], historyAvailability: 'Synthetic acceptance fixture', asOf: Date.now() / 1000,
    };
    const result = await original(body);
    if (body.action === 'snapshot') return { ...result, world };
    if (['todayOpen', 'documentOpen', 'documentCommit'].includes(body.action)) return { ...result,
      capabilities: { taskActions: true, sourceReferences: true }, blocks: [{ blockID: 'linked-task', documentID: 'synthetic-document', version: 1, kind: 'task', taskID: 'task:synthetic-task', taskVersion: 1, taskStatus: 'open', content: '- [ ] Synthetic review task', state: 'active' }],
    };
    return result;
  };
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, timezoneId: 'America/New_York' });
await context.addInitScript({ content: `(${seed.toString()})(${JSON.stringify(wav.toString('base64'))}); (${syntheticBridge.toString()})(); (${extendBridge.toString()})();` });
const page = await context.newPage(), errors = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.MAPLE_SMOKE_URL || 'http://127.0.0.1:4321';
const editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('maple.today.sources.smoke.v1')));
const card = id => editor.locator('.source-card').filter({ has: page.getByRole('button', { name: 'Open Synthetic ' + id + ' — source and processing history', exact: true }) });
try {
  await page.goto(base + '/#/today'); await expect(editor).toBeVisible();
  await page.evaluate(() => window.__noteFeatureFixture.failCommits = true);
  const paragraph = editor.locator('.maple-paragraph').filter({ hasText: 'Synthetic writing:' }).first();
  await paragraph.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.closest('[contenteditable]').focus(); });
  await page.keyboard.type(' Synthetic unsaved guard probe.');
  await editor.getByRole('button', { name: 'Task details', exact: true }).click();
  await expect(page.locator('.document-error').filter({ hasText: 'Synthetic storage failure' })).toBeVisible();
  assert.ok(!page.url().includes('/tasks/'), 'Failed draft flush must block navigation');
  await expect(editor).toContainText('Synthetic unsaved guard probe.');
  await page.evaluate(() => window.__noteFeatureFixture.failCommits = false);
  await editor.getByRole('button', { name: 'Task details', exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks\/synthetic-task$/);
  await expect(page.getByRole('heading', { name: 'Synthetic review task', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic task detail with captured provenance.', { exact: true })).toBeVisible();
  assert.match((await stored()).content, /Synthetic unsaved guard probe/);
  passed.push('Task details uses existing guarded route: failed save blocks departure; retry saves note and opens actual canonical task detail/provenance.');
  await page.goto(base + '/#/today'); await expect(editor).toContainText('Synthetic unsaved guard probe.');

  const ready = card('recording-ready'), audio = ready.locator('audio');
  await expect(audio).toBeVisible(); await expect(ready.locator('.duration')).toHaveText('0:03');
  await audio.evaluate(element => element.muted = true);
  await audio.click({ position: { x: 20, y: 18 } });
  await expect.poll(() => audio.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true);
  await audio.click({ position: { x: 20, y: 18 } });
  await expect.poll(() => audio.evaluate(element => element.paused)).toBe(true);
  await ready.getByText('Captured transcript / text', { exact: true }).click();
  await expect(ready.locator('pre')).toContainText('<img src=x onerror="window.__unsafeTranscript=true">');
  assert.equal(await ready.locator('.recording-text img').count(), 0);
  assert.equal(await page.evaluate(() => window.__unsafeTranscript), undefined);
  passed.push('Generated synthetic WAV loads real audio controls, reports duration and plays/pauses; captured transcript renders as escaped text.');

  const missing = card('recording-missing');
  await expect(missing).toContainText('Audio is missing.');
  await page.evaluate(() => window.__noteFeatureFixture.missingAvailable = true);
  await missing.getByRole('button', { name: 'Retry audio', exact: true }).click();
  await expect(missing.locator('audio')).toBeVisible(); await expect(missing.locator('.duration')).toHaveText('0:03');
  const unattached = card('recording-attach');
  await unattached.locator('input[type=file]').setInputFiles({ name: 'synthetic-acceptance.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(unattached.locator('audio')).toBeVisible(); await expect(unattached.locator('.duration')).toHaveText('0:03');
  await expect.poll(async () => (await stored()).content).toContain('c'.repeat(64) + '.wav');
  passed.push('Missing recording has a working retry; attaching existing audio updates the source reference and persists through normal note save.');

  await page.getByRole('button', { name: 'Browse matching sources', exact: true }).click();
  const results = page.getByRole('region', { name: 'Matching sources', exact: true });
  await expect(results).toContainText('30 matches · 1–25 shown');
  await results.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect(results).toContainText('30 matches · 26–30 shown');
  await results.getByRole('button', { name: 'Previous results', exact: true }).click();
  await expect(results).toContainText('30 matches · 1–25 shown');
  await results.getByRole('button', { name: 'Next results', exact: true }).click();
  await results.getByRole('button', { name: 'Synthetic result 26', exact: true }).click();
  const inspector = page.getByRole('dialog', { name: 'Source details', exact: true });
  await expect(inspector).toContainText('Synthetic original evidence for search-result-26');
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  await results.locator('li').filter({ has: page.getByRole('button', { name: 'Synthetic result 26', exact: true }) }).getByRole('button', { name: 'Add to note', exact: true }).click();
  await expect(editor).toContainText('Synthetic result 26');
  await expect.poll(async () => (await stored()).content).toContain('search-result-26');
  const calls = await page.evaluate(() => window.__noteFeatureFixture.calls);
  assert.deepEqual(calls.filter(call => call.action === 'mapleSearchPage').map(call => [call.runID, call.cursor?.offset ?? 0]), [['synthetic-run', 0], ['synthetic-run', 25], ['synthetic-run', 0], ['synthetic-run', 25]]);
  assert.equal(calls.filter(call => call.action === 'mapleSubmit').length, 0);
  passed.push('Search next/back keeps original run and captured cursor; no new model request; inspector and Add to note work for page-two evidence.');
  await page.reload(); await expect(editor).toContainText('Synthetic result 26');
  await expect(card('recording-attach').locator('audio')).toBeVisible();
  assert.equal(await editor.locator('.source-card-title').filter({ hasText: 'Synthetic result 26' }).count(), 1);
  passed.push('Reload preserves attached audio, one selected search reference and the user writing.');
  await page.screenshot({ path: output + '/features-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: output + '/features-dark.png', fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(output + '/results.json', JSON.stringify({ fixture: 'Synthetic data only. Generated WAV; no live provider, inbox, recording or iCloud validation.', passed, errors }, null, 2));
  await fs.rm(output + '/failure.json', { force: true }); await fs.rm(output + '/failure.png', { force: true });
  console.log(passed.join('\n'));
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  await fs.writeFile(output + '/failure.json', JSON.stringify({ error: String(error), passed, errors }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
