# Daily actions — durable action integration

September 24, 2026

## Integrated

- PRD v0.2 and audit agree on minimal Overview scope; the shared contract defines lifecycle, conservative identity, aggregation semantics and cross-device intent handling.
- MapleCore stores versioned, inspectable obligation identity. Matching source occurrences with the same actor/action/evidence preserve completed or dismissed records and append historical evidence. Distinct occurrences remain eligible. This is exact conservative matching, not general semantic equivalence; rewritten action titles or quotes are not covered by this identity mechanism.
- Done, Later, Waiting, Not needed and same-device guarded Undo now run through a transactional core API and both native bridges. Shared Angular controls retain immutable request IDs for retries. Waiting stores an actor and optional review time. A provider-independent local tick creates a separate review/follow-up when that review or source deadline arrives, while the original stays Waiting. Completed/dismissed reviews do not respawn; explicit rescheduling creates a new review occurrence. Later preserves the original deadline and returns to eligibility after its resurfacing time.
- Phone snapshots reserve separate actionable, Waiting and Later capacity and carry full category counts, stable activity IDs, original deadline instants and action capabilities. Lost acknowledgements are retried idempotently; unsupported commands receive an explicit non-applied receipt without blocking unrelated sync. Undo remains possible after a completed task disappears or local history is pruned.
- Matching extraction evidence reaches canonical/consolidated tasks without reopening completed/dismissed work. Indexed source-occurrence lookups replace repeated full suggestion scans. Explicit lifecycle corrections survive matching re-extraction.
- Notebook Save a copy preserves edits made while asynchronous file operations are in flight.
- Mac and iPhone share a source inspector with captured text, sender/time, clipboard support and explicit unavailable/truncated states. Phone previews are bounded inside the encrypted envelope.
- Reviewed groups capture exact child IDs and revisions. Done, Not needed and scoped Undo are atomic across the reviewed set; later arrivals are unaffected. The phone uses a separate durable group queue and applied/conflict receipts.
- Optional grouping suggestions use the selected provider after an explicit window is configured. Inputs are bounded and respect the 30-day evidence policy; successful coverage advances through task versions. Exact supporting quotes are validated and shown before user review. Suggestions never perform group actions themselves.
- Claude extraction uses a tested text-only SDK configuration. ChatGPT extraction is restored using its existing ACP transport, explicit approval mode and temporary-session archival. A live synthetic request passed; this is not a tool-free contract or a broad quality result. No automatic provider fallback occurs. See [provider isolation](../../src/providers/ISOLATION.md).
- Mac and phone Overview show at most five non-waiting open actions and six activities. Waiting has a separate count and filtered destination. Needs you and Waiting filters preserve full task access. Recent Overview history suppresses source/transport noise without deleting History.
- Seven synthetic Sugar Maple review pages are saved under Daily actions · Release 1. See [design handoff](DAILY-ACTIONS-DESIGN-HANDOFF.md).
- Offline evaluation protocol, scorer and blind imported-source inventory/review tooling are ready. A private unlabeled inventory has been frozen; the stratified 100-source and separate 50-task benchmark still need human labeling and end-to-end predictions. No accuracy result is claimed.

## Verification

The integration has regression coverage for lifecycle identity, idempotency, guarded Undo, bounded phone snapshots, activity IDs, notebook copy races and provider isolation. Final test counts are recorded in [the follow-up review](../reviews/DAILY-ACTIONS-FOLLOWUPS-REVIEW.md). No live model quality result or physical-device validation is claimed.

## Remaining work before Release 1

1. Complete live provider validation. Claude subscription access is disabled by the current organization; the local Apple synthetic task rubric failed evidence validation; ChatGPT connectivity and session archival have been restored; held-out quality scoring remains outstanding. No provider was silently switched.
2. Human-review the frozen source inventory, complete the separate task sample, collect whole-pipeline telemetry and score the held-out benchmark before quality tuning.
3. Verify real iCloud reconnect, concurrent edits and undownloaded-note integrity on the physical iPhone. Synthetic native tests do not certify those conditions.
4. Evaluate learned grouping proposal quality on diverse sources. Input coverage and exact-quote validation do not prove semantic accuracy.
5. Source-verified inferred Waiting transitions use existing reconciliation. Explicit user status corrections remain protected; this slice does not treat a received reply as automatic blocker clearance.

This is an integrated implementation slice, not completion of the release or proof that the current live task backlog is accurate. No existing personal tasks were manually completed, dismissed or relabeled for validation.
