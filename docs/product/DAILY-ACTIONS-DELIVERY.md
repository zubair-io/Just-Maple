# Daily actions — first parallel implementation

September 23, 2026

## Integrated

- PRD v0.2 and audit agree on minimal Overview scope; the shared contract defines lifecycle, conservative identity, aggregation semantics and cross-device intent handling.
- MapleCore stores versioned, inspectable obligation identity. Matching source occurrences with the same actor/action/evidence preserve completed or dismissed records and append historical evidence. Distinct occurrences remain eligible. This is exact conservative matching, not general semantic equivalence; rewritten action titles or quotes are not covered by this identity mechanism.
- Companion transport has backward-compatible typed command schemas for Done, Later, Waiting, Not needed and Undo, with payload validation and revision-based concurrency. These new intents are contract-only, explicitly rejected by the Mac until lifecycle dispatch is implemented; they are not exposed in the app. Existing completion remains supported.
- Mac and phone Overview show at most five non-waiting open actions and six activities. Waiting has a separate count and filtered destination. Needs you and Waiting filters preserve full task access. Recent Overview history suppresses source/transport noise without deleting History.
- Seven synthetic Sugar Maple review pages are saved under Daily actions · Release 1. See [design handoff](DAILY-ACTIONS-DESIGN-HANDOFF.md).
- Offline evaluation protocol, schema, empty templates and scorer are ready. There are no real-data accuracy results yet; 100 sources and 50 visible task instances still need independent sampling/labeling.

## Verification

131 core tests, 22 transport tests, 39 Angular tests, 32 Mac tests, 15 iPhone unit tests and the iPhone UI suite passed. Eight synthetic scorer tests passed. CLI build, updated Mac build and signed physical-iPhone build succeeded. Native suites ran before the final Angular filter/navigation refinement; the Angular suite and both native bundles were rebuilt afterward. No app installation on the physical iPhone or real-data quality certification is claimed by this record.

## Remaining work before Release 1

1. Implement the full lifecycle store/dispatcher for Later, Waiting review time, dismissal and guarded Undo. Preserve existing persisted statuses through a tested migration/projection.
2. Wire those supported commands through both hosts and the shared task-detail design; add source-navigation fallback and keyboard behavior.
3. Implement reviewed-membership aggregation without treating separate occurrences as duplicates; test newly arriving children and undo conflicts.
4. Freeze and label the real benchmark, then evaluate the whole pipeline and tune on the separate tuning partition.
5. Verify device reconnect, conflict, notebook download/save integrity and the latest task controls on the physical iPhone.

This is an integrated first slice, not completion of the release or proof that the current live task backlog is accurate. No existing personal tasks were manually completed, dismissed or relabeled for validation.
