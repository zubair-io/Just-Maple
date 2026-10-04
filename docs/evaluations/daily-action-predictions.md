# Export predictions from frozen local captures

This offline tool converts explicitly supplied **Local quality capture** bundles into the v2 daily-action scorer format. It reads no live app database, discovers no captures automatically, calls no providers, changes no tasks and creates no human labels. Synthetic tests establish exporter mechanics only.

A capture saves the accepted world, the shared UI's ordered unfiltered task-tab projection and a pinned SQLite backup. The exporter consumes that recorded projection; it neither implements another ranking algorithm nor reconstructs historical UI. The projection includes all tab members, not the viewport, Overview's smaller list or Today document block order.

## Explicit inputs

First create a capture using the Mac's secondary Processing inspection panel. Separately select and freeze the source/task sample manifest according to `daily-actions.md`. Only bind samples to captures that actually exist: a historical manifest timestamp cannot be approximated using a current capture.

Create a private JSON mapping file:

```json
{
  "schemaVersion": 1,
  "snapshots": {
    "snapshot-selected-1": "CAPTURE-UUID"
  },
  "sources": {
    "source-sample-1": {
      "captureID": "CAPTURE-UUID",
      "eventID": "IMMUTABLE-SOURCE-EVENT-ID"
    }
  },
  "accounts": {
    "opaque-account-ref-from-manifest": {
      "connector": "gmail",
      "account": "EXACT-STORED-LOCAL-ACCOUNT"
    }
  }
}
```

Every selected snapshot and source sample needs exactly one binding; supply exactly the referenced capture directories. The account map resolves opaque manifest references to the native immutable source identity. It must cover exactly the account references in the selected source samples. Aliases cannot make the same actual connector/account/external ID count twice, including across revisions.

Snapshot `at` and source `snapshotAt` must equal the capture receipt's `capturedAt`. Task samples use the projection's **rankedNode ID and version**, including the `task:` or `source:` prefix. These can differ from the rendered suggestion's ID/version. Task `sourceEventIDs` must match the recorded merged projection list, including its order. The manifest's Needs you count and first-ten sample order must match the captured projection exactly. Waiting/Later overlap is preserved in diagnostics; the scorer's single surface field uses Waiting for a row belonging to both.

```sh
chmod 600 /explicit/private/sample-manifest.json /explicit/private/snapshot-map.json
python3 scripts/daily-action-predictions.py \
  --capture /explicit/private/QualityCaptures/capture-uuid \
  --manifest /explicit/private/sample-manifest.json \
  --snapshot-map /explicit/private/snapshot-map.json \
  --pipeline-version reviewed-build-or-commit \
  --output /explicit/private/new-predictions
```

Repeat `--capture` for additional bundles. The output parent must exist; the output directory must not exist. The tool never overwrites it. A valid relocated bundle needs its original receipt path to match: casually moving a capture does not preserve this binding. Do not edit a bundle or recompute its hashes to make it pass.

## Validation and private output

Before opening SQLite, the exporter checks all supplied capture receipts, capture/directory identities, exact JSON/request digests, database size and digest, timestamp ordering and projection identity/version bindings. Symlink files/directories and database journal/WAL sidecars are rejected. It opens only each explicit frozen `core.sqlite` using `mode=ro&immutable=1`, checks database integrity and world revision, and compares retained task records with the accepted world. Source bindings must match connector/account/external ID/revision and occurrence time. Missing or mismatched selected identities abort the export; they are not silently removed from the denominator.

Projected provenance can include merged tasks, linked suggestion events and progress evidence. Its IDs must exactly match the ranked node’s linked suggestion, transitive relation-member and progress provenance, and exist in the frozen immutable source table. The captured shared projection remains authoritative for membership and ordering. Hashes detect artifact corruption; they are not a cryptographic signature or proof against a deliberately forged bundle.

All captures are rechecked for changes before publication. The tool stages files with mode `0600` inside a directory with mode `0700`, synchronizes them, and publishes the directory atomically with exclusive no-replace semantics on macOS/Linux. These outputs contain private local identities and audit metadata; keep them private and outside public repositories or shared folders.

- `predictions.json` contains every selected source/task output, including failed, pending, skipped and not-yet-scheduled work. Source status follows the app's aggregate queue semantics, including HA batch identity. Absent pipeline output becomes pending with unknown coverage.
- `diagnostics.json` binds every sample to its capture, revision, hashes and observed projection; retains rendered and ranked identities, tab overlaps/counts, database observation intervals and retained dispatch/audit outcomes. Raw prompts, response bodies and account names are not copied into diagnostics.

`capturedAt` is the web capture time; `world.asOf` is the accepted UI clock. Database states were observed during `databaseReadStartedAt`–`databaseReadFinishedAt`, which can be shortly later. A native-permitted clock skew is labeled explicitly. The exporter does **not** claim those source queue states existed at the exact earlier web timestamp.

## What the export proves—and leaves unknown

`wholePipeline: true` identifies final accepted UI outputs and committed source/task history from verified captures, after normal routing/reconciliation/corrections. It does not identify raw extractor predictions and does not certify pipeline completeness. Unknown telemetry or completion-history coverage is represented separately and keeps all quality gates unassessed.

Known automatic completion transitions come from durable `task.completed` history with actor `task-reconciliation`, validated before/after states. User Done actions are excluded. Every relevant retained transition is preserved, including tasks no longer visible. Repeated captures deduplicate the same immutable history identity. All selected-sample associations remain in diagnostics; the scorer's single association is chosen deterministically. A transition associated with conflicting holdout/tuning splits rejects the export instead of silently assigning it to one split.

Completion proof IDs are emitted only when the exact history correlation token binds a provider attempt whose retained response agrees with the committed reconciliation job response. Matching committed input node provenance and duplicate groups merged in that same response preserve all relevant source-sample associations. Otherwise the known transition remains, with empty proof IDs and an explicit gap. Task provenance is retained separately; it is not relabeled as evidence that the action was completed. Unrecognized completion actors and incomplete older history prevent a complete-coverage assertion.

The invocation ledger records **dispatch intent** `attemptedAt`, plus retained response/transport/validation outcomes. An intent does not prove transport actually occurred. The exporter retains those records in diagnostics and never turns `attemptedAt` into `sentAt`. `modelEvidence` remains empty, `modelCallCount` remains null, and run/sample/completion-history coverage remains unknown. Empty evidence means unknown, not zero calls or a passing 30-day gate.

The output says `evaluation: not_run`. Human labels must still be independently supplied to `daily-action-score.py`; this exporter does not judge actionability, obligation matches or completion correctness. A report produced with these partial-coverage predictions cannot establish release quality.

## Regression checks

```sh
python3 scripts/daily-action-predictions-test.py
python3 scripts/daily-action-score-test.py
```

Fixtures are explicitly synthetic and temporary. Tests cover final projection mapping, ranked/rendered versions, merged/progress provenance, failed/pending/skipped inclusion, HA batching, overlaps, source-account aliases, history deduplication, completion proof and split separation, corruption/mutation rejection, privacy modes and exclusive publication. Native integration additionally exercises the exporter against a real Core-generated temporary capture, including Swift JSON request hashing.
