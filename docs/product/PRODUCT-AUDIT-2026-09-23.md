# Just Maple product audit

September 23, 2026 · Current implementation and live Mac walkthrough

## Product judgment

Maple has a credible intelligence foundation, but it does not yet reliably reduce the work of managing everyday obligations. It can collect, extract, associate and display information. The next milestone should prove that it can present a small, trustworthy set of things worth acting on, explain them, and help the user resolve them.

The product promise: **“Know what needs me, understand why, and help me take the next step.”** State supplies context, Activities connect related work, Tasks express obligations, and Notes remain a peer source. Automatic learning must never mean automatic replies.

This audit recommends product work; it does not authorize changing the user's tasks, dismissing existing requests, or seeding categories. No live records were edited during the audit.

## Evidence and limits

- Inspected the running Mac Overview and a detected-task detail, current Angular components, ranking implementation, and implementation/validation documents listed below.
- Live Overview showed **115 open tasks**, **27 activity cards**, and **48 open tasks under one screen-time activity**. These are a point-in-time snapshot, not accuracy measurements. Individual screen-time requests were not adjudicated; the count is a review priority, not proof they are all false positives.
- One of the first three attention rows was a background check explicitly described as waiting on another party. The ranking code lets dated waiting tasks retain their urgency tier.
- A detected task opened a large review form with all 27 activity choices, “Add task,” and model/provider information, despite already appearing as a task in the ranked list.
- Right now showed “Review employment evidence” and “Review role evidence.” Recent changes exposed repeated `source home assistant home state` events instead of a useful account of what changed.
- iPhone findings are based on current code, the user's screenshot, and the previous build/test record. The latest notebook-download/task-action update remains unverified on the physical phone. This is not a complete accessibility, performance, connector-coverage or model-quality evaluation.
- Older documents contain superseded statements. Local embeddings, state extraction, activity discovery, reconciliation and conservative identity grouping now exist; their absence in earlier status notes must not become duplicate roadmap work.

## What is working well

| Capability | Product value already present | Boundary |
|---|---|---|
| State / Activities / Tasks | Distinct concepts with many-to-many tags; discovered activities do not require a seeded taxonomy | Interpretation and presentation still need refinement |
| Evidence and correction | Source quotes, original observations, explicit corrections, separate/merge controls and history support trust | Inspection is easier on Mac than phone; correction is often form-heavy |
| Automatic processing | New observations enter persistent work queues; failures remain visible; learning does not need a manual start | An active loop does not prove every relevant message was imported or understood |
| Local memory | Lexical and local semantic retrieval, atomic indexing, original-source retention | English Apple embeddings and exact cosine search; no broad retrieval benchmark or general identity-resolved graph |
| Task reconciliation | Duplicate requests can combine; later evidence can establish waiting/completion; user corrections win | Bounded batches and excerpts can miss evidence; confidence thresholds are not measured accuracy |
| Activity discovery | Activities can emerge from notes/calendar/messages without tasks or hardcoded company names | Granularity, relevance and naming can proliferate |
| People | Pins, recent interactions and conservative contact matching avoid showing the entire address book | Identity grouping is not yet applied consistently across tasks, activities and retrieval |
| Shared app foundation | Real Apple app projects, shared Angular/Maple elements, automatic themes, local Markdown and iCloud companion | Phone has a bounded snapshot and a smaller action set |
| User control | No automatic outbound messages; old sources remain locally indexed while model context is limited to 30 days | Data lifecycle and provider disclosure need a clearer product surface |

Preserve these strengths. They make it possible to improve judgment without replacing storage, connectors or the UI framework.

## Main product gaps

### 1. A request is not necessarily an outstanding obligation

The system needs a stronger lifecycle for short-lived requests, superseded requests, one-off approvals, messages already handled elsewhere, and promises made by someone else. Forty-eight items in one activity is a warning that extraction is outpacing resolution.

Build a generic obligation model around who owes what, to whom, by when, whether it is still relevant, and the supporting/resolving evidence. Keep ambiguous items inspectable. Do not implement sender rules or a blanket “ignore screen-time messages” exception. Time passing alone must not imply completion; source-supported expiry can instead make an item no longer actionable, with an explanation and recovery.

### 2. Attention ranking mixes “do” with “monitor”

Today, an explicit date can keep a waiting item near the top. The user needs separate **Needs you** and **Waiting on others** surfaces. A waiting item becomes an action only when a follow-up/review condition is met. A deadline still deserves visibility, but does not imply the user can do the blocked work now.

Make the reason for ranking concrete: deadline, unanswered request, explicit priority, or current responsibility. Avoid treating a future start date as every preceding task's deadline. Keep supported dates, inferred timing and review dates distinct.

### 3. A task can be inspected, but the next step is still cumbersome

Opening a task should show a readable action detail, not start in an extraction-review form. Editing is secondary. The same task should behave consistently whether detected or manually created.

Provide **Open source**, **Done**, **Later**, **Waiting**, and **Not needed**, with undo and clear pending-sync status. Where possible, Open source should reach the exact email, conversation or relevant destination, with a safe fallback when the app cannot deep-link. Opening a destination never counts as completing the task. Draft assistance can follow later and must remain explicitly requested and reviewed; Maple never automatically sends.

Phone task details and completion have just been implemented. Phone defer/dismiss/correction, source access and undo remain product work. Share presentation and action contracts across Mac and phone rather than building two independently evolving experiences.

### 4. Overview is still an inventory

The current page shows three task rows followed by every active activity. It should answer: **What needs me today? What changed? What am I waiting for?**

Show a short Needs you list, a compact waiting summary, meaningful changes, and a handful of relevant activities with View all. Make list limits explicit; never imply an incomplete snapshot is the whole world. Convert raw source events into understandable changes and suppress repetitive transport/polling noise from the summary. Keep diagnostics available under connection/processing health.

### 5. Understanding the person remains fragmented

People grouping, extracted work state, calendar events and Home Assistant entities exist, but are not yet a cohesive contextual model. The state extractor explicitly lacks structured calendar/HA-to-person projection. Unknown location is preferable to invented location, but an unknown state should offer a useful next step.

Connect identity aliases to tasks, activities and retrieval with provenance. Add UI correction for incorrect identity joins. Then map selected home/person signals and calendar evidence to narrowly justified state. A calendar event establishes scheduled time, not physical attendance. Distinguish current employment from an accepted future transition instead of presenting all evidence differences as a generic conflict.

### 6. Activities need curation without manual setup

Automatic discovery is valuable, but long labels and overlapping activity scopes increase scanning cost. Existing rename/merge/move/remove controls are a good foundation. Add undo, relevance ordering, concise names that preserve purpose, and a clear distinction between an ongoing area and a temporary pursuit. Keep the taxonomy learned and editable; do not restore seeded Job Search or company tags.

### 7. Onboarding proves configuration before value

The current flow asks for a name, résumé, connections and provider setup before a useful outcome is clear. The résumé is optional but receives a full early step; provider terminology remains prominent.

Offer a short path: name → one useful source → first results with evidence → one correction or action. Keep résumé/bio optional. Explain which data stays local and which selected providers receive recent content. Show progress in user terms: connected, importing, understanding, ready, or needs attention. Distinguish “nothing needs you” from “we have not finished checking.”

### 8. Reliability must be visible without becoming setup work

iCloud should stay automatic. The user needs to know whether they are seeing fresh Mac results, cached results while the Mac is asleep, or a queued change waiting for acknowledgment. “Synced with iCloud” alone cannot communicate processing freshness.

Notebook download/save/conflict states need physical-device verification. Add a small source-health surface with last successful import, scope/window, processing freshness and actionable errors. Notes currently enter Mac ingestion on opening/saving, not through a complete folder-wide ingestion pipeline; phone notebook edits reaching intelligence must be tested explicitly. A notebook being visible is not proof every note has been learned.

## Recommended sequence

| Order | Milestone | Deliverable and completion gate |
|---|---|---|
| 1 | **A trustworthy daily action list** | Measure current task quality; separate Needs you/Waiting; improve obligation lifecycle and supported timing; unify task details and corrections; source access, Later, Not needed and undo on both devices. Include only bounded Overview lists, waiting isolation and transport-noise suppression. Verify correction persistence across reprocessing and sync. |
| 2 | **An overview worth opening every day** | Dynamic activity curation, meaningful change summaries, explicit freshness/coverage, concise state conflicts beyond the minimal first-release layout. The user can identify their next action without opening diagnostics or scanning all activities. |
| 3 | **A connected understanding of your life** | Identity propagation, correction UI, current-versus-future state, carefully attributed calendar/HA signals, contextual activity/person views. Same-person evidence from two connectors informs a task without accidental identity merges. |
| 4 | **A first session that delivers value** | Simplified onboarding, optional résumé, first-result progress and provider/privacy explanation. A new user reaches a useful source-backed result without knowing Jev, indexing or queue terminology. |
| 5 | **A dependable personal memory** | Notebook observation delivery, retrieval evaluation, unified search/source navigation, retention/export/forget controls with derived-data invalidation. Broaden recording/widget/input work after everyday actions are dependable. |

Physical iPhone deployment/verification of the current fixes is a release gate alongside milestone 1, not a reason to add more features first. No calendar estimates are assigned until the quality sample identifies the largest failure modes.

## Milestone 1: concrete backlog

1. **Audit outstanding obligations.** Review a stratified sample of 100 recent messages and a separate sample of 50 visible tasks, including quiet negatives, short-lived requests, repeated requests, waiting work, renewals and completed work. Include held-out sources beyond the examples used to tune prompts. Use real data locally for review; do not send older-than-30-day evidence to models. Label uncertainty separately.
2. **Create a consistent task-detail surface.** Reuse existing detail/evidence/action capabilities. Default to the action and its reason, with source, timing and people underneath; move editing/provider diagnostics behind secondary controls.
3. **Separate actionability from urgency.** Maintain responsibility, progress and relevance as distinct concepts. Waiting with a due date cannot consume the main action slot unless an actual user follow-up is due. Preserve blocked responsibilities in a visible waiting surface.
4. **Make correction cheap and durable.** Later changes resurfacing time, not the original deadline. Not needed does not claim completion. Undo reverses the user's command safely. Both devices show queued, applied and conflict states. A source refresh must not resurrect an explicitly dismissed obligation through a new extraction ID.
5. **Add destination navigation.** Open supported source records/destinations on each platform; provide an understandable fallback. Never send a reply or infer completion from navigation.
6. **Validate with the real phone.** Open an existing iCloud note, edit safely, complete and undo a test task, queue a command while the Mac is unavailable, reconnect, and verify one acknowledged effect. Preserve personal tasks; use clearly labeled test records for mutation checks.

Suggested release targets, to be baselined and agreed rather than claimed as achieved: at least 90% of the first ten attention items judged actionable/useful; at least 85% recall on explicitly labeled obligations in the held-out message sample; zero unsupported automatic completions in that sample; no recurrence of corrected test obligations after retries/revisions; no duplicate effects across reconnect. Report sample sizes and failure examples alongside percentages. A small zero-error sample does not establish zero real-world risk.

Track time to first useful result, missed obligations, unnecessary actions, corrections per reviewed item, source-to-surface latency and pending-sync age. Task volume, vector count and model-call success are operational measures, not evidence of product value.

## Defer and decisions still open

Defer more connectors, a general chat interface, a graph visualization, a new vector backend, and automatic external actions. The existing memory and connectors are enough to test the daily value proposition. Revisit retrieval architecture when measured misses or latency justify it. The planned API gateway remains distribution work, not the next daily-use feature.

Three decisions will matter later: whether brief in-app review or a scheduled digest is the preferred habit; which notifications deserve interruption after quiet-mode quality is established; and how to explain persistent user-approved knowledge when model evidence is restricted to 30 days. Until explicitly changed, retain the existing 30-day AI boundary, avoid new notifications, and do not send old facts merely because a recent task refers to them.

## Implementation references

- [Local intelligence and 30-day boundary](../ARCHITECTURE.md)
- [Task reconciliation](../ARCHITECTURE.md)
- [Activity discovery and corrections](../ARCHITECTURE.md)
- [Identity scope](../ARCHITECTURE.md)
- [Notebook behavior](../ARCHITECTURE.md)
- [Companion implementation and validation](../ARCHITECTURE.md)
- [Action evaluation: observed results and limitations](../ARCHITECTURE.md)
- UI: `src/web/src/app/world/overview.component.ts`, `overview-surface.component.ts`, `task-ranking.ts`, `suggestion.component.html`, `task-detail.component.html`, `activities.component.html`, `pages/onboarding.component.html`, `companion/companion.component.ts`.

Audit-only change: no app behavior, prompts or user data modified; no new build/test run required for this document.
