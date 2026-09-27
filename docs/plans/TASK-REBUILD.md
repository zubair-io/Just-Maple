# Controlled task rebuild

## Purpose

Replace unreviewed machine output after extraction-policy changes without deleting sources, indexes, facts, user decisions, or the ability to roll back. A rebuild is a maintenance operation, not a blanket task reset or proof that old obligations were completed.

## Review policy

Message extraction evaluates whether a responsibility still exists at review time. It includes bounded later replies in the same account and conversation, while preserving the original source timestamp for relative dates. Only the current source can establish a new obligation. Evidence sent to a model remains limited to the last 30 days.

One-time access material, optional engagement, and obsolete momentary help are not durable tasks. Required paperwork and other unresolved durable work remain valid after a deadline. Permission requests must preserve the user's choice. No replies are sent and no approvals are performed.

The shared policy is used by Apple and ACP extractors. Synthetic evaluation distinguishes old versus current session requests, durable approvals, overdue paperwork, optional invitations, later completion, and substantive onboarding outcomes.

## Safe procedure

1. Pause automatic loops and close the Mac app. Take a SQLite backup using the backup API so committed WAL contents are included. Store backups, plans and review artifacts outside the repository with owner-only permissions.
2. `task-rebuild-plan --db LIVE --output PRIVATE_PLAN` freezes source revisions, task rows, queue state, world revision and protection reasons. It covers existing unreviewed Gmail/iMessage tasks; it is not a rescan of every previously negative message.
3. Copy the backup to an isolated staging database. `task-rebuild-stage --db STAGING --plan PRIVATE_PLAN --runner RUNNER` archives eligible old machine output and reviews the selected sources. Three bounded workers claim persisted jobs. Every planned source must succeed before export; an empty successful result differs from a failed review.
4. Review the generated list. `task-rebuild-export --db STAGING --plan PRIVATE_PLAN --output PRIVATE_BATCHES` rejects changed protected rows and incomplete work.
5. `task-rebuild-consolidate --db STAGING --plan PRIVATE_PLAN --runner RUNNER --output PRIVATE_PROOF` reviews the entire explicitly supplied candidate scope for exact duplicates. Every merge requires source quotes from both obligations. Shared topic alone is insufficient. The operation cannot complete tasks or mutate the stage list. Scopes over 64 candidates or the evidence-size budget fail explicitly.
6. `task-rebuild-promote --db LIVE --plan PRIVATE_PLAN --batches PRIVATE_BATCHES --reconciliation PRIVATE_PROOF` validates the frozen live state and applies the reviewed replacement atomically. It maps staging IDs to actual stored IDs, retains component provenance, and rejects stale or protected changes. There is no overwrite of the live database from the staging file.
7. Reopen the rebuilt Mac app and verify the published companion snapshot. Automatic loops resume on startup. An unsynced phone action must still reconcile through the normal mutation pipeline, never be erased by a file replacement.

## Protection and recovery

Manual or unknown-origin tasks, accepted/linked tasks, terminal or deferred tasks, user actions/corrections, and their connected protected components stay intact. Pure machine duplicate links do not accidentally protect all machine output. Prior superseded rows remain historical.

Each application records before/after state and queue state in the local command history. `rollbackTaskRebuild` refuses rollback after intervening changes rather than overwriting newer work. The private SQLite backup is additional recovery evidence, not permission to replace a changed live database.

## Validation limits

Contract tests cover transactional promotion/rollback, protected records, exact source scope, failed-source export rejection, stale revisions, duplicate proof, and idempotency. Live synthetic results and production-stage review are recorded separately. Neither establishes a measured inbox recall rate; the human-adjudicated 100-message benchmark remains outstanding.

## Development verification — September 24, 2026

- 218 core tests, 28 transport tests, CLI build and native Xcode tests passed.
- Live ChatGPT synthetic cleanup: final 17/17 cases passed. An earlier run failed only a literal vocabulary check for “time” versus “minutes of usage”; the rubric now accepts those equivalent terms while still requiring a decision rather than an instruction to grant permission. The earlier output is retained privately.
- Production maintenance reviewed 130 recent source messages successfully. It archived 143 unreviewed machine records and promoted 30 candidates, with one evidence-backed duplicate link (29 distinct rebuilt items). Sixty protected/historical records were unchanged byte-for-byte. These counts are a cleanup result, not precision/recall measurements.
- Trial promotion and live promotion both passed SQLite integrity checks and exact content comparisons for original events, subject mappings, claims, source facts, fact queues, embedding queues, semantic chunks and canonical tasks.
- Staging caught one legacy extraction retirement of an activity-edited task. User-history protection now covers metadata edits, using an indexed backfill and future history trigger. The narrowly scoped `task-rebuild-repair-retirements` command restored only that exact recorded automatic retirement; it refuses other differences or intervening user changes.
- Reopened Mac showed the replacement list, automatic learning, and successful iCloud publication. Physical iPhone receipt was not directly inspected.

Reconciliation deliberately keeps distinct requirements and umbrella tasks versus their steps separate. Broader workflow consolidation and full human-adjudicated quality evaluation remain separate work. A successful rebuild does not prove every connector or subsequent Jev request is healthy.
