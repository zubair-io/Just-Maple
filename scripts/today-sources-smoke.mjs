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
function syntheticBridge() {
  const day = new Intl.DateTimeFormat("en-CA").format(new Date());
  const key = "maple.today.sources.smoke.v1";
  const marker = (id, extra = {}) =>
    "<!-- maple:block " + JSON.stringify({ v: 1, id, ...extra }) + " -->\n";
  const original =
    '---\nmaple:\n  format: 1\n  document: "synthetic-document"\n  day: "' +
    day +
    '"\n---\n\n' +
    marker("heading") +
    "## Follow ups\n\n" +
    marker("prose") +
    "Synthetic review: keep the original evidence close to your writing.\n\n" +
    marker("email") +
    '```maple-ref\n{"v":1,"kind":"email","eventID":"synthetic-email","label":"Synthetic proposal"}\n```\n\n' +
    marker("request", {
      kind: "maple-request",
      requestID: "synthetic-request",
    }) +
    "@maple Find all my emails from Dominick.\n";
  let store = JSON.parse(
    localStorage.getItem(key) ||
      JSON.stringify({
        content: original,
        revision: "r1",
        calls: [],
        run: null,
      }),
  );
  const save = () => localStorage.setItem(key, JSON.stringify(store));
  store.generic ??= {
    content:
      "# Synthetic notebook note\n\nA separate user-owned Markdown document.\n",
    revision: "g1",
    managed: false,
  };
  const row = (id, type, connector, account, subject, status) => ({
    id,
    type,
    connector,
    account,
    externalID: id,
    revision: "1",
    sender: "Synthetic Dominick",
    subject,
    preview: "Synthetic evidence for browser verification only.",
    status,
    statusDetail: "Classification complete; extraction not needed.",
    occurredAt: Date.now() / 1000,
    receivedAt: Date.now() / 1000,
    stateVersion: 1,
  });
  const rows = [
    row(
      "synthetic-email",
      "email",
      "gmail",
      "work",
      "Synthetic proposal",
      "complete",
    ),
    row(
      "synthetic-message",
      "imessage",
      "messages",
      "personal",
      "Synthetic message",
      "pending",
    ),
    row(
      "synthetic-home",
      "ha",
      "home_assistant",
      "home",
      "Synthetic door: closed → open",
      "failed",
    ),
  ];
  const snapshot = {
    loaded: true,
    step: -1,
    name: "Synthetic UI verification",
    connected: false,
    running: false,
    busy: false,
    message: "",
    error: "",
    count: 3,
    world: null,
    importantPeople: [],
    claims: [],
    facts: [],
    prompts: {},
    decisions: [],
    work: [],
    queue: [],
    factQueue: [],
    calendarChoices: [],
    selectedCalendarIDs: [],
    appleCalendar: [],
    googleCalendars: [],
    selectedGoogleCalendarIDs: [],
    googleCalendar: [],
    homeEntities: [],
    selectedHomeEntities: [],
    contactsEnabled: false,
    calendarEnabled: false,
    appleImporting: false,
  };
  const doc = () => ({
    schemaVersion: 1,
    documentID: "synthetic-document",
    notebookID: "synthetic-book",
    path: "Daily/" + day + ".md",
    day,
    timeZone: "America/New_York",
    content: store.content,
    revision: store.revision,
    readOnly: false,
    indexingPending: false,
    legacyMigrationAvailable: false,
    capabilities: { taskActions: false, sourceReferences: true },
  });
  const genericDoc = () => ({
    schemaVersion: 1,
    documentID: "synthetic-generic",
    notebookID: "synthetic-book",
    path: "Notes.md",
    day: "",
    timeZone: "America/New_York",
    content: store.generic.content,
    revision: store.generic.revision,
    readOnly: false,
    indexingPending: false,
    legacyMigrationAvailable: false,
    capabilities: { taskActions: false, sourceReferences: true },
  });
  const notebookDoc = () => ({
    notebookID: "synthetic-book",
    path: "Notes.md",
    content: store.generic.content,
    revision: store.generic.revision,
    ...(store.generic.managed
      ? { documentID: "synthetic-generic", readOnly: false, day: "" }
      : {}),
  });
  window.webkit = {
    messageHandlers: {
      maple: {
        async postMessage(body) {
          store.calls.push(body);
          save();
          switch (body.action) {
            case "snapshot":
              return snapshot;
            case "notebookCatalog":
              return {
                notebooks: [
                  {
                    id: "synthetic-book",
                    name: "Synthetic notebook",
                    location: "Synthetic test folder",
                    cloud: false,
                    available: true,
                    notes: [
                      {
                        path: "Notes.md",
                        name: "Synthetic notebook note",
                        modifiedAt: Date.now() / 1000,
                      },
                    ],
                  },
                ],
                cloudAvailable: false,
              };
            case "todayOpen":
              return doc();
            case "documentOpen":
              return body.documentID === "synthetic-generic"
                ? genericDoc()
                : doc();
            case "noteRead":
              return notebookDoc();
            case "noteReadDraft":
              return null;
            case "noteDraft":
              return {};
            case "noteSave":
              store.generic.content = body.content;
              store.generic.revision =
                "g" + (Number(store.generic.revision.slice(1)) + 1);
              save();
              return notebookDoc();
            case "documentRegister":
              store.generic.managed = true;
              store.generic.content =
                '---\nmaple:\n  format: 1\n  document: "synthetic-generic"\n---\n\n' +
                store.generic.content;
              store.generic.revision =
                "g" + (Number(store.generic.revision.slice(1)) + 1);
              save();
              return genericDoc();
            case "documentDraft":
              return {};
            case "documentCommit":
              if (body.documentID === "synthetic-generic") {
                if (body.expectedRevision !== store.generic.revision)
                  throw Error("Synthetic generic revision conflict");
                store.generic.content = body.content;
                store.generic.revision =
                  "g" + (Number(store.generic.revision.slice(1)) + 1);
                save();
                return {
                  ...genericDoc(),
                  state: "committed",
                  commandID: body.commandID,
                };
              }
              if (body.expectedRevision !== store.revision)
                throw Error("Synthetic revision conflict");
              store.content = body.content;
              store.revision = "r" + (Number(store.revision.slice(1)) + 1);
              save();
              return {
                ...doc(),
                state: "committed",
                commandID: body.commandID,
              };
            case "documentSuggestions":
              return { tasks: [], carryForward: [], hasMore: false };
            case "mapleRuns":
              return body.documentID === "synthetic-document" && store.run
                ? [store.run]
                : [];
            case "mapleSubmit":
              store.run = {
                runID: "synthetic-run",
                status: "queued",
                requestBlockID: body.requestBlockID,
              };
              save();
              return store.run;
            case "mapleRun":
              if (store.run.status === "queued") {
                store.content +=
                  "\n" +
                  marker("reply", {
                    kind: "maple-reply",
                    runID: "synthetic-run",
                  }) +
                  "Synthetic Maple reply with captured evidence.\n";
                store.revision = "r" + (Number(store.revision.slice(1)) + 1);
                store.run = {
                  ...store.run,
                  status: "succeeded",
                  text: "Synthetic Maple reply with captured evidence.",
                  eventIDs: ["synthetic-email"],
                  content: store.content,
                  appliedRevision: store.revision,
                };
                save();
              }
              return store.run;
            case "sourceList": {
              const q = body.query;
              const filtered = rows.filter(
                (r) =>
                  (!q.types.length || q.types.includes(r.type)) &&
                  (!q.connectors.length ||
                    q.connectors.includes(r.connector)) &&
                  (!q.accounts.length || q.accounts.includes(r.account)) &&
                  (!q.states.length || q.states.includes(r.status)) &&
                  (!q.receivedAfter ||
                    r.receivedAt * 1000 >= Date.parse(q.receivedAfter)) &&
                  (!q.receivedBefore ||
                    r.receivedAt * 1000 <= Date.parse(q.receivedBefore)),
              );
              return {
                schemaVersion: 1,
                items: filtered,
                total: filtered.length,
                asOf: Date.now() / 1000,
                hasMoreMatches: false,
                facets: {
                  types: ["email", "imessage", "ha"],
                  connectors: ["gmail", "messages", "home_assistant"],
                  accounts: ["work", "personal", "home"],
                  states: ["complete", "pending", "failed"],
                },
              };
            }
            case "sourceDetail":
              return {
                schemaVersion: 1,
                row: rows.find((r) => r.id === body.eventID),
                content:
                  "Synthetic captured original. Never use this fixture as live evidence.",
                truncated: false,
                subjects: [],
                stages: [
                  { stage: "classification", state: "succeeded", version: 1 },
                  {
                    stage: "coalescing",
                    state: "coalesced",
                    version: 1,
                    relatedEventID: "synthetic-message",
                  },
                  {
                    stage: "task_extraction",
                    state: "not_needed",
                    version: 1,
                    reason: "Synthetic no task",
                  },
                ],
                artifacts: [
                  {
                    id: "synthetic-response",
                    stage: "classification",
                    kind: "response",
                    availability: "available",
                    mediaType: "application/json",
                    byteCount: 20,
                    legacy: false,
                  },
                ],
                relatedRevisions: ["synthetic-message"],
                historyAvailability: "Complete since synthetic test setup",
                asOf: Date.now() / 1000,
              };
            case "sourceHistory":
              return {
                items: [
                  {
                    sequence: 1,
                    eventID: body.eventID,
                    stage: "classification",
                    fromState: "running",
                    toState: "succeeded",
                    attemptID: "synthetic-attempt",
                    relatedEventID: "synthetic-message",
                    at: Date.now() / 1000,
                  },
                ],
              };
            case "sourceArtifact":
              return {
                id: body.artifactID,
                availability: "available",
                content: '{"synthetic": true}',
                offset: 0,
                totalBytes: 19,
                complete: true,
              };
            default:
              throw Error("Unhandled synthetic bridge action: " + body.action);
          }
        },
      },
    },
  };
  save();
}
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
    page.getByRole("heading", { name: "Today, a little clearer." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Synthetic proposal", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: output + "/today-light.png", fullPage: true });
  const editor = page.getByRole("textbox", {
    name: "Daily note editor",
    exact: true,
  });
  await editor.click();
  await editor.press("ControlOrMeta+End");
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
  await page
    .getByRole("button", { name: "View Markdown", exact: true })
    .click();
  const raw = page.getByRole("textbox", {
    name: "Daily note Markdown source",
    exact: true,
  });
  await expect(raw).toHaveValue(/maple-ref/);
  await page
    .getByRole("button", { name: "Formatted view", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Synthetic proposal", exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Add source", exact: true }).click();
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
