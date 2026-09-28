# Shared writing experience — 2026-09-28

Daily notes and ordinary/managed notebooks now render through `MapleEditorComponent`. The former separate Markdown editor and permanent toolbar are removed. Ordinary files keep their existing frontmatter and plain Markdown save contract; registering a document enables evidence, attachments and inline Maple without introducing another prose authority. Read-only notes use the same renderer.

## Heading sections

A heading station on the writing rail expands/collapses the following outline, ending at the next heading of equal or higher rank. Nested folds remain independent. The station supports mouse, Enter/Space, and left/right arrows; Cmd/Ctrl+Alt+Left/Right folds/unfolds from the editor. The heading keeps its authored accessible name. Folding is view state: it does not change Markdown, create a revision, or consume undo history. It resets when the editor reopens. A selection inside a closing section moves to its heading; navigation into hidden content reveals it before editing.

The insertion menus no longer offer a standalone collapsible block. Existing top-level details display as ordinary heading sections, retaining their old block identity and content. Conversion is written only on the next actual edit. Legacy details inside lists/callouts remain readable to preserve their container semantics. Markdown headings have six levels; trailing unheaded prose follows the preceding section until the next heading.

## Bugs found through writing and source insertion

- Notebook autosave was accidentally a dependency of the document-opening effect. Saves could remount the editor, reset selection, and cause later source insertion to replace an earlier card. The effect now tracks notebook navigation only; a delayed-save regression retains typing, all three sources, and the same editor instance.
- Rapid Arrow Right then Enter after formatting could replace the old selected range before the browser selectionchange event reached ProseMirror. A guarded caret reconciliation now preserves the formatted words; the rapid-key browser regression has no artificial delay. IME, node selections and controls outside editable text remain untouched.
- The editor's initial reactive effect short-circuited before reading its read-only input. Subsequent read-only changes now update the editor correctly.
- Task rows were not consistently styled because rendered items omitted the assumed data attribute. Checkboxes and writing now align, checked items are legible, and regular bullet/number markers remain visible despite the global CSS reset.
- Gmail and iMessage share the `message.received` event type. Connector-based routing now preserves email/message/home kinds in both web insertion and native manual/automatic/inline references. Source cards show human-readable type labels and available HA observed state.
- Heading grips and station toggles no longer overlap. The footer can scroll clear of the floating dock. Plain Markdown refuses managed clipboard cards/files with an actionable message instead of dropping their evidence during serialization.

## Validation

Browser acceptance: `node scripts/writing-source-journey.mjs` against `npm start --prefix src/web -- --port 4320`. All content is explicitly synthetic; no production notes or paid providers are used. It covers real keyboard heading/bold input, checklists, slash search, undo/redo, Markdown paste, selection, station click/keyboard folding, unchanged serialized content on fold, original source/response/history inspection, all three reference kinds and stable identities after reopening, notebook registration, and light/dark/narrow layouts.

Native regression creates an actual temporary Markdown folder and SQLite database, ingests synthetic Gmail, iMessage and HA observations, inserts them together, then opens fresh store/library/coordinator instances. It verifies writing, heading text, block/evidence identities, original evidence content and inspector backlinks/revisions. This is independent from the browser's synthetic bridge.

Full checks: 350 core tests, 30 transport tests, 205 Angular tests, 69 Mac tests, and MapleCore CLI build passed. This does not establish live model quality or physical-device/iCloud behavior. The user's running editor session is preserved; the app does not hot reload the new build.

The existing `scripts/editor-extensions-smoke.mjs` also passes: pointer block reorder, slash search, rapid selection-formatting → Arrow Right → Enter without data loss, callout, heading folding, attachment and reopen. The standalone details UI assertions were replaced by station-fold assertions.

The final near-limit test used 248,005 bytes, a heading every ten blocks and 40 typing samples: **26.8 ms p95** from `beforeinput` to the next animation frame, below the 50 ms browser-test target. This measures this machine/browser and is not native end-to-end latency. No page errors were recorded.

Screenshots and machine-readable reports are in [writing-experience](writing-experience/): [Today light](writing-experience/today-light.png), [Today dark](writing-experience/today-dark.png), [narrow](writing-experience/today-narrow.png), [notebook light](writing-experience/notebook-light.png), [notebook dark](writing-experience/notebook-dark.png), [acceptance](writing-experience/report.json) and [performance](writing-experience/performance.json).

Fresh production Angular/Mac build and strict app signature verification passed. App: `.build/xcode/Build/Products/Debug/Just Maple.app`. Save and reopen this build to use the changes; no active user editing session was terminated.

## Live calendar navigation

The sidebar uses stable `/yesterday`, `/today` and `/tomorrow` links. Visiting one resolves the local calendar date and redirects to `/daily/YYYY-MM-DD`; only that dated route hosts the editor. Legacy `/today/:date` links redirect to the canonical route. Invalid dates, `/daily`, launch and unknown routes resolve directly to today's dated document. The Mac WebView retains hash routing (`#/daily/YYYY-MM-DD`). The date in the route owns daily document selection; stale document query parameters cannot select another day's file.

Active styling compares the canonical dated URL against the shared local calendar. At midnight, or on wake/focus, the calendar updates the highlight and relative chip without navigation or document reopening. Writing and selection remain in the same editor. Clicking Today subsequently resolves the new day. Pending saves remain guarded; failed saves cancel navigation, and newer navigation supersedes older pending navigation.

Angular regressions cover relative and canonical URLs, launch, invalid/legacy dates, stable hrefs, date-based active styling, midnight editor preservation, repeated Today navigation, failed saves and superseded navigation. Existing calendar tests cover wake/visibility, disposal, year/leap-day/DST arithmetic. `node scripts/daily-routing-smoke.mjs` tests the real editor with explicitly synthetic native data and a controlled New York clock: launch into September 27, type, cross midnight, retain URL/editor/cursor/writing, click Today/Tomorrow/Yesterday, and recover the original writing. No real notes or providers are accessed.

The Mac launch test initially caught a redirect-chain failure; root and fallback routes now resolve directly to a dated route. Final validation: 212 Angular, 350 core, 30 transport and 69 Mac tests pass, plus the real-editor midnight journey and CLI build. Fresh signed Mac build: `.build/xcode/Build/Products/Debug/Just Maple.app`. The running user editing session was not terminated.

## Open/save concurrency recovery

The reported “This day is already opening” error came from native actor reentrancy: background projection/startup recovery could overlap editor reads, and the coordinator rejected ordinary contention. Overlapping day/document commands now queue; multi-document actions reserve their participants together. Recovery that already owns one participant uses nonwaiting acquisition for the remainder to avoid reciprocal deadlocks. Genuine revision conflicts continue to preserve both versions.

A successful user commit advances the baseline of a newer retained draft only when the draft matches the old baseline and disk still matches the acknowledged save. Its writing is unchanged; generated writes and external revisions do not rebase it. This prevents typing during a save from becoming a false draft conflict after reopening.

The shared web document service coalesces identical open requests, keeps loading state correct when a prerequisite save fails, and rejects late open/reply snapshots after newer writing or saves. Reopen waits for an in-flight save acknowledgment. Retry save retries a failed durable draft write instead of awaiting the same rejected promise indefinitely. Today and notebook editors temporarily prevent edits while switching documents. Opening errors have their own message and retry action, preserving the previous document rather than pretending a save failed.

Validation: 355 core, 30 transport, 219 Angular and 69 Mac tests pass, plus CLI build and both real-editor synthetic browser journeys (midnight routing; writing/source insertion/notebook persistence). Native regressions include 20 concurrent day opens with one durable identity, 24 overlapping reads/save replays, cancellation/error cleanup, retained-draft rebasing and external-revision protection. Browser writing remained intact with email, iMessage and HA blocks after reopening; near-limit input-to-frame p95 was 27.3 ms at 248,005 bytes. Fixtures do not call paid providers or modify production notes.

## Processing visibility

Processing is now directly accessible beside Sources in the sidebar and through View processing in the Sources header. The existing live native snapshot drives queue counts; the page leads with enabled/paused state, provider status, the Jev hold reason, and waiting/processing/blocked/completed counts. Recent classification records link to their source inspector. Viewing the page does not resume processing or clear a provider hold.

Validation: 221 Angular, 355 core, 30 transport and 69 Mac tests pass, along with the CLI build. Regressions cover the visible route link/active state and changing queue counts with a provider hold without triggering processing.
