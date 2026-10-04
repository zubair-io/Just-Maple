# Notes, Today and Sources — product requirements

Status: Approved product direction · Updated September 30, 2026

Baseline: Notes main surface, automatic context and local human/Maple editing built; remaining release gates below are not implied complete.
Implementation: existing Just Maple app, Angular + Tiptap  
Companions: [Engineering design](../engineering/TODAY-AND-SOURCES.md) · [Build plan](../../plans/today-and-sources/BUILD-PLAN.md)

## Outcome

**Notes is the main surface of Just Maple.** The app opens to **Today**, a real dated Markdown document where the user writes, collects source material, tracks tasks, and works with Maple inline. Notebooks use the same editor and interactions. The intelligent core supplies evidence-backed context to the document; the user should not need to visit a dashboard to receive useful results. **Sources** is the supporting inspection surface: it shows what entered the system, its observed state, and what processing actually happened. A source card inside a note opens the same evidence and processing history as its row in Sources.

For example, the user writes “Follow ups,” inserts two emails, adds a paragraph about a third email, then types `@maple Can you find all my emails from Dominick?`. After explicit submission, Maple replies directly below that request with matching email references. The user can open a reference, inspect the classification decision and any further analysis, and return to the same place in the note.

This document defines the production contract, including remaining acceptance work. Names, messages, responses and dates in the design mockups are illustrative; the mockups do not search mail or save notes. The mockup's decorative title and file header are not required document content.

## Product decisions

1. `/today` is the default app route. It resolves the current local calendar day and opens or creates `Just Maple/YYYY/MM/YYYY-MM-DD.md` in the app’s iCloud Documents container. The example `2026-10-30.md` is a filename pattern, not a fixed date.
2. The Markdown file owns the document's writing and ordering. SQLite separately owns source evidence, canonical tasks, processing, block identity/history, and recoverable mutation records. An incoming email is an event, not a new Markdown file.
3. Both pages use the JustMaple design system for light and dark appearance. The polished Today concept guides layout and density. `_Maple` supplies selected components, not a second theme.
4. Sources represents immutable received observations, one row per event revision. A source entity may have multiple revisions; the detail view groups those revisions without hiding them from the table.
5. Classification and further analysis are separate processing stages. Show the actual selected provider, including Jev where used; do not label every classifier as Jev. Jev remains the rollout default until the pinned Laya candidate passes its bundled quality gate. Preserve explicit selections and never silently fall back from explicitly selected Laya to Jev. Extraction provider selection is independent. Observed entity state and task completion remain separate concepts.
6. Local collaboration is between the human and Maple on the same Mac, through Tiptap + Yjs. Markdown remains the durable prose authority; there is no network collaboration server or second writable prose database. iCloud continues to transport files to iPhone. The current managed daily-note phone surface is read-only; this release does not add phone coediting. Full provider diagnostics stay Mac-only.
7. Successful eligible core results enter the actual Today document as Action items or FYI. There is no separate suggested-follow-ups panel to review before they can appear. Refreshing a note does not request new classification or extraction.

### Relationship to existing requirements

Together with the [main product PRD](PRD-JUST-MAPLE.md), this specification replaces the earlier Overview-first landing experience. It supersedes the daily-prose ownership and route portions of [LIVING-DAILY-NOTE.md](LIVING-DAILY-NOTE.md), which remains a legacy migration reference. It retains stable identities, version checks, recoverable history, clear-versus-complete semantics, source ingestion invariants, privacy boundaries, and pending phone commands. Existing notebook files and SQLite history must survive migration.

## Scope

| Required for this release | Deferred |
| --- | --- |
| Dated Markdown Today workspace; past/future days; shared notebook editor; rich text and Markdown source mode | Network collaboration, multi-Mac simultaneous writers and editable phone Today |
| Local human/Maple collaboration while typing, with separate undo ownership | Arbitrary autonomous rewriting of user prose |
| Email, iMessage, calendar, Home Assistant, recording and task references mixed with writing | New email/message/HA connectors, arbitrary external automation and email sending |
| Inline submitted Maple requests, durable status, evidence-backed inline replies | Background agent rewriting of arbitrary user prose |
| Sources table with type, connector/account, processing state, date and search filters | Remote knowledge backend, new search service or collector enrollment |
| Original content, observed state, processing timeline, recorded classifier and further-analysis responses | Bulk retry, bulk delete and global queue administration redesign |
| Same source renderer and inspector used in notes and Sources | Recording capture/transcription pipeline; launch can attach/play existing recordings |
| JustMaple light/dark tokens and keyboard-accessible interaction | Additional custom themes and visual redesign of every existing route |
| Safe migration, draft recovery, versioned phone compatibility | Full source-response payload replication to phone |

## Today experience

### Open and navigate

- The primary sidebar contains Yesterday, Today, Tomorrow, notebooks, Sources, and existing Connections/settings access. Preserve onboarding and workspace tools.
- Use the app iCloud Documents container’s `Just Maple` folder for daily notes, with numeric `YYYY/MM` subfolders. Ignore old daily-notebook selections. When iCloud is unavailable, show a recoverable error and retain drafts; never fall back to a local or arbitrary notebook. Previously registered notes remain accessible at their original locations through Notebooks and document links; do not silently move or duplicate them.
- `/today`, `/yesterday` and `/tomorrow` are navigation shortcuts. Each activation resolves the real local date and redirects to its explicit dated-document route. Only the selected day is created; a visit to tomorrow does not perform today's processing or carry-forward.
- A compact date chip uses relative labels such as Today, Yesterday, Tomorrow and 2 weeks ago, with the exact date accessible. Sidebar active styling compares the open document's date with the current local dates; it does not depend on the shortcut last clicked.
- At midnight, foreground return or a time-zone change, recalculate relative labels and sidebar styling. Keep the open document ID, file, selection and draft pinned. The former Today can become Yesterday while the user keeps writing; only navigation opens the new Today.
- Keep notebook breadcrumbs, the full filename, previous/next controls, decorative date/title text, persistent save labels and document-management panels out of the writing surface. Do not insert any of them into saved prose. Source mode and history remain available through secondary document controls; failures and recovery notices must remain actionable without obscuring the draft.

### Write and collect

The central surface is one continuous Tiptap document: paragraphs, headings, lists, checklists, links, code and tables. Enter creates another paragraph; `/` or “Add a block” opens insertion options. Writing can appear before, between and after references. Autosave status is available unobtrusively in app chrome or document controls; recovery, conflict and unavailable states are explicit. Navigation waits for a recoverable save or keeps the draft and clearly explains the failure.

Today and notebooks expose the same recovery choices. Saving a recovery copy must not require the failing original save or draft write to succeed, and must leave the original editor and any newer typing intact. A retained Maple response can be retried at its anchor without submitting another model request. Source pickers and inspectors acquire keyboard focus when opened, contain keyboard navigation while modal, and return focus to the opener without moving the document on close.

Today and notebooks share one editor implementation: the bottom floating formatting toolbar, searchable slash menu, Markdown typing shortcuts, selection bubble menu, block grips/actions, smart paste, code/table controls, attachments and source cards. Use the JustMaple light/dark tokens for all of them. There is no permanent top formatting bar. Move preserves block identity; duplication and pasted copies allocate new identities. Pasted styling is normalized without discarding meaningful content. Unsupported Markdown remains recoverable in source mode.

Headings define collapsible sections. The rail's train-stop dot toggles its heading's section, with keyboard operation and announced expanded/collapsed state. Folding hides content without deleting it or changing source/task state. Do not introduce a separate collapsible-block primitive for the same purpose.

| Block | What the reader sees | Supported actions |
| --- | --- | --- |
| Email | Sender, subject, compact preview, received time, connector/account, processing summary | Expand, open original, state history, remove/clear reference |
| iMessage | Person/thread, preview, time, source and processing summary | Same shared inspector; unsupported original links explain why |
| Calendar | Event title, calendar name, actual start/end time, location and compact notes | Open shared inspector/original; automatic inclusion requires overlap with the note's day |
| Home Assistant | Entity name and the observed transition, e.g. front door `closed → open`; observed time | Inspect original observation, processing and related evidence |
| Recording | Title, duration, play/pause and optional existing transcript | Play authorized local media, expand transcript, inspect provenance |
| Task | Checkbox, task text, linked-task indication where applicable | Complete/reopen, inspect task, clear attention, move |
| Maple request/reply | Editable draft prompt, explicit submit, then status and inline response with citations | Cancel queued work where possible, retry, inspect run, keep/edit reply |

Source cards follow the polished mockup: restrained border, slim colored rail, source icon, sender or calendar name, compact date/type, subject and excerpt. Technical processing summaries, JSON, routing probabilities, prompts and IDs live in the inspector. A missing source keeps a readable reference with “Source unavailable”; it never appears as an empty paragraph. Source data refreshes without replacing neighboring writing, user annotations or cursor position.

### Incoming context belongs in the document

The context connector consumes existing successful core results. It adds linked blocks under stable **Action items** and **FYI** headings in the current real day's document. User writing may surround those blocks. Cleared items, organization controls and document history belong in contextual or secondary controls, not a permanent panel below the note.

| Existing result | Note behavior |
| --- | --- |
| Eligible canonical open/in-progress task | Linked task in Action items; canonical state is shared wherever referenced |
| Successful unread notify/ask-user decision | Source reference in Action items; do not invent a canonical task merely to show attention |
| Successful summarize decision still proposed | Source reference in FYI; its excerpt is original source content, not a fabricated AI summary |
| Retained, failed, unfinished, inactive or superseded result | No automatic note insertion; evidence and truthful processing state remain in Sources |

Unscheduled sources require both occurrence and receipt within the preceding 24 hours. Scheduled tasks may be overdue. Calendar references additionally require a valid captured start/end interval overlapping the note's local day; an event next month does not belong in Today merely because it arrived today. Manual references remain user-controlled. Remove an incorrectly auto-inserted out-of-day calendar card only when it is unchanged; preserve edits and history.

A Home Assistant ten-minute batch contributes at most one automatic source card, backed by its linked changes and available prior-state evidence. Show a bounded factual preview and remaining count. Do not imply that every entity caused the batch decision, invent an emergency, or send one classification request per entity. Classification works on the batch; rendering, polling and document refresh make no additional model calls.

Bound the automatic projection: currently at most 64 automatic blocks per day and 32 source cards per refresh, with attention before FYI. Overflow remains inspectable in Sources. Deduplicate source/task identities, preserve cleared/moved/deleted suppression, and never recreate headings the user removed. An empty note does not claim that the entire queue is processed or that nothing needs attention.

### Human and Maple editing together on Mac

- While the formatted document is open, Maple applies anchored block changes to the same live Tiptap/Yjs document as the human. Normal typing, selection or an in-flight autosave must not require waiting for the user to stop.
- Preserve the caret, selection, block identities and existing prose. Do not reload or replace the entire editor when a source or reply arrives.
- Human Undo/Redo affects human edits; it must not undo an independent Maple arrival. Canonical task actions keep their separate versioned semantics.
- Save the merged document through the existing Markdown coordinator. A displayed insertion is not a durable acknowledgment until the commit succeeds. Retain recovery drafts and accepted-delivery identities so retry/restart cannot duplicate or resurrect a deleted arrival.
- Raw Markdown mode, IME composition, incompatible anchor changes or unresolved file conflicts may defer insertion. Resume when safe; retain results in history if their anchor is no longer valid. Do not overwrite a draft to catch up.
- Local Yjs state is an editing mechanism, not a second saved prose authority. This does not promise CRDT merging of independent iCloud file edits or concurrent Mac/phone writers.

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

Source references enter through user insertion, inline search results or the bounded automatic context connector described above. Incoming results modify the document through protected block operations. Unfinished tasks can be offered for carry-forward on entering Today; accept through the same versioned move operation. Do not auto-move arbitrary prose or flood Today with every received message.

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
| Classification | Classification stage status and actual provider, including Jev or an explicitly selected eligible alternative |
| Further analysis | Aggregate of applicable branches; expandable to their individual states |
| In notes | Linked notes/count; “Add to Today” is available from the row/detail |

Filters combine with AND across dimensions: Type; Source (connector plus account); processing state; received-date range; text search. Selecting multiple values within one dimension uses OR. For example `Type = Email` and `Source = Gmail / Work` must exclude personal Gmail and iMessage. Chips show active filters; Clear filters resets them. URL query state supports Back/Forward without leaking message content into URLs; text search stays session-local.

New arrivals show “New entries available” while browsing a page snapshot, avoiding row jumps. Refresh preserves filters. Results are bounded and stable even when processing changes while the user pages; engineering defines the query-session contract.

Pending work must be explainable: show queued versus actively running work, the stage/provider processing it, and whether processing is paused, retrying or blocked. A paused queue is not displayed as running. Status inspection must not submit another model request.

### Detail and state history

A drawer on wide screens and a full detail route on narrow screens share one inspector. Provide Summary, History and Responses views:

- **Summary:** original content, immutable event ID/revision, source/account, received/occurred timestamps, observed entity state, related task/evidence and linked note locations.
- **History:** chronological, durable stage transitions and attempts, start/end/duration, retry/reprocess relationships, routing decisions and why a stage did not run. Expand independent branches rather than implying a single linear pipeline.
- **Responses:** actual recorded classifier response and submitted context, provider/model, schema/prompt versions, evidence IDs; corresponding downstream responses and parsed/applied result. Large payloads load on demand. Safe error categories replace private HTTP error bodies.

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
| T6 | Cross midnight or change time zone while typing: date-chip labels and active navigation update, but the document, caret and draft stay pinned. Clicking Today opens the correct newly resolved date. |
| T7 | Receive eligible email, iMessage, HA-batch and same-day calendar references while typing: content merges once without remounting or moving the selection. An out-of-day calendar event is excluded. |
| T8 | Receive a Maple reply during typing or an in-flight save: preserve both writers, isolate human Undo/Redo, and persist one response. Deleting an arrival before autosave stays deleted after retry/recovery. |
| T9 | Raw-mode or composition deferral retains pending results; formatted editing resumes safely. A changed/deleted request preserves its result in history without inserting at an unrelated position. |
| T10 | Today and notebooks share editing, source rendering and recovery behavior. Heading-dot folding, shortcuts, paste, drag/reorder and save/reopen preserve content and stable IDs. |
| S1 | Sources includes received emails, messages and HA events present in the store; type/account filters combine correctly across pages with no duplicate/missing snapshot rows. |
| S2 | Detail shows observed state separately from processing; each recorded classifier/downstream attempt shows actual retained context/output or an explicit unavailability reason. |
| S3 | Failed/retried/discarded and intentionally skipped stages stay distinguishable. No synthetic success fills a live failure. |
| S4 | Insert an event into Today and another notebook: both reference the same evidence and open the same inspector. Removing one reference leaves the other intact. |
| S5 | Pending, running and paused work is identifiable. Repeated status/proposal polls create no provider requests; retries and HA batch members do not duplicate processing effects. |
| U1 | Today, Sources, inspector, menus and error states pass keyboard and light/dark visual review with JustMaple tokens only. |
| C1 | Phone never treats a queued command, file arrival or stale snapshot as Mac acceptance; unsupported/new protocol states fail visibly and preserve edits. |
| C2 | Phone reads the same daily Markdown via iCloud in read-only mode. Missing/downloading files show retry states and are never replaced with empty notes; file freshness is distinct from Mac processing freshness. |
| M1 | Migration preserves old daily IDs/history/tombstones and never overwrites an existing same-date Markdown file. |

## Release evidence

Current September 30 verification is tracked in the [completion audit](../../plans/today-and-sources/evidence/COMPLETION-AUDIT-2026-09-30.md): 357 Angular, 427 Core, 30 transport and 76 Mac tests, synthetic source/editor journeys, 10,000-event query p95 64.62 ms and a fresh signed Mac build. Physical-device, native accessibility/input-method and independent human quality gates remain open.

The September 29 local-collaboration build passed 372 core, 30 transport, 250 Angular and 71 Mac tests, plus three synthetic browser suites covering live arrivals, writing and editor extensions. The Mac build and strict signature verification passed. These results establish the tested local storage/editor behavior, not live provider accuracy or physical-iPhone validation. Evidence: [local collaboration journey](../../scripts/local-collaboration-smoke.mjs), [writing journey](../../scripts/writing-source-journey.mjs), [editor interactions](../../scripts/editor-extensions-smoke.mjs), and [context connector validation](../engineering/TODAY-CONTEXT-CONNECTOR.md).

Ship only after the build plan's persistence, provider-history and end-to-end gates pass. Record measured editor responsiveness at the existing 256 KB file limit, a Sources fixture with at least 10,000 events, and UI paging behavior. Targets are input-to-paint p95 under 50 ms and warm first-page query p95 under 200 ms on the development Mac; these are acceptance targets to measure, not claims of current performance. Separate synthetic transport/storage tests from consented live-provider quality evaluation. Do not add telemetry of private notes, mail, prompts or provider payloads to measure adoption.
