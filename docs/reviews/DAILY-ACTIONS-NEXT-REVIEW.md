# Daily actions: durable action integration

September 23, 2026. Follow-up to the merged initial import (#1–#4).

## Changes ready for review

The eight initial review findings have corresponding fixes and regression coverage: canonical evidence propagation, indexed identity lookup, bounded phone snapshot allocation, lost-reply retries, explicit unsupported receipts, provider tool isolation, stable activity IDs, and preservation of edits during notebook copying.

Done, Later, Waiting, Not needed and scoped Undo now use the transactional core API from both native hosts. Shared Angular controls retain request IDs across uncertain retries, guard against stale revisions, show deadline warnings for deferral, and keep keyboard shortcuts out of editable fields. Later returns to eligibility after its timestamp. Waiting remains isolated even when its review date passes.

Phone Undo uses applied receipt revisions for terminal tasks absent from the snapshot, or current same-device snapshot metadata after old command history is pruned. Mac revision validation remains authoritative. Snapshot capacity and counts distinguish actionable, Waiting and Later work. Unsupported commands are never reported as applied and do not block unrelated sync.

## Compatibility limitation

ChatGPT extraction is explicitly unavailable with the current Codex ACP adapter because a complete tools-disabled contract could not be verified. Login detection remains supported. Claude now uses a pinned text-only SDK configuration with offline tests at the process argument boundary. There is no silent provider fallback, and live Claude quality/authentication was not tested in this slice. See [isolation contract](../../src/providers/ISOLATION.md).

## Verification

- 138 core tests and 24 transport tests passed.
- 49 Angular tests passed, including shared action controls and companion retry/Undo behavior.
- 13 provider isolation/contract tests passed.
- 35 Mac tests passed.
- 19 iPhone unit tests and the simulator UI test passed.
- Swift package/CLI build and signed generic iPhone build succeeded.
- Native suites ran after the transport/core changes; final shared UI refinements also passed Angular tests and are included in the rebuilt app bundles.

These are synthetic correctness checks. No personal task was manually completed, dismissed or relabeled for validation. No live model accuracy score or physical-iPhone reconnect test is claimed.

## Remaining release gates

- Concrete Waiting follow-up/review generation and evidence-supported blocker-clear transitions.
- Reviewed-membership aggregation with safe child resolution and Undo conflicts.
- Complete source-navigation fallbacks and provenance inspection across platforms.
- Independently label and evaluate the real 100-source/50-task benchmark.
- Exercise reconnect, concurrent edits, note downloads and durable actions on the physical phone.
