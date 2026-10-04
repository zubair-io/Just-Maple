/** Explicitly synthetic browser-test transport. Never shipped in the app. */
export function syntheticBridge(options = {}) {
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
    path: day.slice(0, 4) + "/" + day.slice(5, 7) + "/" + day + ".md",
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
          // The performance fixture must not serialize an ever-growing history
          // of complete note bodies on every key. Retain command identity and
          // content size in the bounded audit; current content and the latest
          // full draft remain separately persisted below.
          const audit = options.compactContentAudit && typeof body.content === "string"
            ? Object.fromEntries([...Object.entries(body).filter(([key]) => key !== "content"),
                ["contentBytes", new TextEncoder().encode(body.content).length]])
            : body;
          store.calls.push(audit);
          if (options.compactContentAudit && store.calls.length > 512)
            store.calls.splice(0, store.calls.length - 512);
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
                      ...(store.recoveryCopies ?? []).map(copy => ({path:copy.path,name:copy.path.replace('.md',''),modifiedAt:Date.now()/1000})),
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
            case "documentPresence":
              return { deferred: true };
            case "documentAutoRefresh":
              return { document: doc() };
            case "documentAutomaticProposal":
              return { documentID: body.documentID, revision: body.documentID === "synthetic-generic" ? store.generic.revision : store.revision, groups: [], removals: [] };
            case "documentOpen":
              return body.documentID === "synthetic-generic"
                ? genericDoc()
                : doc();
            case "documentRecoveryCopy": {
              store.recoveryCopies ??= [];
              let copy = body.recoveryKey ? store.recoveryCopies.find(copy => copy.key === body.recoveryKey && copy.content === body.content) : undefined;
              if (!copy) { copy = { key: body.recoveryKey, notebookID: "synthetic-book", path: "Synthetic recovery " + (store.recoveryCopies.length + 1) + ".md", content: body.content, revision: "synthetic-recovery-1" }; store.recoveryCopies.push(copy); save(); }
              return copy;
            }
            case "noteRead":
              return store.recoveryCopies?.find(copy => copy.path === body.path) ?? notebookDoc();
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
              if (options.compactContentAudit) {
                store.drafts ??= {};
                store.drafts[body.documentID] = body;
                save();
              }
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
              const replySaved = [...body.content.matchAll(/<!-- maple:block (\{[^\n]+\}) -->/g)].some(match => {
                const metadata = JSON.parse(match[1]);
                return metadata.kind === "maple-reply" && metadata.runID === "synthetic-run";
              });
              if (store.run && replySaved) {
                store.run = { ...store.run, status: "succeeded", appliedRevision: store.revision };
              }
              save();
              return {
                ...doc(),
                state: "committed",
                commandID: body.commandID,
              };
            case "documentSuggestions":
              return { tasks: [], carryForward: [], hasMore: false };
            case "documentHistory":
            case "documentOperationHistory":
              return [];
            case "mapleRuns":
              return body.documentID === "synthetic-document" && store.run
                ? [store.run]
                : [];
            case "mapleSubmit":
              store.run = {
                runID: "synthetic-run",
                status: "queued",
                requestBlockID: body.requestBlockID,
                request: { text: body.text },
              };
              save();
              return store.run;
            case "mapleRun":
              if (store.run.status === "queued") {
                store.run = { ...store.run, status: "unapplied", text: "Synthetic Maple reply with captured evidence.", eventIDs: ["synthetic-email"] };
                save();
              }
              return store.run;
            case "mapleResponseProposal":
              return {
                runID: "synthetic-run", documentID: "synthetic-document", revision: store.revision,
                requestBlockID: store.run.requestBlockID,
                blocks: store.run.appliedRevision ? [] : [{
                  blockID: "reply",
                  markdown: marker("reply", { kind: "maple-reply", runID: "synthetic-run", requestID: "synthetic-request" }) + "Synthetic Maple reply with captured evidence.\n",
                }],
              };
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
