# Just Maple — Product Requirements

Version 0.3 · September 30, 2026 · **Notes-first product direction**

This revision adopts Notes as the main surface and Today as the default entry point. The [Notes, Today and Sources PRD](PRD-TODAY-AND-SOURCES.md) defines the detailed interaction and acceptance contract. Earlier Overview-first layouts are superseded; source, evidence, task-correctness and privacy requirements remain in force.

This document describes the product we are building, the current baseline, and the proposed next releases. Existing user decisions are identified separately from proposals. It does not claim that proposed capabilities are implemented or that implementation alone proves product quality.

## 1. Product vision

**Just Maple helps you know what needs you, understand why, and take the next step.**

Information arrives through messages, email, calendars, notes and connected services. Maple brings that information together, understands it in context, and maintains an evolving picture of your life. It surfaces concrete actions and meaningful changes while preserving the evidence behind its conclusions.

**Notes is where the user works; the intelligent core brings relevant context into that work.** Today combines the user's writing with actionable tasks, useful information, source references and inline Maple replies in one dated Markdown document. Other notebooks use the same editor. Sources provides evidence and processing inspection when needed. The Mac is the processing and editing hub; iPhone receives daily-note files through iCloud, with managed daily notes currently read-only.

Success means less time reconstructing context and checking for missed obligations. More imported records, tasks or model calls do not by themselves mean success.

## 2. Who we are building for

The initial user manages responsibilities across personal life, family and work, with information scattered across several applications. They want help remembering and deciding what matters, without maintaining a project-management system or granting an assistant permission to speak on their behalf.

Initial validation is single-user daily use on Mac and iPhone. Broader onboarding and distribution follow once the daily experience is dependable.

Core jobs:

1. Give me one place to write, see what needs my attention and work with Maple without leaving the note.
2. Keep track of what I am waiting for without making it look like unfinished work I can act on now.
3. Connect related people, messages, notes and events without requiring me to organize everything.
4. Explain what you believe, where it came from, and let me correct it.
5. Make my information and actions available across my devices.

## 3. Product model

| Concept | Meaning | Expected behavior |
|---|---|---|
| Observation | Something received from a source | Preserve its source, time and revision; index locally |
| State | What is believed true at a particular time | Show evidence, freshness, uncertainty and corrections |
| Activity | An ongoing area or temporary pursuit | Connect people, state, documents, events and tasks |
| Task | A concrete obligation or next step | Identify the action, responsibility, timing and progress |
| Person | Someone relevant to the user's world | Join identities conservatively; prioritize pins and meaningful interaction |
| Daily note | The user's dated Markdown workspace | Own writing and block order; receive bounded context for that day without disrupting edits |
| Notebook | A folder containing Markdown notes | Use the same editor as Today and contribute observations to the same intelligence system |
| Source reference | A block pointing to immutable evidence | Render compactly in the note and open the shared Sources inspector; removing it does not delete evidence |
| History | What changed and why | Preserve prior evidence and decisions without confusing them with current state |

Tasks can have several Activity tags. Completing a task once completes that same task wherever it appears. An Activity can exist without tasks. A person's current behavior, such as working, is distinct from an Activity such as a long-running pursuit.

Examples throughout this PRD illustrate behavior; they are not seeded categories, sender rules or prompt exceptions.

## 4. Established product decisions

- Learning runs automatically. The user should not have to start a processing loop.
- Maple **never automatically sends a reply**. Marking a task complete, opening its source or generating a future draft does not send anything.
- New and historical observations remain eligible for local indexing. Jev and other AI providers receive only evidence within the existing rolling 30-day policy. Importing an old message does not make it new.
- Activity labels must emerge from evidence or explicit user input. Do not hardcode the user's example companies or life categories.
- Eligible detected tasks appear as canonical linked tasks in the note's Action items; existing task views remain supporting tools. No separate Suggested task category or acceptance panel is required.
- User corrections take priority and must survive retries, source revisions and subsequent inference.
- Local SQLite belongs to the Mac. iCloud connects the companion automatically and retries without an enable/pair/reconnect workflow in normal use.
- Use the existing Apple app identity, proper Xcode projects, hybrid WebViews, Angular UI and shared Maple components with automatic light/dark themes.
- Today resolves to `Just Maple/YYYY/MM/YYYY-MM-DD.md` in the app's iCloud Documents container. Other notebooks retain their connected folders and file ownership. Markdown owns writing and order; SQLite owns immutable evidence, canonical tasks, identities/history and recoverable mutation records.
- Today, Yesterday and Tomorrow are route shortcuts resolved from the real local date when selected. Midnight updates their labels and active styling without navigating or changing the file being edited.
- Today and notebooks share the Angular/Tiptap editor, JustMaple light/dark design system and bottom floating toolbar. Use focused JustMaple/SugarMaple interaction patterns, not a second editor implementation.
- The human and Maple edit together locally on the Mac through Tiptap + Yjs. Incoming blocks and replies preserve cursor, selection, human undo and recovery. Saved Markdown remains the only durable prose authority; no network collaboration service is required.
- Relevant successful results enter the actual note as Action items or FYI. A future calendar event must not appear in Today merely because it was just imported. Note refresh and rendering do not make new model requests.
- Failures, uncertainty and incomplete coverage must be distinguishable from successful processing with nothing found.

## 5. Current baseline

These capabilities are implemented to varying degrees. They are not a claim of comprehensive live accuracy or complete device parity.

| Area | Present today | Important limitation |
|---|---|---|
| Sources | Gmail, Messages, Apple/Google calendars and contacts, Home Assistant, notes and profile/resume intake | Permissions, connection health and bounded imports affect coverage |
| Intelligence | Jev classification; selected-provider extraction; automatic state/activity/task work | Broad quality evaluation remains incomplete |
| Memory | Local keyword and semantic indexing with persistent jobs | Apple English embeddings, exact vector comparison; not a general resolved knowledge graph |
| Tasks | Ranked detected/manual tasks, evidence, editing, tags, recurrence, duplicate/progress reconciliation | Outstanding obligations and waiting work can be poorly prioritized |
| Activities | Discovery, many-to-many links, rename/move/merge/remove controls | Relevance and concise grouping still need quality evaluation; these are supporting views |
| People and state | Important-person ranking, conservative identity grouping, evidence-backed state and corrections | Identity is not propagated consistently into every contextual consumer |
| Notes main surface | Today plus shared notebook editor, relative-date navigation, compact source cards, inline Maple and automatic Action items/FYI | Not every ingested event is eligible; source mode and unresolved conflicts can defer live insertions |
| Local editing | Human/Maple Tiptap + Yjs transactions; atomic local session state, bounded draft writes, owner-safe handoff, separate undo and durable delivery recovery | Same Mac only; this is not CRDT merging of independent iCloud file edits |
| Mac/iPhone | Daily Markdown saved by Mac and read from the same app iCloud path on phone; existing companion task actions remain separate | Managed daily notes are read-only on phone; full provider evidence stays Mac-only |
| Latest validation | September 30 source-inspection/editor delivery: 357 Angular, 427 Core, 30 transport and 76 Mac tests; 10,000-event Sources query p95 64.62 ms; synthetic browser acceptance and signed Mac build | See the [completion audit](../../plans/today-and-sources/evidence/COMPLETION-AUDIT-2026-09-30.md) for earlier iPhone/provider checks and scope; live model quality, real-world sync latency and physical-device validation remain separate gates |

The September 23 product audit observed 115 open tasks, 27 activity cards and 48 tasks grouped under one screen-time activity. The old Overview placed waiting work among its first three attention rows. These historical observations motivate relevance and attribution evaluation; they are not current counts or a scored benchmark.

## 6. Release focus: a trustworthy living note

**Outcome:** The user opens Today, writes freely, receives useful context in place, and can understand, act on or clear it without leaving the document.

The Notes main surface is built. Remaining work hardens its reliability and the usefulness of what enters it, using the existing connectors and intelligence foundation. The [Notes, Today and Sources contract](PRD-TODAY-AND-SOURCES.md) governs presentation; [shared task contracts](DAILY-ACTIONS-CONTRACT.md) retain lifecycle and correction semantics. Dynamic activity curation and broad change summarization remain later work.

### R1. Identify outstanding obligations

For each detected action, Maple must distinguish:

- What needs to happen and who is responsible.
- Whether the user can act now or is waiting on someone else.
- Explicit deadline, inferred timing and optional follow-up time.
- Evidence of completion, cancellation, supersession or loss of relevance.
- Uncertainty requiring review.

A request, promise, acknowledgment or elapsed deadline is not proof of completion. Later evidence may resolve an obligation only when it supports that conclusion. Repeated requests for the same obligation should consolidate with all evidence preserved; different obligations involving the same person or company remain separate.

Source-supported expiry may remove an item from the actionable surface with an explanation and a way to recover it. Ambiguous aging alone must not silently discard responsibility. User-owned tasks must not be automatically merged merely because they resemble one another.

### R2. Separate attention from waiting

The note's Action items should distinguish actions the user can take from waiting work. Supporting task views offer **Needs you**, **Waiting**, and completed/history access, with Activity filters applying consistently. Do not force those views or their management controls into a panel below the document.

Needs you ranks actionable obligations using supported urgency, explicit priority and relevant context. Each item provides a brief reason for its position. Waiting items retain their deadlines and evidence in the Waiting view; a due date alone does not turn blocked work into a user action. If a supported or user-chosen follow-up becomes due, surface that follow-up explicitly.

Do not translate an activity milestone or future start date into a deadline for every associated task. Show uncertain timing as uncertain.

An automatic follow-up whose originating obligation is rejected, superseded or removed must leave active attention if the follow-up is still untouched. Preserve user-edited or explicitly resolved follow-ups. Retiring a review is not completion of its original obligation; undoing dismissal may restore the same review identity.

### R3. Make task details useful before editable

The default task detail contains:

1. A concrete action title and concise next-step explanation.
2. Responsibility, supported timing and Activity tags.
3. Why it matters now, with source access and relevant evidence.
4. Available actions, with editing as a secondary option.

Detected and manual tasks use the same primary experience. Detected items do not require an “Add task” step before they can be resolved. Internal review/provenance distinctions can remain in storage and secondary inspection.

Unrelated edits preserve supported timing exactly: date-only values, exact instants and independent due/scheduled time zones. Applying a draft uses the task, suggestion and recurrence versions loaded with that draft. A newer live revision must produce a recoverable conflict or require explicit reload, never silently receive an older draft under its new version.

| User action | Required meaning |
|---|---|
| Open source | Open the exact source or an inspectable fallback; never mark complete |
| Done | Record explicit completion with undo |
| Later | Choose when it resurfaces; preserve the original deadline and warn if deferral passes it |
| Waiting | Record who/what is awaited and an optional review time |
| Not needed | Remove from active attention without claiming completion; retain history and undo |
| Edit / Correct | Change interpretation, responsibility, timing or tags without rewriting source evidence |

Supported source navigation must work appropriately on each platform. When direct navigation is unavailable, show the source details and a clear explanation rather than a dead button. Provider names, uncalibrated confidence values and extraction forms belong in secondary inspection.

### R4. Deliver a focused Notes surface

- **Today:** a continuous document containing the user's writing, tasks and compact evidence cards. Use a relative-date chip and bottom floating toolbar; remove decorative file/date/title headers and permanent management panels from the writing area.
- **Action items / FYI:** eligible core results arrive as real document blocks. Preserve user edits, stable IDs and cleared/deleted suppression. Calendar timing uses the actual event interval; Home Assistant contributes a factual batch reference rather than an entity-by-entity flood.
- **Inline Maple:** explicit submission runs a request anchored to its block. Insert the result beside that request while the user continues typing; edited or missing anchors retain an unapplied result in history.
- **Notebooks:** the same editor, formatting, source cards, heading-rail folding and recovery behavior as Today. Notes need no mandatory title or scaffold text.
- **Sources:** a supporting table with type/account filters, observed state, queued/running/paused processing and actual retained responses. A card in a note opens the same inspector.

An open document stays pinned through midnight and time-zone changes. Relative labels and sidebar styling update independently; selecting a day shortcut resolves and opens the correct date. Live content changes preserve selection, caret and human Undo/Redo, including during autosave. Raw Markdown mode and conflicts defer proposals safely.

Automatic additions are bounded; excess and ineligible evidence stays in Sources. A quiet note does not mean all processing has finished or no obligations exist. Coverage, processing freshness and failures must remain inspectable without turning the note into a diagnostics dashboard.

### R5. Make correction and sync trustworthy

Mac and iPhone share task presentation, terminology and action semantics. A phone action is stored durably before the UI acknowledges it; distinguish pending sync, applied and conflict. Retry must produce one effect. Undo must not overwrite a newer conflicting change silently.

Explicit dismissal or status correction must not be undone by re-extracting the same obligation under a new record ID. Genuinely new requests remain eligible and must be distinguishable from retries or revised copies.

Automatic iCloud operation remains the default. Show last Mac processing freshness separately from transport sync. Cached data remains usable when the Mac is unavailable; explain queued changes without requiring manual reconnect.

### R6. Preserve notebook reliability

Verify the latest download handling on the physical iPhone. Opening a listed note must either load its contents or show a clear recoverable download state. It must never replace an unavailable note with a blank file. Editing must preserve Markdown, recovery drafts and concurrent-change protection.

Use one shared editor implementation for Today and notebooks. Validate Markdown shortcuts, paste, source/attachment controls, heading folding, drag/reorder, local human/Maple edits and save/reopen. Managed daily notes remain read-only on phone and read the Mac-owned Markdown through iCloud; file arrival is not acknowledgment of a phone command. Full folder observation and phone-edit-to-intelligence coverage belong to the later memory milestone.

## 7. Acceptance scenarios

| Scenario | Required result |
|---|---|
| New request to provide availability | Specific availability action, linked source and justified timing |
| Another person says they will bring something | Attribute the promise to that person; do not invent a user obligation |
| Later evidence says submitted information is being processed | Move the supported obligation to Waiting; keep the evidence |
| Repeated copies of one request | One visible obligation with retained supporting sources |
| Two different actions from the same organization | Two obligations; organization identity alone is not a merge rule |
| Short-lived request with supported expiry | Explain loss of relevance; do not label it completed |
| User chooses Later | Resurface at the selected time without altering the source deadline |
| User dismisses an incorrect action | Stay dismissed through retry/revision; undo remains available |
| Task action made while Mac is unavailable | Show pending, retain across restart, apply once after reconnect |
| Phone has stale or partial data | Explain freshness/scope; do not imply all sources are current |
| iCloud note contents are not downloaded | Wait or show retry; preserve original contents |
| Midnight while writing yesterday's Today | Keep the file and draft open; update relative labels and active styling; Today shortcut resolves the new date |
| Eligible source or Maple reply arrives while typing | Merge once in place; preserve caret, user text and human Undo/Redo through save/restart |
| A next-month calendar event is imported today | Keep it inspectable in Sources; do not automatically insert it into Today |
| User deletes an incoming block before autosave | Preserve suppression through retries and recovery; do not resurrect it |
| User checks queued processing | Distinguish queued, running, paused and failed work with stage/provider; inspection causes no new model calls |

Use diverse held-out examples. The user's recruiting, renewal and household examples are acceptance categories, not the whole evaluation set.

## 8. Quality and release gates

Before tuning, label a stratified sample of 100 recent messages (30 conversational/informational, 30 direct obligations, 20 waiting/delegated updates, 10 calendar/time-sensitive requests, 10 noise/transport updates) and a separate sample of 50 visible tasks. Include actionable messages, quiet negatives, already-resolved work, waiting work, repetition and short-lived requests. Mark ambiguous cases separately. Evaluate recall from the source-message sample, not only from tasks the system already found.

Proposed quality targets for review:

- At least 90% of the first ten Needs you items judged actionable/useful across the evaluation snapshots.
- At least 85% recall on clearly labeled obligations in the held-out message sample.
- No unsupported automatic completions in the evaluated sample.
- No duplicate effects or lost acknowledged commands in reconnect/restart tests.
- Corrected test obligations stay corrected through reprocessing and source revisions.
- Existing editable notebook files open and save safely on the physical phone; concurrent edits preserve recovery. Managed daily notes load safely in read-only mode, including missing/downloading-file states.
- No automatic messages, bookings or external task execution.

These are proposed targets, not measured results. Report denominators, ambiguous cases and failure examples. Passing a small sample does not establish universal accuracy. Run the existing storage, provider, Angular and native regression suites for the affected behavior.

Track time to first useful result, missed obligations, unnecessary note insertions, correction rate, source-to-note delay and pending-sync age. Measure editor responsiveness and lost/duplicate edits separately from model quality. Evaluate whether the user can write and act on the next obligation directly in the note without visiting diagnostics. Keep private note/message content out of telemetry.

## 9. What follows

| Milestone | Product outcome | Main scope |
|---|---|---|
| Current: Notes reliability and relevance | A dependable living daily note with useful incoming context | R1–R6 above; complete remaining persistence, performance and live-quality gates |
| Context refinement | Relevant activity curation and meaningful change summaries | Improve what reaches notes and supporting views; no transport noise in user summaries |
| Connected context | Maple understands relationships and changes across sources | Propagate identity into tasks/activities/retrieval; identity correction UI; distinguish current state from future transitions; carefully attributed calendar/HA signals |
| First-session value | A new user gets help before configuring everything | Name → one source → useful results → first correction/action; optional résumé; understandable provider/data explanation |
| Dependable memory | Useful information can be found and updated reliably | Folder observation, phone-note ingestion, retrieval evaluation, source navigation, retention/export/forget behavior and derived-data invalidation |
| Distribution and broader capture | Dependable use beyond the development setup | Planned API intermediary, release hardening, then recording/widgets and additional inputs based on demonstrated need |

Activities remain automatically discovered and editable throughout. Subsequent curation should improve relevance, concise naming and reversible regrouping without imposing a fixed taxonomy. No delivery dates are committed in this draft.

## 10. Out of scope for the next release

- More connectors as a substitute for improving existing results.
- A general chat assistant, graph visualization or new vector backend.
- Automatic replies, purchases, bookings or Home Assistant control.
- New push notifications or a scheduled digest before their interruption policy is reviewed.
- A second notebook editor implementation or project-management hierarchy.
- Network collaboration, simultaneous multi-Mac writers or editable phone Today as part of the local Mac collaboration delivery.
- Claims of continuous phone processing when the Mac is unavailable.

## 11. Decisions and remaining review

| Decision | Direction | Status / remaining review |
|---|---|---|
| Primary daily habit | Open Today, write and act in the note | Established; supersedes Overview-first navigation |
| Incoming context | Bounded Action items and FYI in the document | Established; evaluate relevance and noise with real use |
| Editing model | Shared Angular/Tiptap editor with local human/Maple Yjs collaboration | Built; retain recovery and concurrency regression gates |
| Phone scope | Read managed daily Markdown through iCloud | Read-only in this release; editable phone Today is a separate scope |
| Detected task handling | Directly actionable, same detail as manual tasks; no mandatory acceptance step | Removes the current inconsistency between the list and review form |
| Ambiguous stale requests | Keep inspectable and ask for correction; expire only with supporting evidence | Avoids both an endless backlog and silently lost obligations |
| Reply assistance | Source navigation now; optional user-requested drafts later | Preserves the absolute no-auto-send requirement |
| Memory older than 30 days | Keep current restriction for model context | Any persistent-memory exception requires an explicit policy decision |
| Quality bar | Proposed sample/targets in section 8 | Must be baselined before estimating remaining quality work |

Approval of this PRD sets product direction; it does not approve deleting existing user data, changing personal task statuses, or weakening established privacy and messaging constraints.

## 12. Related documents

- [Product audit and observed gaps](PRODUCT-AUDIT-2026-09-23.md)
- [Notes, Today and Sources requirements](PRD-TODAY-AND-SOURCES.md)
- [Today and Sources engineering design](../engineering/TODAY-AND-SOURCES.md)
- [Automatic context connector and validation](../engineering/TODAY-CONTEXT-CONNECTOR.md)
- [Architecture and implementation boundaries](../ARCHITECTURE.md)
- [Local intelligence and model-processing policy](../ARCHITECTURE.md)
- [Task reconciliation](../ARCHITECTURE.md)
- [Activity discovery](../ARCHITECTURE.md)
- [iPhone companion and validation status](../ARCHITECTURE.md)

The established Notes-first decisions in this revision supersede conflicting Overview-first and review-first presentation in older specifications. Proposed quality targets and future milestones remain explicitly subject to validation; they are not claims of implementation or measured accuracy.

## Approved specification refinements

The [daily-actions contract](DAILY-ACTIONS-CONTRACT.md) defines lifecycle, identity, aggregation and mutation semantics. Mac shortcuts are E (Done), L (Later), W (Waiting), and Delete (recoverable Not needed), active only for a selected task outside editable controls. Source fallback includes preserved content, sender, source timestamp and copy controls; missing content is explicit. Model confidence is not a ranking tie-breaker. The observed task counts remain an unlabeled baseline snapshot, not a scored benchmark.
