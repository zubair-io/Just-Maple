# Daily actions: follow-ups, reviewed groups, and source inspection

September 24, 2026. Stacked on the durable task actions branch (PR #5).

## Behavior

- A local automatic tick creates a distinct, linked follow-up when a Waiting review time or source deadline arrives. The parent remains Waiting. Completed/dismissed review occurrences do not respawn; explicit rescheduling creates a new occurrence. Parent Undo restores only an otherwise unchanged, automatically invalidated review.
- Reviewed groups capture immutable child IDs and revisions. Done, Not needed, and scoped Undo apply atomically to that exact set; new arrivals are unaffected. Complete matching groups collapse repeated rows in the unfiltered task list. Partial, stale, or filtered sets retain individual rows; Overview ranking is unchanged.
- Optional learned grouping runs automatically after the user configures a time window. Inputs obey the 30-day policy and strict bounds. Supporting quotes and source/account/thread constraints are validated. Failed jobs remain inspectable and retryable; proposals require review before becoming groups.
- iPhone group actions use a separate durable encrypted command queue, explicit applied/conflict/unsupported receipts, pending indicators, and overlap protection against single-task commands.
- Shared source inspection displays captured text and metadata on Mac and iPhone, with copy and explicit truncation/unavailable states. Snapshot limits never silently truncate group membership.
- A blind, read-only private inventory and local labeling page support benchmark preparation. Public files contain only tooling and synthetic examples. No private inventory or credentials belong in this repository.

## Verification

- MapleCore: 162 tests in 39 suites passed.
- Companion transport: 28 tests in 5 suites passed.
- CLI package build passed.
- Angular: 66 tests across 12 files passed.
- Provider isolation: 14 tests passed.
- macOS Xcode: 43 tests in 11 suites passed.
- iPhone simulator: 21 native tests and one UI test passed.
- Evaluation scorer: 8 tests passed; read-only inventory regression passed.
- Signed device build succeeded. Physical iPhone installation succeeded; physical test launch was blocked by the locked device. Real iCloud reconnect, offline conflicts, and undownloaded-note integrity remain unverified.

## Release gates and limitations

No live extraction accuracy is claimed. The Claude organization currently denies subscription access; ChatGPT extraction remains fail-closed without a verified tools-disabled adapter contract; the local Apple synthetic rubric failed evidence validation. No provider was silently selected as a fallback. Synthetic regression coverage is not a substitute for live model quality.

The frozen private inventory remains unlabeled. Complete the stratified 100-source sample, separate 50-task sample, whole-pipeline telemetry, and held-out scoring before quality tuning. Imported-source coverage alone cannot establish upstream ingestion recall.

Explicit user Waiting corrections remain protected. Existing inferred-state reconciliation is retained; an arriving reply is not automatically treated as proof that every blocker cleared. Reviewed grouping quality still needs evaluation on diverse evidence. There is no automatic reply sending.

## ChatGPT restoration follow-up

At the user's request, the working Codex ACP extraction path is restored with the stable workspace and session archiving retained. Explicit approval mode is selected and permission requests are denied; the adapter is not represented as tool-free. Provider regressions (16), core tests (162), transport tests (28), CLI build and macOS build passed. A live structured-response check and all four synthetic task-parser cases passed using the ChatGPT login. These results supersede the ChatGPT blocker above; the broader human-labeled accuracy gate remains open.
