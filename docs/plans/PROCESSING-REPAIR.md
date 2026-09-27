# Processing repair plan

## Outcome

Recent messages reach Jev automatically, plausible obligations reach deeper review, and only evidence-supported tasks reach the user. Local indexing remains independent. Nothing sends a reply automatically.

## Work and acceptance

1. **Separate screening from interruption.** Audit the exact message questions. Add an explicit task-review signal: a possible obligation deserves examination without implying an interruption or an accepted task. Exclude optional surveys/marketing from reply obligations. Preserve typed failures, raw responses, question versions and evidence. Test positive, negative, ambiguous, historical and outgoing cases.
2. **Repair source context.** Use connector-authored direction and conversation boundaries. Self-addressed automated mail is not necessarily outgoing. Shared `person:self` must not retrieve unrelated conversations as evidence. Verify real sender metadata and synthetic cross-thread tests.
3. **Bound redundant Home Assistant work.** Preserve observations and indexing. Coalesce only provably redundant unleased telemetry, record the reason, retain discrete/safety transitions, and measure actual coverage. Exposed entities are a collection boundary, not a guarantee that every numeric increment merits an AI call.
4. **Measure the queues.** Report classification and deeper-review counts separately, expired leases separately from active requests, pending age, and throughput between snapshots. Never infer task accuracy from successful processing.
5. **Validate and ship.** Run core regressions, CLI build and native checks for native changes. Exercise real providers on a labeled synthetic matrix without user data or production task writes. Inspect the live queue after restart. Record failures as failures. Keep private evidence outside the public repository.

## Release evidence

Synthetic contract tests establish routing/storage correctness, not model quality. Live synthetic results establish only that matrix. The separate 100-message human-adjudicated benchmark remains required for a recall claim. Do not hardcode the user's examples, silently lower all confidence thresholds, or erase old decisions to manufacture improved results.

## Progress

- Baseline: supplied inbox messages were classified, but most retained; this is a quality gap, not proof they contain no obligations.
- Confirmed code gaps: optional-request wording in reply question; no distinct high-recall review signal; semantic context includes shared self identity; numeric HA observations accumulate while indexing and AI work share the same intake.
- Implementation and measured results are appended after validation.

## Screening policy calibration

Review is an internal second opinion, not a task decision. Any of the independent review/action/commitment signals at or above 0.50 queues deeper review. Interruption retains its stricter thresholds. The initial 0.65 review-only cutoff missed a definite waiting commitment in a live synthetic test; broadening the matrix exposed another commitment that the separate commitment signal detected. This is tuning evidence, not held-out validation. Backfill uses the same rule for eligible stored message decisions, uniquely keyed by source event; it does not erase original Jev responses or reclassify historical messages as new arrivals.

## Implemented and validated

- Message questions v3 distinguish optional engagement from an owed reply. Screening queues review independently of interruptions and summary generation; summaries alone no longer cause task extraction.
- Same-thread message retrieval, Gmail `SENT` direction, and strict Gmail ownership validation prevent unrelated context and another person's promise becoming a user action.
- Screening saves the actual context sent to Jev. Deeper review rebuilds richer current context. UTF-8 excerpts honor byte budgets without corrupting multibyte text.
- HA observation retrieval uses entity subjects rather than shared self identity. Commit validation checks the same state/fact versions without repeating semantic/world retrieval. Expired leases take precedence within their connector lane.
- Failed task reviews retain safe error categories. Known transient errors have capped retries; unsupported evidence stays failed. The app's existing Retry action now includes eligible task-review failures. A CLI `retry-task-reviews --db PATH` queues recovery through the same store API.
- Cumulative-energy increments can coalesce unstarted redundant model work while preserving every source and index entry. History identifies these as Indexed, not Processed. This intentionally does not drop instantaneous measurements or safety transitions.

Validation on September 24, 2026:

- 197 core tests and 28 companion transport tests passed; 44 native tests and 71 Angular tests passed. CLI and Mac app builds passed.
- Live Jev synthetic screening: final 15/15 expected routing/review outcomes. Earlier runs failed waiting-commitment cases and are retained locally as tuning evidence.
- Live ChatGPT extraction: 8/8 synthetic Gmail/iMessage ownership cases passed (incoming promise, outgoing promise, tentative plan, direct request). This tests extraction separately from screening; it is not an end-to-end inbox recall result.
- Isolated database timing: HA context 3.565s → 0.093s; commit validation 0.00016s instead of a second full retrieval. These are local measurements, not guaranteed production latency.
- Live observation after restart: seven Gmail classifications completed in 85 seconds, versus one in an earlier 89-second window. Different bounded windows, not a controlled load benchmark.

## Remaining limits

The existing HA measurement backlog is retained and still large; the conservative energy-counter rule cannot retrospectively coalesce observations lacking metadata. A bounded measurement-window summary that preserves extrema and safety transitions needs separate design and tests. The 100-message human-adjudicated quality benchmark is still unlabeled. Existing task cleanup is handled by the separately reviewed, rollback-backed [controlled rebuild](TASK-REBUILD.md), preserving user edits and original evidence. Model-contract failures remain visible rather than being retried until a model happens to agree. Actual inbox precision, backlog-clearance time, and downstream completion still need observation; passing synthetic tests does not establish those outcomes.
