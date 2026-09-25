# Read-only processing health

Run from the repository root with Python 3 (standard library only):

```sh
python3 scripts/processing-health.py "$HOME/Library/Application Support/Just Maple/Intelligence/core.sqlite" > /tmp/maple-health-first.json
# Later, after the app has had time to process work:
python3 scripts/processing-health.py "$HOME/Library/Application Support/Just Maple/Intelligence/core.sqlite" --previous /tmp/maple-health-first.json > /tmp/maple-health-second.json
python3 scripts/processing-health-test.py
```

The script opens SQLite using `mode=ro`, sets `query_only`, and reads one transactionally consistent snapshot, including committed WAL data. It does not start processing, recover leases, create a database, change classifications, or contact providers. It selects only queue status/timing and source connector/timing columns. It never selects message content, accounts, external IDs, errors, lease tokens, or provider responses. Unknown connector/status values are folded into `other`; no database path is included in the report. Keep operational snapshots local even though they contain only aggregate counts.

## Interpretation

`classify` is Jev routing, while `task_review` is downstream task extraction; completed classification does **not** mean a task was reviewed or created. Fact extraction, state extraction and local embedding indexing are reported separately. Missing tables are explicitly unavailable, not empty queues. Cross-source reconciliation/grouping batch jobs are outside this event-queue report and must not be attributed to a single connector.

Each connector reports pending, active leased, expired lease, failed and completed inventory. `leased` combines native leased/processing/running states. `expired_lease` is separate, not included in active leased. `completed` combines succeeded/done. Superseded and deliberately excluded work remain separate. Orphaned source rows and invalid source timestamps are counted explicitly.

`eligible_pending` means within the 30-day source occurrence window and retry time reached. At exactly 30 days, a source remains eligible. Older sources are excluded from model eligibility even if their queue state has not yet been changed to `outside_window`; `old_unfinished` identifies that inventory. Local indexing has no age cutoff. This is an age/retry eligibility estimate; connector-specific policies or later routing guards can still suppress dispatch. `oldest_eligible_pending_age_seconds` measures time since source **receipt**, not queue insertion (the event queues do not store an insertion timestamp), and is null when none qualify. Expired leases are not counted as pending.

`--previous` computes net completed inventory change and rate per minute separately for each stage and connector. Use snapshots of the **same database**; no identifying database fingerprint is emitted. This is not an execution ledger: resets/deletions can produce negative deltas, retries can run without changing completed inventory, and newly received historical completed records can increase it. A zero delta alone is not proof of a stalled provider. Correlate with pending ages and lease expiry, then inspect safe app diagnostics locally. Never infer extraction accuracy from throughput counts.
