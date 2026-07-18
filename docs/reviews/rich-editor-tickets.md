# Rich Editor Review — Tickets

Source: full review of the TipTap + Y.js notebook editor (native/rust editors excluded).
Status legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low

---

## 🔴 Critical

### RE-1 — `/To-do Box` slash command crashes (unregistered + TDZ)

- **Files:** `extensions/todo-box.ts:230,267,277,288`; `extensions/index.ts`; `slash-commands.ts:72`; `notebook-editor.component.ts` (extensions array)
- **Problem:** (a) `TodoBox` is never exported/registered but `slash-commands.ts:72` calls `.insertTodoBox()` → `TypeError` at runtime. (b) `updateStatus()` is called at line 267 but references `completedToggle`/`completedCount` declared as `const` at 277/288 → `ReferenceError` (TDZ) on every render.
- **Fix:** Reorder declarations so `updateStatus()` runs after the toggle/count elements exist; export `TodoBox` from the barrel and register it in the editor's extension array (or remove the slash command if the feature is not shipping).
- **Status:** RESOLVED

### RE-2 — Editor-init race writes one page's content into another

- **Files:** `notebook-editor.component.ts:264-296,479-509`
- **Problem:** `initializeEditor()` awaits `openDocument(pageId)` with no cancellation. Fast A→B navigation stacks two editors; A's deferred `setContent` fires against B's editor and the local-save debounce persists A's content into B's file.
- **Fix:** Capture the target `pageId` after each `await` and bail if it no longer matches the current page. Guard the deferred `setContent` timeout the same way.
- **Status:** RESOLVED

### RE-3 — Google Calendar agenda drops all timed events east of UTC

- **Files:** `extensions/google-calendar-agenda.ts:62-73,140-186`
- **Problem:** Day-grid keys built from local-midnight `Date` but re-extracted via `.toISOString()` (UTC). Off-by-one day for UTC+ users → `grouped.has(eventDate)` always false → every event dropped.
- **Fix:** Use a local-safe `YYYY-MM-DD` formatter consistently (no `toISOString()` for calendar-day keys).
- **Status:** RESOLVED

---

## 🟠 High

### RE-4 — Y.js documents leak on every page switch

- **Files:** `notebook-editor.component.ts:241-243,2115`
- **Problem:** `lastPageId` is set to the new page before `initializeEditor()`, so `cleanup()` closes the new (not-yet-open) doc and never closes the old one. Y.Doc + IndexedDB + WebSocket provider leak per navigation.
- **Fix:** Close the _previous_ page's document before switching `lastPageId`, or track the open page id independently of the effect trigger.
- **Status:** RESOLVED

### RE-5 — Editor-container listeners accumulate across page switches

- **Files:** `notebook-editor.component.ts:598-1789`
- **Problem:** Eight `setup*Listeners()` re-bind to the persistent container each init without removal → duplicate insertions (3 embeds/pickers after 3 page opens).
- **Fix:** Track and remove all container listeners in `cleanup()` (mirror the page-link/json-ref pattern), or bind once with an AbortController tied to the component.
- **Status:** RESOLVED

### RE-6 — Shell-command injection in "Copy as cURL"

- **Files:** `services/api-request.service.ts:55-66`
- **Problem:** URL/header/body wrapped in single quotes with no escaping; note-controlled values → RCE when pasted into a terminal.
- **Fix:** POSIX single-quote-escape every interpolated value (`'` → `'\''`).
- **Status:** RESOLVED

### RE-7 — API block "Send" leaks credentials / enables CSRF

- **Files:** `components/molecules/api-block/api-endpoint-form/api-endpoint-form.component.ts:139-199`
- **Problem:** Sends user token + note-supplied headers to a note-specified absolute URL with default credentials; same-origin allowed.
- **Fix:** Add `credentials: 'omit'`, warn when the target origin comes from note content, and consider blocking same-origin requests. (Follow-up: route through `HttpClient` per CLAUDE.md.)
- **Status:** RESOLVED — `credentials: 'omit'` on the fetch + origin-confirmation prompt in `onSend()` before any auth token is sent. Follow-up (open): route through `HttpClient`.

### RE-8 — Task due-dates / "today" drift a day across timezones

- **Files:** `extensions/enhanced-task-item.ts:63-97`; `enhanced-task-list.ts:307-370`; `agenda.ts:57-59`
- **Problem:** Same UTC/local-midnight mismatch as RE-3.
- **Fix:** Shared local-safe date util; store/compare plain `YYYY-MM-DD`.
- **Status:** RESOLVED (within-timezone) via `formatLocalDate` in `getTodayDate`/`getNextDayDate` and the due-date picker read-back. RESIDUAL (open): cross-timezone collaboration still drifts because `dueDate` is stored as an absolute instant — a full fix needs a plain-date storage format + migration.

### RE-9 — Checkbox toggle wipes task priority/color/due-date

- **Files:** `extensions/enhanced-task-item.ts:498-510,552-609`
- **Problem:** `change` handler spreads stale construction-time `node.attrs`; `update()` never reassigns `node`.
- **Fix:** Reassign `node` in `update()` (mirror sibling NodeViews) or read current attrs at event time.
- **Status:** RESOLVED

---

## 🟡 Medium

- **RE-10** Duplicate-ID `appendTransaction` plugins churn IDs under collab / Enter-at-start reassigns wrong node. **RESOLVED (task items)** — dedup now keeps the id on the content-bearing node (fixes Enter-at-start split) with early-exit so it can't loop under collab. Residual: agenda/gcal plugins left as-is (not split the same way).
- **RE-11** `handleContentUpdate` runs 3 full-doc scans + `JSON.stringify` per transaction incl. remote updates; all clients PATCH redundantly. **PARTIAL** — read-only viewers now bail before any scan/PATCH (kills 403 spam). Residual: editable collaborators still re-scan on remote-origin updates; full gating needs the y-prosemirror sync-plugin transaction meta.
- **RE-12** `openJsonRefConfig()` leaks an Angular view. **RESOLVED** — `closeJsonRefConfig()` now `detachView()` + `destroy()`s the tracked `ComponentRef`.
- **RE-13** Unbounded gcal date range → browser-freezing DoS. **RESOLVED** — `MAX_AGENDA_DAYS = 366` cap + Invalid-Date guard in `getDateRange` (with RE-3).
- **RE-14** Unguarded `JSON.parse(collapsedDays)` / `classList.add(\`size-${x}\`)` / `priority-${x}`throw on malformed pasted attrs. **RESOLVED** —`parseCollapsedDays`try/catch (gcal),`safeImageSize`enum guard (image-node),`isValidPriority` guard (task-item).
- **RE-15** First title change swallowed on new pages; dead `isInitialSync` flag. **RESOLVED** — title guard now keys off `isInitialSync` (which is finally read) and emits the first real edit; a cleared title also syncs.
- **RE-16** Markdown-paste false positives. **RESOLVED** — code-block guard, ordered-list marker capped at 3 digits (excludes years), inert-DOM `sanitizeHtml` on marked output, destroyed-editor guard. (markdown-paste.spec.ts green.)
- **RE-17** Dead mention-flush on destroy; `tagUpdateTimeout` not cleared. **RESOLVED** — mention flush runs before editor destroy (RE-4); `tagUpdateTimeout` now cleared in `cleanup()`.

## ⚪ Low

- **RE-18** Read-only mode never re-enables. **RESOLVED** — editability effect now reflects read-only state in both directions; initial `editable:` also respects `isReadOnly`.
- **RE-19** Over-broad `stopEvent` breaks drag. **RESOLVED** — both NodeViews now pass drag events through to ProseMirror.
- **RE-20** `<3` emoji rule fires on `x<3`. **RESOLVED** — lookbehind requires a start/whitespace boundary.
- **RE-21** TOC full `innerHTML` rebuild per keystroke. **RESOLVED** — heading-signature check + 150ms debounce; dead `unsubscribe` removed.
- **RE-22** `onEditorWrapperClick` never bound. **RESOLVED** — `(click)` binding added to the wrapper in the template.
- **RE-23** Relative date labels never refresh. **RESOLVED (task items)** — shared 1-minute refresh timer re-renders date chips; cleared on destroy. Residual: agenda/gcal day labels not yet on the timer.
- **RE-24** Unvalidated `avatarUrl`/image `src` = tracking beacons. **RESOLVED** — `safeAvatarUrl`/`safeMediaUrl` allow only relative/blob/data-image/https.

---

## Feature gaps (rich editor completeness)

- **RE-F1** Link insert/edit UI. **RESOLVED (basic)** — toolbar link button prompts for a URL, edits/removes the link on the selection; TipTap validates the protocol. (A richer inline popover is a future enhancement.)
- **RE-F2** Task priority/color/due-date popover never instantiated. **RESOLVED** — task NodeView now has a settings button that opens `TodoPopoverComponent`; changes apply via `updateTodoAttrs`, dismiss on outside-click, destroyed on cleanup.
- **RE-F3** Toolbar block/insert/history sections commented out. **RESOLVED** — sections enabled; duplicate H1–H3 removed from `blockButtons`; state-version deps added so active/disabled states refresh.
- **RE-F4** Bubble menu is AI-only. **RESOLVED** — editor passed to `EditorBubbleMenuComponent`; bold/italic/underline/strike/code/highlight/link buttons render on selection (AI button kept).
- **RE-F5** Placeholder `.configure` commented out. **RESOLVED** — re-enabled (heading → "Note title", else "Type '/' for commands…").
- **RE-F6** Highlight registered in renderer but not editor. **RESOLVED** — `Highlight` added to the editor schema + a toolbar/bubble highlight button.
- **RE-F7** Long tail of missing features. **PARTIAL** — done: table insert, highlight, **image paste/drag-drop upload**. Remaining need a **dependency or UX decision** and were intentionally not added autonomously: text color, text alignment, superscript/subscript, toggle/collapsible blocks, find & replace (each needs a new `@tiptap/*` package — the repo already has version-drift concerns), plus word count, image alt/caption UI, footnotes, and a shortcut-help modal (need a UX/placement decision).
