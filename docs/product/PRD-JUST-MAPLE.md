# Just Maple — Product Requirements

Version 0.2 · September 23, 2026 · **Direction approved; implementation in progress**

This document describes the product we are building, the current baseline, and the proposed next releases. Existing user decisions are identified separately from proposals. It does not claim that proposed capabilities are implemented or that implementation alone proves product quality.

## 1. Product vision

**Just Maple helps you know what needs you, understand why, and take the next step.**

Information arrives through messages, email, calendars, notes and connected services. Maple brings that information together, understands it in context, and maintains an evolving picture of your life. It surfaces concrete actions and meaningful changes while preserving the evidence behind its conclusions.

The intelligent core is the product. Notes are one source and a useful everyday workspace. The Mac is the processing hub; the iPhone provides access, capture and actions wherever the user is.

Success means less time reconstructing context and checking for missed obligations. More imported records, tasks or model calls do not by themselves mean success.

## 2. Who we are building for

The initial user manages responsibilities across personal life, family and work, with information scattered across several applications. They want help remembering and deciding what matters, without maintaining a project-management system or granting an assistant permission to speak on their behalf.

Initial validation is single-user daily use on Mac and iPhone. Broader onboarding and distribution follow once the daily experience is dependable.

Core jobs:

1. Tell me what needs my attention and what I can do about it.
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
| Notebook | A folder containing Markdown notes | Provide a clean editor and contribute observations to the same intelligence system |
| History | What changed and why | Preserve prior evidence and decisions without confusing them with current state |

Tasks can have several Activity tags. Completing a task once completes that same task wherever it appears. An Activity can exist without tasks. A person's current behavior, such as working, is distinct from an Activity such as a long-running pursuit.

Examples throughout this PRD illustrate behavior; they are not seeded categories, sender rules or prompt exceptions.

## 4. Established product decisions

- Learning runs automatically. The user should not have to start a processing loop.
- Maple **never automatically sends a reply**. Marking a task complete, opening its source or generating a future draft does not send anything.
- New and historical observations remain eligible for local indexing. Jev and other AI providers receive only evidence within the existing rolling 30-day policy. Importing an old message does not make it new.
- Activity labels must emerge from evidence or explicit user input. Do not hardcode the user's example companies or life categories.
- Detected tasks appear directly in the ranked task list; no separate Suggested task category is required.
- User corrections take priority and must survive retries, source revisions and subsequent inference.
- Local SQLite belongs to the Mac. iCloud connects the companion automatically and retries without an enable/pair/reconnect workflow in normal use.
- Use the existing Apple app identity, proper Xcode projects, hybrid WebViews, Angular UI and shared Maple components with automatic light/dark themes.
- Notes remain ordinary Markdown in the app's iCloud folders or manually connected folders. Preserve the reused Sugar Maple editor and file ownership.
- Failures, uncertainty and incomplete coverage must be distinguishable from successful processing with nothing found.

## 5. Current baseline

These capabilities are implemented to varying degrees. They are not a claim of comprehensive live accuracy or complete device parity.

| Area | Present today | Important limitation |
|---|---|---|
| Sources | Gmail, Messages, Apple/Google calendars and contacts, Home Assistant, notes and profile/resume intake | Permissions, connection health and bounded imports affect coverage |
| Intelligence | Jev classification; selected-provider extraction; automatic state/activity/task work | Broad quality evaluation remains incomplete |
| Memory | Local keyword and semantic indexing with persistent jobs | Apple English embeddings, exact vector comparison; not a general resolved knowledge graph |
| Tasks | Ranked detected/manual tasks, evidence, editing, tags, recurrence, duplicate/progress reconciliation | Outstanding obligations and waiting work can be poorly prioritized |
| Activities | Discovery, many-to-many links, rename/move/merge/remove controls | Too many activities can overwhelm the landing page |
| People and state | Important-person ranking, conservative identity grouping, evidence-backed state and corrections | Identity is not propagated consistently into every contextual consumer |
| Mac/iPhone | Shared Overview, automatic iCloud snapshots, phone capture and notebooks | Phone receives a bounded subset and has fewer correction controls |
| Latest phone changes | Task detail/completion and waiting for notebook downloads are built and tested | Physical-device deployment and verification of these changes remain outstanding at this baseline |

The product audit observed 115 open tasks, 27 activity cards and 48 tasks grouped under one screen-time activity. These counts identify usability and evaluation priorities; they do not establish that each task is wrong. The live Overview also placed a waiting-on-someone-else item among its first three attention rows.

## 6. Next release: a trustworthy daily action list

**Outcome:** The user can open Maple, identify what genuinely needs them, understand the source, and resolve or defer it in a few interactions.

This release finishes the daily action experience using the existing connectors and intelligence foundation. Overview work is limited to bounded lists, waiting isolation and transport-event suppression. Dynamic activity curation and complex change summarization are Milestone 2. See [shared contracts and delivery slices](DAILY-ACTIONS-CONTRACT.md).

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

Tasks should offer **Needs you**, **Waiting**, and completed/history access, with Activity filters applying consistently.

Needs you ranks actionable obligations using supported urgency, explicit priority and relevant context. Each item provides a brief reason for its position. Waiting items retain their deadlines and evidence in the Waiting view; a due date alone does not turn blocked work into a user action. If a supported or user-chosen follow-up becomes due, surface that follow-up explicitly.

Do not translate an activity milestone or future start date into a deadline for every associated task. Show uncertain timing as uncertain.

### R3. Make task details useful before editable

The default task detail contains:

1. A concrete action title and concise next-step explanation.
2. Responsibility, supported timing and Activity tags.
3. Why it matters now, with source access and relevant evidence.
4. Available actions, with editing as a secondary option.

Detected and manual tasks use the same primary experience. Detected items do not require an “Add task” step before they can be resolved. Internal review/provenance distinctions can remain in storage and secondary inspection.

| User action | Required meaning |
|---|---|
| Open source | Open the exact source or an inspectable fallback; never mark complete |
| Done | Record explicit completion with undo |
| Later | Choose when it resurfaces; preserve the original deadline and warn if deferral passes it |
| Waiting | Record who/what is awaited and an optional review time |
| Not needed | Remove from active attention without claiming completion; retain history and undo |
| Edit / Correct | Change interpretation, responsibility, timing or tags without rewriting source evidence |

Supported source navigation must work appropriately on each platform. When direct navigation is unavailable, show the source details and a clear explanation rather than a dead button. Provider names, uncalibrated confidence values and extraction forms belong in secondary inspection.

### R4. Deliver a focused Overview

Proposed initial layout:

- **Right now:** concise supported context; make uncertainty or a conflict understandable.
- **Needs you:** up to five relevant actions, with View all and an accurate count.
- **Waiting:** a compact summary with any follow-ups due.
- **Recent changes:** retain existing non-transport history. Suppress polling/transport noise; new semantic summaries and since-last-visit aggregation are deferred.
- **Activities:** up to six active activities in existing stable order, with View all. Dynamic relevance curation is deferred.

The item limits are proposed review defaults. A limited phone snapshot must disclose its scope rather than present its local count as the total world. Stable item identity should preserve expansion and interaction state while data refreshes.

“Nothing needs you” is appropriate only when coverage and processing are sufficiently current. Otherwise show what is still being checked or which source is unavailable. Technical diagnostics remain accessible without dominating Overview.

### R5. Make correction and sync trustworthy

Mac and iPhone share task presentation, terminology and action semantics. A phone action is stored durably before the UI acknowledges it; distinguish pending sync, applied and conflict. Retry must produce one effect. Undo must not overwrite a newer conflicting change silently.

Explicit dismissal or status correction must not be undone by re-extracting the same obligation under a new record ID. Genuinely new requests remain eligible and must be distinguishable from retries or revised copies.

Automatic iCloud operation remains the default. Show last Mac processing freshness separately from transport sync. Cached data remains usable when the Mac is unavailable; explain queued changes without requiring manual reconnect.

### R6. Preserve notebook reliability

Verify the latest download handling on the physical iPhone. Opening a listed note must either load its contents or show a clear recoverable download state. It must never replace an unavailable note with a blank file. Editing must preserve Markdown, recovery drafts and concurrent-change protection.

This release validates notebook basics; full folder observation and phone-edit-to-intelligence coverage belong to the later memory milestone.

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

Use diverse held-out examples. The user's recruiting, renewal and household examples are acceptance categories, not the whole evaluation set.

## 8. Quality and release gates

Before tuning, label a stratified sample of 100 recent messages (30 conversational/informational, 30 direct obligations, 20 waiting/delegated updates, 10 calendar/time-sensitive requests, 10 noise/transport updates) and a separate sample of 50 visible tasks. Include actionable messages, quiet negatives, already-resolved work, waiting work, repetition and short-lived requests. Mark ambiguous cases separately. Evaluate recall from the source-message sample, not only from tasks the system already found.

Proposed quality targets for review:

- At least 90% of the first ten Needs you items judged actionable/useful across the evaluation snapshots.
- At least 85% recall on clearly labeled obligations in the held-out message sample.
- No unsupported automatic completions in the evaluated sample.
- No duplicate effects or lost acknowledged commands in reconnect/restart tests.
- Corrected test obligations stay corrected through reprocessing and source revisions.
- Existing iCloud notes open and save safely on the physical phone; concurrent edits preserve recovery.
- No automatic messages, bookings or external task execution.

These are proposed targets, not measured results. Report denominators, ambiguous cases and failure examples. Passing a small sample does not establish universal accuracy. Run the existing storage, provider, Angular and native regression suites for the affected behavior.

Track time to first useful result, missed obligations, unnecessary attention items, correction rate, source-to-surface delay and pending-sync age. Evaluate whether the user can find and act on their next obligation without visiting diagnostics.

## 9. What follows

| Milestone | Product outcome | Main scope |
|---|---|---|
| Next: Daily actions | A manageable, actionable view of obligations | R1–R6 above |
| Overview refinement | Relevant activity curation and meaningful change summaries | Build on the bounded Release 1 layout; no transport events in user summaries |
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
- A notebook editor rewrite or project-management hierarchy.
- Claims of continuous phone processing when the Mac is unavailable.

## 11. Review decisions

| Decision | Proposed default | Why it needs review |
|---|---|---|
| Primary daily habit | Open Overview and review Needs you | Determines whether a digest or notifications should follow |
| Overview size | Five actions, six activities, compact waiting summary | Balances scanning cost and useful breadth |
| Detected task handling | Directly actionable, same detail as manual tasks; no mandatory acceptance step | Removes the current inconsistency between the list and review form |
| Ambiguous stale requests | Keep inspectable and ask for correction; expire only with supporting evidence | Avoids both an endless backlog and silently lost obligations |
| Reply assistance | Source navigation now; optional user-requested drafts later | Preserves the absolute no-auto-send requirement |
| Memory older than 30 days | Keep current restriction for model context | Any persistent-memory exception requires an explicit policy decision |
| Quality bar | Proposed sample/targets in section 8 | Must be baselined before estimating remaining quality work |

Approval of this PRD sets product direction; it does not approve deleting existing user data, changing personal task statuses, or weakening established privacy and messaging constraints.

## 12. Related documents

- [Product audit and observed gaps](PRODUCT-AUDIT-2026-09-23.md)
- [Architecture and implementation boundaries](../ARCHITECTURE.md)
- [Local intelligence and model-processing policy](../ARCHITECTURE.md)
- [Task reconciliation](../ARCHITECTURE.md)
- [Activity discovery](../ARCHITECTURE.md)
- [iPhone companion and validation status](../ARCHITECTURE.md)

Once approved, this PRD supersedes conflicting review-first task presentation in the earlier specification. Until then, it is a proposal; established user decisions in section 4 continue to govern implementation.

## Approved specification refinements

The [daily-actions contract](DAILY-ACTIONS-CONTRACT.md) defines lifecycle, identity, aggregation and mutation semantics. Mac shortcuts are E (Done), L (Later), W (Waiting), and Delete (recoverable Not needed), active only for a selected task outside editable controls. Source fallback includes preserved content, sender, source timestamp and copy controls; missing content is explicit. Model confidence is not a ranking tie-breaker. The observed task counts remain an unlabeled baseline snapshot, not a scored benchmark.
