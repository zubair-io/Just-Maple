# Daily actions — durable action integration

September 23, 2026

## Integrated

- PRD v0.2 and audit agree on minimal Overview scope; the shared contract defines lifecycle, conservative identity, aggregation semantics and cross-device intent handling.
- MapleCore stores versioned, inspectable obligation identity. Matching source occurrences with the same actor/action/evidence preserve completed or dismissed records and append historical evidence. Distinct occurrences remain eligible. This is exact conservative matching, not general semantic equivalence; rewritten action titles or quotes are not covered by this identity mechanism.
- Done, Later, Waiting, Not needed and same-device guarded Undo now run through a transactional core API and both native bridges. Shared Angular controls retain immutable request IDs for retries. Waiting stores an actor and optional review time; automatic follow-up generation is not implemented. Later preserves the original deadline and returns to eligibility after its resurfacing time.
- Phone snapshots reserve separate actionable, Waiting and Later capacity and carry full category counts, stable activity IDs, original deadline instants and action capabilities. Lost acknowledgements are retried idempotently; unsupported commands receive an explicit non-applied receipt without blocking unrelated sync. Undo remains possible after a completed task disappears or local history is pruned.
- Matching extraction evidence reaches canonical/consolidated tasks without reopening completed/dismissed work. Indexed source-occurrence lookups replace repeated full suggestion scans. Explicit lifecycle corrections survive matching re-extraction.
- Notebook Save a copy preserves edits made while asynchronous file operations are in flight.
- Claude extraction uses a tested text-only SDK configuration. ChatGPT extraction now fails explicitly before prompt submission because the pinned Codex adapter lacks a verified tools-disabled contract. Authentication detection remains available; no automatic provider fallback occurs. See [provider isolation](../../src/providers/ISOLATION.md).
- Mac and phone Overview show at most five non-waiting open actions and six activities. Waiting has a separate count and filtered destination. Needs you and Waiting filters preserve full task access. Recent Overview history suppresses source/transport noise without deleting History.
- Seven synthetic Sugar Maple review pages are saved under Daily actions · Release 1. See [design handoff](DAILY-ACTIONS-DESIGN-HANDOFF.md).
- Offline evaluation protocol, schema, empty templates and scorer are ready. There are no real-data accuracy results yet; 100 sources and 50 visible task instances still need independent sampling/labeling.

## Verification

The integration has regression coverage for lifecycle identity, idempotency, guarded Undo, bounded phone snapshots, activity IDs, notebook copy races and provider isolation. Final test counts are recorded in [the next-slice review](../reviews/DAILY-ACTIONS-NEXT-REVIEW.md). No live model quality result or physical-device validation is claimed.

## Remaining work before Release 1

1. Implement concrete Waiting follow-up/review generation and source-verified blocker-clear transitions. A review timestamp alone must not turn Waiting into Needs you.
2. Complete source-navigation fallback and detailed provenance inspection on both platforms; exercise Mac keyboard actions in the full app.
3. Implement reviewed-membership aggregation without treating separate occurrences as duplicates; test newly arriving children and undo conflicts.
4. Freeze and label the real benchmark, then evaluate the whole pipeline and tune on the separate tuning partition.
5. Verify device reconnect, conflict, notebook download/save integrity and the latest task controls on the physical iPhone.

This is an integrated first slice, not completion of the release or proof that the current live task backlog is accurate. No existing personal tasks were manually completed, dismissed or relabeled for validation.
