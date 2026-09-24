# Daily actions — shared contracts and delivery slices

September 23, 2026. Approved direction; not a claim that all states or commands are implemented.

## Ownership and scope

The root task owns product/design contracts and integration. The identity agent owns MapleCore obligation persistence and regression tests. The transport agent owns typed companion intents and validation; new intents stay unavailable to the UI until the Mac dispatcher supports them. The evaluation agent owns the local benchmark/scorer. Existing personal data is not relabeled or deleted by this work.

Release 1 Overview changes are bounded lists (five actionable items, six activities), waiting isolation, and transport-event suppression. Dynamic activity relevance and semantic change summaries remain a separate milestone.

## Identity and relationships

An observation can support zero or more obligations. An obligation can have many observations and zero or more Activities; an Activity can connect zero or more obligations. Aggregation is a presentation/action relationship between distinct obligations, not deduplication.

Fingerprint schema: version, connector/account scope, source request occurrence, thread context, responsible actor, normalized action, target/evidence discriminator, and digest. Retain the fields beside the SHA-256 digest. Normalization is versioned and deterministic; changing it requires migration/alias handling, not silently losing corrections.

Initial conservative implementation uses exact normalized action and supporting quote within the same source occurrence. This handles retries and surrounding-message revisions. It does NOT establish equivalence of paraphrases or requests across independent source IDs. Broader semantic matching must use validated reconciliation and provenance; uncertain matches remain distinct. Never suppress a genuinely new request solely because sender and wording repeat.

Resolved/dismissed identity matches attach historical evidence without making an active obligation. Explicit user reopening is allowed. New request occurrences get their own identity. Legacy records need safe lazy compatibility; do not infer identity from display title alone.

## Lifecycle semantics

| State | Meaning | Exit |
|---|---|---|
| Needs you | User can act; no known unsatisfied blocker | Done, Later, Waiting, Not needed, supported resolution/expiry |
| Waiting | External actor/event blocks progress; source deadline preserved | Supported blocker clearance with a concrete user action, or explicit user correction |
| Later | User deferred attention until resurface_at; deadline unchanged | Time reaches resurface_at or user restores it |
| Resolved | User completion or supported source completion | Explicit reopening; re-extraction does not reopen |
| Expired | Source supports invalidation; explanation retained | User recovery or supported new interpretation |
| Dismissed | User says Not needed | Explicit undo/reopen only for that occurrence |

Current storage statuses remain compatible during incremental implementation. Do not rename existing enums before persistence, projections, both hosts and tests support a migration. Follow-up is a separate actionable review linked to the waiting obligation. A deadline or review_at creates a concrete review when appropriate; the underlying blocked work stays Waiting. A returned message alone is not proof the blocker cleared. Passing an event time alone is not proof every related obligation expired.

Ranking is actionability first, then overdue actionable work, explicit priority, supported timing, and stable creation/identity ties. Uncalibrated model confidence never decides importance. Later beyond the source deadline shows a warning without changing the deadline.

## Aggregation protocol

Candidate groups share validated intent, actor/target context and source scope within a configured bounded window. Window duration is explicit and testable; do not deploy a global guessed duration as a semantic rule. Distinct occurrences remain children with individual evidence/status. Presentation shows the unresolved count. Never aggregate solely by sender name or Activity.

A parent command captures child IDs and expected versions at review time. It affects only that reviewed membership, atomically or returns conflict; arrivals after the snapshot stay open. Undo refers to the original command and respects intervening edits. Completed/expired children do not inflate the pending count. This protocol is specified but is not implemented by the initial exact-identity slice.

## Companion commands

Retain encrypted CloudKit mailbox delivery, local durable phone queue, Mac SQLite transaction and applied/conflict receipt. Do not replace them with a shared append-only iCloud file. Device clocks are not conflict arbiters.

Command contract: stable mutation UUID; task entity ID; expected entity version; typed intent; immutable issuedAt; narrowly typed payload. Later carries resurfaceAt; Waiting carries bounded waitingOn and optional reviewAt; Undo identifies the mutation to reverse. Existing status commands retain backward compatibility. Validate dates at creation, but do not reject a legitimate offline retry solely because its resurfacing time passed in transit.

New typed intents are distinguishable from legacy statuses on the wire so old hosts cannot interpret an unsupported intent as completion. Unsupported commands fail explicitly; no silent success. New controls are gated until the Mac applies each intent atomically, with idempotency and receipts. Fingerprint may be added as a server-verified identity reference once integrated; never trust it to redirect a mutation to an unrelated entity.

Pending means locally durable without an applied receipt. Uploaded does not mean applied. Applied/conflict acknowledgments survive restart. Undo does not overwrite a newer version and cannot target another device's arbitrary command without authenticated scope checks.

## Design handoff

Use the connected Sugar Maple Just Maple document, existing tokens and component styling. Add review pages without replacing existing designs: shared task details at Mac/phone sizes; Later/Waiting sheets; source fallback; pending/conflict/undo states; bounded Overview. Synthetic content must be labeled. Source panels preserve readable content and copy behavior. Keyboard shortcuts apply only outside editors. Touch targets must remain usable at phone width.

## Verification

The separate evaluation scaffold labels and scores the entire pipeline, not Jev alone. Required scenarios: waiting isolation despite deadline, dismissal through exact and edited-source re-extraction, distinct new occurrence, source-navigation fallback, offline Done/Later/Not needed, idempotent reconnect, undo/concurrent edit, group membership changing during resolution, and undownloaded-note integrity on physical iPhone.

Initial parallel slices are foundational: conservative identity protection, compatible intent contracts, and evaluation infrastructure. Full six-state lifecycle, aggregate UI, new intent dispatch and real-data quality scoring remain explicit follow-on integration work. Do not expose unfinished controls or claim Release 1 complete from passing infrastructure tests.
