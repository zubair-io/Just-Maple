# Local-first note state and sync

September 30, 2026. First delivery in the active goal to complete the [Notes, Today and Sources PRD](../product/PRD-TODAY-AND-SOURCES.md), then the [main PRD](../product/PRD-JUST-MAPLE.md). This document describes the foundation; it does not declare either PRD complete.

## Ownership

The local Markdown file remains the durable authority for writing and block order. The native draft sidecar and file/SQLite mutation journal provide recovery. SQLite owns source evidence, canonical tasks and delivery history. Tiptap/Yjs holds the active editor document; the Angular session is a disposable projection of its live text and acknowledged disk metadata. iCloud transports the file to the phone. A local save acknowledgment does not claim iCloud upload or phone receipt.

The UI responds to edits immediately. It never waits for cloud transport before displaying local writing. Native persistence stays serialized and expected-revision checked. A missing or undownloaded file is an unavailable state, not permission to replace it with an empty note.

## Signals and async work

`NoteSessionState` holds the managed editor's state in one Angular signal. Components receive read-only computed selectors. Open/recovery and save acknowledgment are atomic state transitions. Acknowledgment advances saved metadata while retaining newer live text, the mounted editor generation and delivery receipts. Its status continues to say that newer changes are saving until those changes are acknowledged. An edit version also fences a delayed open even if the user types and then returns to the original text.

`LocalDraftQueue` is shared by managed Today/notebooks and ordinary notebook files. It keeps one write in flight and only the latest pending full snapshot per document, including accepted delivery metadata. It starts on the next microtask, not a debounce that can indefinitely postpone draft protection. A slow disk no longer builds a promise chain of every intermediate keystroke. A flush waits for the latest queued snapshot; failures remain pending and prevent a file commit from claiming success. The next edit or explicit retry retries retained work. Canonical commands and committed history are never coalesced.

Use existing RxJS for observable route/event streams and cancellation of obsolete reads. Do not use `switchMap` to imply cancellation of a native write already dispatched. Writes require explicit serialization, acknowledgments and retry identity. [Angular's signal guidance](https://angular.dev/guide/signals) supports read-only consumers and computed projections; implementation uses the installed Angular 21 APIs.

Elf was considered as an optional repository abstraction. This first delivery uses native signals and the existing RxJS dependency: introducing another persisted entity store would not fix the observed races and would create unnecessary authority/lifecycle questions. A future normalized metadata repository can use Elf if it reduces complexity; it must not persist a second independently writable copy of note prose.

## Session ownership and recovery

Each web editor ownership session has an opaque token passed to collaborative open, presence and proposal reads. The Mac grants ownership on explicit open; renewal and release must match that owner. A delayed release from Today cannot revoke the newer notebook editor's claim on the same file. Tokenless compatibility clients cannot revoke a token-owned claim. Released tokens cannot renew themselves through delayed callbacks. A fresh route session gets a fresh token; coalesced open reads are scoped to that token.

Saving matching prose alone cannot delete a draft containing newer automatic-block or reply receipts. Those receipts may represent an insertion deleted by the user before autosave. Retain the metadata through file replacement and crash recovery; expose only receipts not yet finalized into durable history as pending.

Abandoning a pending document operation acquires the same participant locks as recovery. Terminal abandoned operations cannot later write files, enter conflict again or finalize. A partially written cross-day move cannot be abandoned in a way that loses or duplicates its identity.

Notebook recovery copies snapshot current text directly into the existing copy path without flushing the failing original or switching the active document. The original identity, revision, live editor and dirty state remain available after either copy outcome. Managed notebook errors and retained inline requests use the same recovery commands as Today. Modal source inspection and selection restore the opener; source-card Escape returns to the mapped editor selection without scrolling.

`DocumentProcessTerminationTests` now kills a dedicated synthetic child at draft persistence, journal preparation, file replacement, finalization, outbox delivery and acknowledged return. Separate verifier processes reopen and repeat recovery; additional prepared/file cases inject an external edit before recovery. Checks cover writing, history, deletion receipts, unchanged canonical task state and exactly-once indexing. This supplies actual single-document process-death evidence; it does not claim physical power-loss, multi-file operation termination or iCloud delivery coverage.

`DocumentOperationProcessTerminationTests` extends process-death evidence to move/copy/clear/linked-task operations. Twenty-one termination cases include both per-document drafts, transactional preparation, individual file replacements, finalization, indexing and acknowledged return. Fresh recovery processes verify deterministic copy identities, retained move identities, task reservations and idempotent history/indexing; external edits preserve both participants and the conflict journal. Power-loss and physical iCloud delivery remain separate checks.

Inline request submission captures its originating session before awaiting save and rechecks that session before enqueueing. Request-history reads are ordered and fenced by document generation and selected run; stale results/errors cannot leak into another note. Inspection failures have their own visible state rather than presenting as a failed document save. All explicit editor submission paths reject composition, raw Markdown mode and stale node positions before mutating a request.

## Reference audit

Reference projects were read only. Patterns were evaluated individually, not imported wholesale.

| Reference | Adopted principle / boundary |
| --- | --- |
| `Just-Maple` PageService (`apps/web/src/app/services/page.service.ts`) | Separate active identity and note metadata from live editor state |
| `Just-Maple` MemoDocumentService | Per-document editor resource lifecycle; its local pages load Markdown and bypass IndexedDB prose persistence |
| `Just-Maple` offline queues | Do not copy retry-exhaustion deletion or clearing queued operations without a corresponding apply acknowledgment |
| `SugarMaple` editor and PaperService | Reuse reactive UI ideas; do not copy debounce/switchMap saves or rollback that can replace newer local typing |
| Donor file watcher abstraction | Treat it as a design reference, not a proven sync implementation; one local provider watcher is a no-op |

## Verification contract

- Slow storage plus 1,000 edits writes the in-flight snapshot and latest pending snapshot, then commits the newest text and receipts.
- Draft failure blocks saved status and file commit; recovery/retry retains the latest draft for both Mac and companion notebook transport.
- Late reads cannot replace newer writing, even after that writing has saved.
- Save acknowledgment preserves typing arriving during the save and does not remount the editor.
- Same-document route handoff rejects old-owner releases/renewals and ignores stale open/proposal responses.
- Same-prose newer receipts survive save and crash recovery; deleting an arrival does not cause it to return.
- Retry after abandonment has no effect; racing abandonment and recovery cannot leave a half-applied move.

Run Angular, Core/transport, native Mac tests and CLI build, followed by the synthetic real-editor collaboration journey and a fresh Mac build. Synthetic fixtures do not establish live provider quality, real iCloud latency or physical-phone behavior. Keep those gates explicit in the implementation plan.

## First delivery evidence

September 30: 266 Angular tests, 376 Core tests, 30 transport tests and 72 Mac tests passed. CLI and production Angular builds passed. The synthetic browser collaboration journey passed live email, iMessage, HA and calendar arrivals, retry suppression, selection retention, human Undo isolation, arrival during save, raw-mode deferral, inline replies and reload. The full writing/source/notebook journey passed; its 248,005-byte note measured 14.5 ms p95 input-to-next-frame on this development browser (not native end-to-end latency).

`npm run build` produced `.build/xcode/Build/Products/Debug/Just Maple.app`; strict code-signature verification passed. The running user's editor was not restarted. Logs are local under `.build/note-state-*`; reproducible regressions live in `src/web/src/app/notes`, Today/notebook service tests, `LocalDocumentSessionTests.swift`, and native `BridgeTests.swift`.

## Companion test isolation

Hosted XCTest and `--companion-ui-test` launches select `CompanionUITests` storage with an unavailable iCloud notebook root. Normal launches retain their existing storage and sync behavior. Test-mode sync uses a separate preferences suite, leaves normal pause/manual settings intact, and disables both the background loop and explicit sync, enable-cloud, pairing and disconnect entry points. Pending fixture commands remain pending; a disabled test transport never fabricates Mac acknowledgments.

This permits isolated simulator regression tests without contacting a live mailbox. It does not make launching XCTest over an actively edited physical-phone app safe: the existing UI runner still launches/terminates that app. Real iCloud download/reconnect validation requires an inactive phone session and a controlled disposable note; simulator fixtures do not prove those delivery semantics.

## Automatic recovery on opening a managed note

The coordinator now resolves a retained draft before adopting the opened editor snapshot. A matching baseline is committed automatically. For a changed saved revision, it uses committed mutation history as the three-way baseline and merges only separated line ranges. Overlapping or adjacent ranges, and unavailable baselines, remain separate versions: the exact recovered Markdown is written to an unmanaged recovery file before the current file is opened and its retained draft is acknowledged. Cleared content is not restored merely because an unchanged old block occurs in the draft. No canonical task is completed by this recovery.

Automatic recovery copies use a native content-bound recovery key and the document admission lock. Reopening or retrying produces one copy for the same version; a user-edited recovery file is never overwritten. Ordinary manual recovery copies retain their existing behavior. The notebook catalog refreshes after archival so the recovered note is available in the sidebar.

Recovery commits use the current expected revision, retain automatic and reply delivery receipts, and pass through the existing draft, mutation journal, finalization and outbox path. Open generation and edit-version fences prevent a superseded recovery from replacing the active editor. Successful recovery opens a saved note without a conflict alert. Storage failures or missing acknowledgments remain failed work, with the original draft retained and an opening retry available.
