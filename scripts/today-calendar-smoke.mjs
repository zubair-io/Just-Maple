/** Synthetic browser-boundary acceptance: real Today + Tiptap + Yjs, no native app or OS clock changes. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syntheticBridge } from './today-synthetic-bridge.mjs';

const url = process.env.MAPLE_TEST_URL || 'http://127.0.0.1:4322/';
const artifactDirectory = '.build/today-calendar-smoke';
await fs.mkdir(artifactDirectory, { recursive: true });

function calendarBridge() {
  const bridge = window.webkit.messageHandlers.maple;
  const fallback = bridge.postMessage.bind(bridge);
  const fixture = window.__calendarFixture = { documents: {}, drafts: {}, calls: [], holdCommit: true, held: false, release: null };
  bridge.postMessage = async body => {
    fixture.calls.push(structuredClone(body));
    if (body.action === 'todayOpen') {
      const id = `synthetic-${body.day}`;
      if (!fixture.documents[id]) {
        const template = await fallback(body);
        fixture.documents[id] = { ...template, documentID: id, day: body.day,
          path: `${body.day.slice(0, 4)}/${body.day.slice(5, 7)}/${body.day}.md`,
          content: `---\nmaple:\n  format: 1\n  document: "${id}"\n  day: "${body.day}"\n---\n\n<!-- maple:block {"v":1,"id":"synthetic-prose-${body.day}"} -->\nSynthetic dated writing ${body.day}.\n` };
      }
      return structuredClone(fixture.documents[id]);
    }
    if (body.action === 'documentOpen') return structuredClone(fixture.documents[body.documentID]);
    if (body.action === 'documentDraft') { fixture.drafts[body.documentID] = structuredClone(body); return {}; }
    if (body.action === 'documentCommit') {
      if (fixture.holdCommit) {
        fixture.held = true;
        await new Promise(resolve => fixture.release = resolve);
        fixture.holdCommit = false;
        fixture.held = false;
      }
      const doc = fixture.documents[body.documentID];
      if (doc.revision !== body.expectedRevision) throw Error('Synthetic revision conflict');
      doc.content = body.content;
      doc.revision = 'r' + (Number(doc.revision.slice(1)) + 1);
      return { ...doc, state: 'committed', commandID: body.commandID };
    }
    if (body.action === 'documentAutoRefresh') return { document: structuredClone(fixture.documents[body.documentID]) };
    if (body.action === 'documentAutomaticProposal') return {
      documentID: body.documentID, revision: fixture.documents[body.documentID]?.revision, groups: [], removals: [],
    };
    return fallback(body);
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const scenario of ['midnight-caret', 'timezone-selection']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    // Reject every non-local request; this fixture can never contact a model or account.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    await context.addInitScript({ content: `(${syntheticBridge.toString()})();(${calendarBridge.toString()})();` });
    const page = await context.newPage();
    const timezoneSession = await context.newCDPSession(page);
    await timezoneSession.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-09-27T23:59:50-04:00') });
    await page.clock.pauseAt(new Date('2026-09-27T23:59:58-04:00'));
    await page.goto(url + '#/today');
    await page.clock.runFor(100);
    const editor = page.getByRole('textbox', { name: 'Daily note editor', exact: true });
    await expect(editor).toBeVisible();
    await expect(page).toHaveURL(/\/daily\/2026-09-27$/);
    await expect(page.locator('.day-rail [aria-current="page"]')).toHaveText('Today');
    await expect(page.locator('.date-chip')).toHaveText('Today');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(` Unsaved synthetic ${scenario} writing.`);
    if (scenario === 'timezone-selection') for (let n = 0; n < 8; n++) await page.keyboard.press('Shift+ArrowLeft');
    await page.clock.runFor(800);
    await expect.poll(() => page.evaluate(() => window.__calendarFixture.held)).toBe(true);
    const before = await editor.evaluate(element => {
      const editor = element.editor;
      const shared = editor.extensionManager.extensions.find(extension => extension.name === 'collaboration').options.document;
      const fixture = window.__calendarFixture;
      const pending = fixture.calls.findLast(call => call.action === 'documentCommit');
      const selection = window.getSelection();
      window.__calendarPinned = { element, editor, shared, anchor: selection.anchorNode, focus: selection.focusNode,
        anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset,
        json: JSON.stringify(editor.getJSON()), documentID: pending.documentID };
      return { documentID: pending.documentID, markdown: pending.content, saving: fixture.held,
        draft: fixture.drafts[pending.documentID]?.content,
        collapsed: selection.isCollapsed, selected: selection.toString(),
        actualTiptap: !!editor.state.doc, actualYjs: !!shared?.getXmlFragment };
    });
    assert.equal(before.actualTiptap, true);
    assert.equal(before.actualYjs, true);
    assert.equal(before.saving, true);
    assert.equal(before.draft, before.markdown);
    assert.equal(before.collapsed, scenario === 'midnight-caret');
    if (scenario === 'midnight-caret') await page.clock.runFor(1500);
    else {
      await timezoneSession.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/London' });
      assert.equal(await page.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().timeZone), 'Europe/London');
      // No focus/visibility event: verify the calendar's minute fallback notices a zone change.
      await page.clock.runFor(60_100);
    }
    await expect(page.locator('.day-rail [aria-current="page"]')).toHaveText('Yesterday');
    await expect(page.locator('.date-chip')).toHaveText('Yesterday');
    await expect(page.locator('.date-chip')).toHaveAttribute('datetime', '2026-09-27');
    await expect(page).toHaveURL(/\/daily\/2026-09-27$/);
    const after = await editor.evaluate(element => {
      const editor = element.editor;
      const shared = editor.extensionManager.extensions.find(extension => extension.name === 'collaboration').options.document;
      const fixture = window.__calendarFixture;
      const pinned = window.__calendarPinned, selection = window.getSelection();
      const pending = fixture.calls.findLast(call => call.action === 'documentCommit');
      return { identity: element === pinned.element && editor === pinned.editor && shared === pinned.shared,
        selection: selection.anchorNode === pinned.anchor && selection.focusNode === pinned.focus && selection.anchorOffset === pinned.anchorOffset && selection.focusOffset === pinned.focusOffset,
        unchangedEditorContent: JSON.stringify(editor.getJSON()) === pinned.json,
        markdown: pending.content, saving: fixture.held,
        draft: fixture.drafts[pending.documentID]?.content,
        documentID: pending.documentID,
        opens: fixture.calls.filter(call => call.action === 'todayOpen').map(call => call.day),
        committedContent: fixture.documents[pending.documentID].content };
    });
    assert.equal(after.identity, true);
    assert.equal(after.selection, true);
    assert.equal(after.unchangedEditorContent, true);
    assert.equal(after.documentID, before.documentID);
    assert.equal(after.markdown, before.markdown);
    assert.equal(after.draft, before.markdown);
    assert.equal(after.saving, true);
    assert.deepEqual(after.opens, ['2026-09-27']);
    assert.ok(!after.committedContent.includes('Unsaved synthetic'));
    await page.screenshot({ path: `${artifactDirectory}/${scenario}.png` });
    await page.evaluate(() => window.__calendarFixture.release());
    await expect.poll(() => page.evaluate(() => window.__calendarFixture.held)).toBe(false);
    await expect.poll(() => page.evaluate(id => window.__calendarFixture.documents[id].content, before.documentID)).toBe(before.markdown);
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.clock.runFor(100);
    await expect(page).toHaveURL(/\/daily\/2026-09-28$/);
    await expect(editor).toContainText('Synthetic dated writing 2026-09-28.');
    await expect(page.locator('.day-rail [aria-current="page"]')).toHaveText('Today');
    await expect(page.locator('.date-chip')).toHaveText('Today');
    await page.getByRole('link', { name: 'Yesterday', exact: true }).click();
    await page.clock.runFor(100);
    await expect(page).toHaveURL(/\/daily\/2026-09-27$/);
    await expect(editor).toContainText(`Unsaved synthetic ${scenario} writing.`);
    assert.equal(await page.evaluate(id => window.__calendarFixture.documents[id].content, before.documentID), before.markdown);
    assert.deepEqual(errors, []);
    results.push({ scenario, passed: true, pinnedDocument: before.documentID,
      nextToday: '2026-09-28', caretOrSelectionPreserved: true, editorAndYjsIdentityPreserved: true,
      pendingDraftPreserved: true, savedOnOriginalDay: true, browserErrors: errors });
    await context.close();
    console.log(`PASS ${scenario}: real editor identity, selection, pending draft and route pinned; relative labels and explicit Today navigation correct.`);
  }
  await fs.writeFile(`${artifactDirectory}/report.json`, JSON.stringify({ synthetic: true,
    boundary: 'Chromium Playwright clock and CDP timezone; no native OS/iCloud/physical-device claim', results }, null, 2));
} finally { await browser.close(); }
