# Today and Sources implementation record

September 27, 2026. Implementation branch: `codex/today-and-sources`.

## Baseline

Existing PRs #5 and #6 were tested, merged in dependency order, and the build branch was created from updated `main` (`10ab48b`). Earlier uncommitted work and approved planning/design artifacts were preserved in `3ac49b7`; the pre-refresh safety stash remains available. Donor repositories and Xcode bundle identity, team, signing and deployment targets were not changed.

## Implemented contracts

- `/today` is the default after onboarding. New daily filenames resolve using a local calendar date at app iCloud `Just Maple/YYYY/MM/YYYY-MM-DD.md`. The Mac ignores stale client notebook selections and refuses a local fallback if iCloud is unavailable. Existing registered files retain their original location and history. Sidebar date navigation and midnight handling preserve the open draft.
- Markdown owns content and order. The Angular/Tiptap codec preserves stable block IDs, source references, linked tasks and agent request/reply metadata. Unsupported syntax remains in exact source mode. User frontmatter is preserved when opting an ordinary notebook into managed editing.
- SQLite journals expected revisions before file writes. Durable drafts, before/after revisions, indexing outbox, identity reservations and compensating operations cover restart, external edits and cross-day moves. Startup resumes pending registered documents; unavailable folders leave a visible conflict and retain task reservations.
- Clear, restore, copy, move, completion and reopening are separate actions. Linked task actions use canonical task versions; SQL reservations protect every writer until file effects are reconciled. Suggested tasks and carry-forward offers require explicit insertion.
- `@maple` submits only after a saved anchor. Local source retrieval runs through the selected Apple/ACP provider, stores actual prompts/responses and validation outcomes, and returns bounded references to immutable events. Sender ambiguities, corpus limits, errors, cancellation and unapplied replies remain visible. Exact command replay returns the original run even after later document edits.
- `/sources` shows observations and current processing independently of observed HA state. Type, connector, account, date and text filters use bounded, expiring SQLite snapshots; detail is live and labeled separately. Four processing queues append audit history atomically, including skipped, retried, interrupted and discarded work. Provider input/output is inspectable with attempt identity and explicit legacy/unavailable states.
- Source cards in Today and managed ordinary notebooks use the same inspector. Backlinks retain document/block/revision identities. Removing a card does not delete its evidence.
- Both themes derive colors from the checked-in JustMaple tokens. Existing selectively extracted `@maple/ui` controls remain the shared controls. Dark links/focus indicators use readable JustMaple text tokens; decorative writing rails use its Maple color.
- The iPhone remains a compatible reader for migrated days. Legacy semantic writes and direct managed Markdown saves are rejected, preserving local drafts and pending acknowledgments. Ordinary unmanaged notebooks retain existing behavior.

## Deliberate implementation choices

The document coordinator lives inside the existing `MapleCore` package, using `MapleNotebooks` for coordinated file access, instead of adding the plan's proposed extra library target. A single coordinator rejects overlapping reentrant writes visibly; the UI serializes normal edits. SQLite and files are recovered by journaled before/after hashes, not claimed to form a distributed transaction.

Source snapshots materialize typed compact columns in SQLite. Raw provider artifacts are local SQLite payloads with paged reads and an explicit 8 MiB retention ceiling. Oversized artifacts report `not_recorded_size_limit`. Inline source searches return at most 25 latest revisions and a matching count/coverage notice; Sources provides the full paged corpus view.

Undo uses explicit versioned compensating commands: restore a cleared block, reopen a completed task, or move a block back to its prior date. Copy allocates new identity. Existing historical revisions remain inspectable.

## Validation

The final storage suite reported 284 core tests and 30 transport tests passing (the opt-in performance test is skipped in the normal run and was run separately). The CLI build passed. Angular reported 119 tests across 20 suites passing. Provider contract tests passed all 16 tests. The existing Mac Xcode scheme passed 52 tests; the iPhone scheme passed all 28 tests on the iOS 27 iPhone 18 Pro simulator. `npm run build` produced the signed development app in `.build/xcode/Build/Products/Debug/Just Maple.app`.

Sources: file-backed 10,000-event warm first-page p95 62.263 ms, target <200 ms. Editor: a 248,167-byte Markdown fixture, 37 inputs, beforeinput-to-frame p95 18.1 ms on the final browser run, target <50 ms; the [UI validation record](UI-VALIDATION.md) and latest sample JSON are authoritative for subsequent visual-only reruns.

| Acceptance | Evidence |
| --- | --- |
| T1–T3 | ManagedDocumentTests, Today service/codec tests, native BridgeTests; create/replay, revision conflict, draft preservation, external edits before save acknowledgment and injected restart boundaries |
| T4 | InlineMapleTests and native replay test, synthetic browser submission journey; real-model quality remains a separate environment check |
| T5 | Document operation/reservation/migration tests; clear/restore, cross-file move recovery, new copy identity, canonical complete/reopen |
| S1–S3 | SourcesTests and audited provider contract tests; stable paging/state filters, actual retained artifacts, legacy/skipped/stale outcomes |
| S4 | Generic registration/backlink tests and browser ordinary-notebook insertion/reload journey |
| U1 | Light/dark/narrow screenshots, accessible editor labels and keyboard behavior; VoiceOver and IME exploratory checks remain a manual release check |
| C1 | Companion transport tests and iPhone simulator tests, including managed-write rejection and retained local drafts |
| M1 | Explicit migration collision/replay/version/tombstone tests; legacy writers rejected afterward |

No benchmark uses private notes or email. Sources benchmark details are in [SOURCES-VERIFICATION.md](SOURCES-VERIFICATION.md) and [sources-performance.json](sources-performance.json). Browser fixture results and screenshots are generated by `node scripts/today-sources-smoke.mjs` against the local Angular development server; this fixture transport is not shipped.

## Limits and rollout

- No personal source corpus or authenticated live-model quality run is used for synthetic tests. A successful fixture transport test does not establish provider quality, installed subscriptions, or Apple Intelligence availability.
- Existing ACP transport isolation limitations still apply (see repository provider documentation). Prompt instructions do not create an operating-system sandbox.
- Recording references expose retained transcripts and provenance. The current source model has no recording attachment/media transport; the UI explicitly says audio is unavailable.
- Native block organization applies to top-level blocks. Nested list-item identities are validated and reserved; edit/reorder those items in Tiptap.
- Editable phone Today remains gated. Simulator correctness does not replace physical-device delivery and iCloud validation.
- Provider history starts with this audit schema. Earlier retained latest responses are available, but missing historical attempts cannot be reconstructed.

For rollback, retain the database, Markdown files, registry and journals. Disable new UI entry points if necessary; do not re-enable legacy daily writers for migrated dates. Recover conflicts through retained before/after revisions or a recovery copy, and reconcile pending task reservations before resuming those actions. Do not delete the new tables or downgrade a copied managed document into an independent legacy writer.

## September 27 — app iCloud daily location

New Today documents use the app iCloud Documents container at `Just Maple/YYYY/MM/YYYY-MM-DD.md`. Stale client notebook IDs and the previous native daily-notebook preference cannot redirect creation. Missing iCloud fails visibly; there is no arbitrary notebook or local Documents fallback. Repeated directory creation is idempotent, and files, symlinks and unresolved cloud placeholders are not overwritten. Recovery copies use the dated folder. Previously registered documents and same-notebook legacy files retain their original locations; already imported legacy blocks are not imported again into the new default notebook.

Regression coverage includes fixed native routing, no-cloud failures, month/year boundaries, repeated opens, collision handling, old registered paths and cross-notebook prior imports. Existing notes are not bulk relocated by this change.
