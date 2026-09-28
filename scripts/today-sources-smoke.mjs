/** Synthetic browser contract test only. No fixture transport is shipped in the app.
 * npm start --prefix src/web -- --port 4320; node scripts/today-sources-smoke.mjs
 */
import {
  chromium,
  expect,
} from "../src/web/node_modules/@playwright/test/index.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const output = ".build/today-sources-smoke";
await fs.mkdir(output, { recursive: true });
import { syntheticBridge } from "./today-synthetic-bridge.mjs";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  timezoneId: "America/New_York",
});
await context.addInitScript(syntheticBridge);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    (process.env.MAPLE_SMOKE_URL || "http://127.0.0.1:4320") + "/#/today",
  );
  await expect(
    page.locator("maple-today .date-chip"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Synthetic proposal", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: output + "/today-light.png", fullPage: true });
  const editor = page.getByRole("textbox", {
    name: "Daily note editor",
    exact: true,
  });
  await editor.evaluate(el => {
    el.focus();
    const range = document.createRange();range.selectNodeContents(el);range.collapse(false);
    const selection = window.getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await editor.press("Enter");
  await editor.pressSequentially("Synthetic persisted writing.");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("maple.today.sources.smoke.v1"))
            .content,
      ),
    )
    .toContain("Synthetic persisted writing.");
  await page.reload();
  await expect(editor).toContainText("Synthetic persisted writing.");
  await page.getByRole("button", { name: "Document tools", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Document tools", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "View Markdown", exact: true })
    .click();
  const raw = page.getByRole("textbox", {
    name: "Daily note Markdown source",
    exact: true,
  });
  await expect(raw).toHaveValue(/maple-ref/);
  await page.getByRole("button", { name: "Document tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Formatted view", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Synthetic proposal", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Document tools", exact: true })).toHaveCount(0);
  await expect(page.getByText("Suggested follow ups", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ask Maple ↵", exact: true }).click();
  await expect(page.locator(".maple-run")).toContainText("succeeded", {
    timeout: 10000,
  });
  await expect(editor).toContainText("Synthetic Maple reply");
  await page
    .getByRole("button", { name: "State & history ↗", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Source details", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Responses", exact: true }).click();
  await page.getByRole("button", { name: /classification · response/ }).click();
  await expect(page.locator("maple-source-detail pre")).toContainText(
    '"synthetic": true',
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Sources", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByLabel("Type", { exact: true }).selectOption("email");
  await page.getByLabel("Account", { exact: true }).selectOption("work");
  const todayRange = await page.evaluate(() => {
    const now = new Date();
    const day = new Intl.DateTimeFormat("en-CA").format(now);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return {
      day,
      start: start.toISOString(),
      end: new Date(end.getTime() - 1).toISOString(),
    };
  });
  await page.getByLabel("Received from", { exact: true }).fill(todayRange.day);
  await page.getByLabel("Received to", { exact: true }).fill(todayRange.day);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Synthetic proposal");
  await expect(page).toHaveURL(new RegExp("receivedFrom=" + todayRange.day));
  await expect(page).toHaveURL(new RegExp("receivedTo=" + todayRange.day));
  const dateQuery = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("maple.today.sources.smoke.v1"))
        .calls.filter((c) => c.action === "sourceList")
        .at(-1).query,
  );
  assert.equal(dateQuery.receivedAfter, todayRange.start);
  assert.equal(dateQuery.receivedBefore, todayRange.end);
  await page.screenshot({
    path: output + "/sources-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Synthetic proposal/ }).click();
  await page.getByRole("button", { name: "Processing", exact: true }).click();
  await page
    .getByRole("button", { name: "Open representative source ↗", exact: true })
    .click();
  await expect(page).toHaveURL(/sources\/synthetic-message/);
  await expect(page.locator("maple-source-detail h2")).toContainText(
    "Synthetic message",
  );
  await page.getByRole("button", { name: /Synthetic proposal/ }).click();
  await page
    .getByRole("button", { name: "Open related revision 1 ↗", exact: true })
    .click();
  await expect(page).toHaveURL(/sources\/synthetic-message/);
  await page.getByRole("button", { name: /Synthetic proposal/ }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".audit")).toContainText("running → succeeded");
  await page.screenshot({
    path: output + "/source-history.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: output + "/sources-dark.png", fullPage: true });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.screenshot({ path: output + "/today-dark.png", fullPage: true });
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.screenshot({ path: output + "/today-narrow.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    true,
    "Today should fit the narrow viewport",
  );
  // Shared source rendering in an explicitly registered ordinary notebook.
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page
    .getByRole("button", { name: "All notebooks", exact: true })
    .click();
  await page.locator(".memo-cover").first().click();
  await page.locator(".note-list button").first().click();
  await page
    .getByRole("button", {
      name: "Enable source blocks & inline Maple",
      exact: true,
    })
    .click();
  await expect(page.locator(".note-paper .tiptap")).toBeVisible();
  await page.getByRole("button", { name: "Insert a block", exact: true }).click();
  await page.getByRole("button", { name: "Source reference", exact: true }).click();
  await page.locator(".notebook-source-picker .source-choice").first().click();
  await expect(page.locator(".note-paper .source-card")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("maple.today.sources.smoke.v1"))
            .generic.content,
      ),
    )
    .toContain("maple-ref");
  await page.screenshot({
    path: output + "/notebook-source.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".note-paper .source-card")).toHaveCount(0);
  await page.locator(".memo-cover").first().click();
  await page.locator(".note-list button").first().click();
  await expect(page.locator(".note-paper .source-card")).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(editor).toBeVisible();
  // Measure a labeled synthetic near-limit note. beforeinput -> first animation frame
  // approximates input-to-paint scheduling; it is not a native model-quality benchmark.
  const largeBytes = await page.evaluate(() => {
    const key = "maple.today.sources.smoke.v1";
    const store = JSON.parse(localStorage.getItem(key));
    let content =
      '---\nmaple:\n  format: 1\n  document: "synthetic-document"\n---\n\n';
    let index = 0;
    while (content.length < 248000) {
      content +=
        "<!-- maple:block " +
        JSON.stringify({ v: 1, id: "large-" + index++ }) +
        " -->\nSynthetic performance paragraph keeps local writing responsive while preserving the stable identity and readable Markdown file.\n\n";
    }
    store.content = content;
    store.revision = "r100";
    store.run = null;
    localStorage.setItem(key, JSON.stringify(store));
    return new TextEncoder().encode(content).length;
  });
  await page.reload();
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await page.evaluate(() => {
    window.__mapleLatency = [];
    document.querySelector(".tiptap").addEventListener("beforeinput", () => {
      const start = performance.now();
      requestAnimationFrame(() =>
        window.__mapleLatency.push(performance.now() - start),
      );
    });
  });
  await editor.pressSequentially("Synthetic typing latency measurement.", {
    delay: 60,
  });
  const samples = await page.evaluate(() => window.__mapleLatency);
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)];
  await fs.writeFile(
    output + "/editor-performance.json",
    JSON.stringify(
      {
        fixture: "synthetic near-limit managed Markdown",
        bytes: largeBytes,
        samples: samples.length,
        p95Milliseconds: p95,
        targetMilliseconds: 50,
        method:
          "beforeinput to next requestAnimationFrame; browser integration estimate",
      },
      null,
      2,
    ),
  );
  console.log(
    "Near-limit editor input-to-frame p95: " +
      p95.toFixed(1) +
      " ms (" +
      largeBytes +
      " bytes)",
  );
  assert.deepEqual(errors, []);
  console.log("Today/Sources synthetic smoke passed; artifacts: " + output);
} finally {
  await context.close();
  await browser.close();
}
