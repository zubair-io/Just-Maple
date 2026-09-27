# Today and Sources — product requirements

Status: Proposed for build · September 27, 2026  
Implementation: existing Just Maple app, Angular + Tiptap  
Companions: [Engineering design](../engineering/TODAY-AND-SOURCES.md) · [Build plan](../../plans/today-and-sources/BUILD-PLAN.md)

## Outcome

Just Maple opens to **Today**, a real dated Markdown document where the user writes, collects source material, tracks tasks, and works with Maple inline. **Sources** shows what entered the system, its observed state, and what processing actually happened. A source card inside a note opens the same evidence and processing history as its row in Sources.

For example, the user writes “Follow ups,” inserts two emails, adds a paragraph about a third email, then types `@maple Can you find all my emails from Dominick?`. After explicit submission, Maple replies directly below that request with matching email references. The user can open a reference, inspect the Jev decision and any further analysis, and return to the same place in the note.

This is a plan for production behavior. Names, messages, responses and dates in the design mockups are illustrative; the mockups do not search mail or save notes.

## Product decisions

1. `/today` is the default app route. It resolves the current local calendar day and opens or creates `Daily/YYYY-MM-DD.md` in the configured daily notebook. The example `2026-10-30.md` is a filename pattern, not a fixed date.
2. The Markdown file owns the document's writing and ordering. SQLite separately owns source evidence, canonical tasks, processing, block identity/history, and recoverable mutation records. An incoming email is an event, not a new Markdown file.
3. Both pages use the JustMaple design system for light and dark appearance. The polished Today concept guides layout and density. `_Maple` supplies selected components, not a second theme.
4. Sources represents immutable received observations, one row per event revision. A source entity may have multiple revisions; the detail view groups those revisions without hiding them from the table.
5. “Jev” and “Further analysis” are separate processing columns. Jev is itself an AI stage; the latter names downstream extraction/reasoning. Observed entity state and task completion remain separate concepts.
6. The first production rollout is Mac-first. The existing phone client remains compatible through versioned capabilities; new Today commands become editable on phone only when the Mac acknowledgment path is implemented. Full provider diagnostics stay Mac-only for this release.

### Relationship to existing requirements

This proposal replaces the daily-prose ownership and default-route portions of [LIVING-DAILY-NOTE.md](LIVING-DAILY-NOTE.md), which describe SQLite-owned daily prose. It retains stable identities, version checks, recoverable history, clear-versus-complete semantics, source ingestion invariants, privacy boundaries, and pending phone commands. During implementation, update that document and the relevant AGENTS.md direction together; do not leave two contradictory specifications active. Existing notebook files and SQLite history must survive migration.

## Scope

| Required for this release | Deferred |
| --- | --- |
| Dated Markdown Today workspace; past/future days; rich text and Markdown source mode | Collaborative Yjs/CRDT editing and multi-Mac simultaneous writers |
| Email, iMessage, Home Assistant, recording and task references mixed with writing | New email/message/HA connectors, arbitrary external automation and email sending |
| Inline submitted Maple requests, durable status, evidence-backed inline replies | Background agent rewriting of arbitrary user prose |
| Sources table with type, connector/account, processing state, date and search filters | Remote knowledge backend, new search service or collector enrollment |
| Original content, observed state, processing timeline, recorded Jev and further-analysis responses | Bulk retry, bulk delete and global queue administration redesign |
| Same source renderer and inspector used in notes and Sources | Recording capture/transcription pipeline; launch can attach/play existing recordings |
| JustMaple light/dark tokens and keyboard-accessible interaction | Additional custom themes and visual redesign of every existing route |
| Safe migration, draft recovery, versioned phone compatibility | Full source-response payload replication to phone |

## Today experience

### Open and navigate

- The primary sidebar contains Yesterday, Today, Tomorrow, notebooks, Sources, and existing Connections/settings access. Preserve onboarding and workspace tools.
- Use the current daily-notebook setting; if absent, choose the existing writable local notebook. If none exists, create a local Daily notebook through the existing notebook library. Store the selection explicitly; an unavailable selected notebook offers reconnect/change location and never silently creates a second copy elsewhere.
- Historical and future dates open through a date route. Only the selected day is created; a visit to tomorrow does not perform today's processing or carry-forward.
- The header identifies the date, notebook-relative filename, save/sync state, and “View Markdown.” In an empty note, “Today, a little clearer.” is interface copy/placeholder, not compulsory saved content.
- At midnight or a time-zone change, retain the open document and show “A new day is ready.” Opening Today resolves the new local date; typing never moves to a different file underneath the user.

### Write and collect

The central surface is one continuous Tiptap document: paragraphs, headings, lists, checklists, links, code and tables. Enter creates another paragraph; `/` or “Add a block” opens insertion options. Writing can appear before, between and after references. Saving occurs automatically with visible `Saving`, `Saved`, `Draft recovered`, `Conflict`, or `Unavailable` feedback. Navigation waits for a recoverable save or keeps the draft and clearly explains the failure.

| Block | What the reader sees | Supported actions |
| --- | --- | --- |
| Email | Sender, subject, compact preview, received time, connector/account, processing summary | Expand, open original, state history, remove/clear reference |
| iMessage | Person/thread, preview, time, source and processing summary | Same shared inspector; unsupported original links explain why |
| Home Assistant | Entity name and the observed transition, e.g. front door `closed → open`; observed time | Inspect original observation, processing and related evidence |
| Recording | Title, duration, play/pause and optional existing transcript | Play authorized local media, expand transcript, inspect provenance |
| Task | Checkbox, task text, linked-task indication where applicable | Complete/reopen, inspect task, clear attention, move |
| Maple request/reply | Editable draft prompt, explicit submit, then status and inline response with citations | Cancel queued work where possible, retry, inspect run, keep/edit reply |

Source cards show a short status by default. Full JSON, routing probabilities, prompts and technical IDs live in the inspector. A missing source keeps a readable reference with “Source unavailable”; it never appears as an empty paragraph. Source data refreshes without replacing neighboring writing, user annotations or cursor position.

### Inline Maple

- Typing `@maple` starts a request draft. **Enter edits the document; the Run button or Cmd/Ctrl+Enter submits.** Pasting a prompt or reopening a note never runs it.
- The submitted request is anchored to a stable document/block ID. Queued, searching, replying, failed, canceled and completed states remain visible across reloads.
- For “all my emails from Dominick,” search the ingested local email corpus with sender resolution. Explain ambiguous senders, incomplete connector coverage and pagination. “All” never implies mail that was not ingested. Empty results say no matches; failures remain failures.
- Insert a completed reply directly under its request. Results reference immutable source revisions. The user can edit around it while Maple runs.
- If the anchor is removed, moved to an unavailable document, or edited incompatibly, preserve the result in run history and offer “Insert response”; never append to an unrelated cursor position or replace user text.
- Retry creates another visible attempt for the same request. It must not duplicate prior successful effects or response blocks. A provider success whose result was discarded is distinguishable from a response applied to the note.
- Retrieved messages are evidence, not instructions. Inline retrieval cannot send mail, delete messages, or execute commands embedded in source content.

### Attention, tasks and history

Clear removes a block from the active day's attention and retains a restorable tombstone. It does not complete a linked task or delete source evidence. Completing a linked task explicitly updates the canonical task; a plain local checklist is only document content. Deleting ordinary prose is an editor operation with recoverable document history. Removing a source reference through the editor also records its suppression, so automatic suggestions cannot resurrect it.

Move retains the block ID and history. Copy makes a new block ID pointing to the same source. Undo of a persisted action is a new versioned compensating action; undoing prose must not silently reopen a canonical task. The UI must name the effect before committing canonical task changes.

For the first release, source references enter through user insertion, inline search results, or a visible “Suggested for today” collection of eligible existing core decisions. Suggestion refresh never rewrites the document. Unfinished tasks can be offered for carry-forward on entering Today; accept through the same versioned move operation. Do not auto-move arbitrary prose or flood Today with every received message.

## Sources experience

### Table

Use a semantic table with a sticky header, bounded paging, empty/loading/error states and a count for the active filters. Default sort is newest received first; keyboard activation of a row opens its detail. Selection and scroll survive closing the inspector.

| Column | Meaning |
| --- | --- |
| Received | When this observation entered Just Maple; detail also shows when it occurred |
| Type | Email, iMessage, Home Assistant, recording, note or other registered event type |
| Entry / observed state | Sender and subject, message preview, or entity plus observed transition |
| Source | Connector and account/connection display name |
| Processing | Current aggregate with truthful failure/pending/partial state |
| Jev | Classification stage status |
| Further analysis | Aggregate of applicable branches; expandable to their individual states |
| In notes | Linked notes/count; “Add to Today” is available from the row/detail |

Filters combine with AND across dimensions: Type; Source (connector plus account); processing state; received-date range; text search. Selecting multiple values within one dimension uses OR. For example `Type = Email` and `Source = Gmail / Work` must exclude personal Gmail and iMessage. Chips show active filters; Clear filters resets them. URL query state supports Back/Forward without leaking message content into URLs; text search stays session-local.

New arrivals show “New entries available” while browsing a page snapshot, avoiding row jumps. Refresh preserves filters. Results are bounded and stable even when processing changes while the user pages; engineering defines the query-session contract.

### Detail and state history

A drawer on wide screens and a full detail route on narrow screens share one inspector. Provide Summary, History and Responses views:

- **Summary:** original content, immutable event ID/revision, source/account, received/occurred timestamps, observed entity state, related task/evidence and linked note locations.
- **History:** chronological, durable stage transitions and attempts, start/end/duration, retry/reprocess relationships, routing decisions and why a stage did not run. Expand independent branches rather than implying a single linear pipeline.
- **Responses:** actual recorded Jev response and submitted context, provider/model, schema/prompt versions, evidence IDs; corresponding downstream responses and parsed/applied result. Large payloads load on demand. Safe error categories replace private HTTP error bodies.

Use explicit terms: `Not requested`, `Not applicable`, `Outside AI window`, `Coalesced`, `Queued`, `Running`, `Retrying`, `Failed`, `Succeeded`, and `Discarded`. “No further analysis needed” is an intentional recorded decision; “Not yet run” is unfinished work. Older events state “Historical attempt detail was not recorded” when appropriate. Retry is a targeted, explicit action for eligible failed work; historical responses remain inspectable afterward.

A source card in a note opens this same inspector at the same event revision. Closing it restores the note selection. “Add to Today” flushes/reconciles the current document, inserts one reference at a validated selection or at the end, and acknowledges only after durable persistence.

## Appearance and accessibility

The polished [Today prototype](https://maple-today-note.zubair-lawrence.chatgpt.site) supplies the editorial hierarchy, restrained cards, generous writing area and transit-inspired rails. The Sources mockups live in [design/sources](../../design/sources/README.md). Rails distinguish writing, sources and Maple replies through markers and labels as well as color; status is never encoded by color alone.

Use JustMaple's Lato UI, Merriweather writing, JetBrains Mono metadata and its token-defined surfaces, type scale, spacing and semantic states. Use its dark palette directly; do not invert the screenshot or inherit `_Maple` dark colors. Retain system appearance as default. Ensure focus visibility, minimum readable contrast, accessible table headers, meaningful icon labels, reduced-motion behavior, screen-reader status announcements, and reliable keyboard movement into/out of embedded cards. The inspector restores focus. IME composition must not submit Maple or lose text.

## Acceptance criteria

| ID | Observable acceptance |
| --- | --- |
| T1 | Fresh launch after onboarding opens Today; simultaneous opens create exactly one local-date file. Relaunch reopens saved content. |
| T2 | Write above/between source cards, save, reopen, toggle Markdown: writing, source IDs, order and task links survive. Unsupported Markdown is preserved with source-mode fallback. |
| T3 | Edit externally while the app is dirty: no silent overwrite; local draft and external bytes remain recoverable. Crash/restart at every persistence boundary loses no acknowledged edit. |
| T4 | Submit the Dominick request: real indexed matches or truthful empty/error/coverage feedback appear inline once. Retrying/reloading cannot duplicate effects. |
| T5 | Clear, restore, move, copy and complete preserve their distinct meanings, identity and history. Refresh does not resurrect cleared sources or replace edited replies. |
| S1 | Sources includes received emails, messages and HA events present in the store; type/account filters combine correctly across pages with no duplicate/missing snapshot rows. |
| S2 | Detail shows observed state separately from processing; each recorded Jev/downstream attempt shows actual retained context/output or an explicit unavailability reason. |
| S3 | Failed/retried/discarded and intentionally skipped stages stay distinguishable. No synthetic success fills a live failure. |
| S4 | Insert an event into Today and another notebook: both reference the same evidence and open the same inspector. Removing one reference leaves the other intact. |
| U1 | Today, Sources, inspector, menus and error states pass keyboard and light/dark visual review with JustMaple tokens only. |
| C1 | Phone never treats a queued command, file arrival or stale snapshot as Mac acceptance; unsupported/new protocol states fail visibly and preserve edits. |
| M1 | Migration preserves old daily IDs/history/tombstones and never overwrites an existing same-date Markdown file. |

## Release evidence

Ship only after the build plan's persistence, provider-history and end-to-end gates pass. Record measured editor responsiveness at the existing 256 KB file limit, a Sources fixture with at least 10,000 events, and UI paging behavior. Targets are input-to-paint p95 under 50 ms and warm first-page query p95 under 200 ms on the development Mac; these are acceptance targets to measure, not claims of current performance. Separate synthetic transport/storage tests from consented live-provider quality evaluation. Do not add telemetry of private notes, mail, prompts or provider payloads to measure adoption.
