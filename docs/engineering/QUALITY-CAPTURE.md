# Local quality capture and prospective provider evidence

September 30, 2026. This implements capture infrastructure for the main PRD's quality gates. It does not establish model quality, supply human labels, or declare whole-pipeline coverage complete.

## Explicit capture from Processing

The collapsed **Local quality capture** panel on Mac Processing saves the currently accepted unfiltered Needs you, Waiting and Later task projections. It uses the same ranking and filter functions as the actual task tabs; it does not reproduce ranking in Swift or Python. Canonical and rendered suggestion identities/versions are both retained. Waiting/Later overlap is intentional. The first ten Needs you rows are recorded, not the Overview's smaller viewport or Today block order.

The action is inert until selected. It sends no provider request and changes no tasks. Its privacy text explains that the bundle contains private source/task evidence and stays outside iCloud. Files are saved beneath the app's private Application Support `QualityCaptures/<captureID>/` directory. Directories use mode 0700 and files 0600.

The web service freezes exact accepted world JSON, computes SHA-256 hashes of that world and the canonical UI projection, and rejects a change during asynchronous hashing. Native checks request hashes, the cached accepted world and projection identity/version references. Inside one pinned SQLite read transaction, Core compares the current world with the accepted world using its original UI clock, then creates a database backup. A mismatch returns a typed `stale` result; it is never recast as a historical snapshot.

The database backup uses the [SQLite backup API](https://www.sqlite.org/c3ref/backup_finish.html) within a source read transaction. It includes committed WAL content and remains bound to the validated read snapshot. It never copies the live database and WAL as independent filesystem files. A regression commits another connection's write between the pinned read and backup and verifies that the frozen copy retains the earlier snapshot.

The staging directory contains:

- `world.json`: exact accepted UI world bytes.
- `projection.json`: frozen ordered UI identities, versions and evidence IDs.
- `core.sqlite`: consistent local database snapshot, including sources, tasks, history and provider records.
- `capture.json`: receipt, hashes, database size, read start/finish times, invocation counts and explicit coverage limitations.

Files are synchronized before publishing the directory by rename. A saved receipt is returned only after publication and parent-directory synchronization. An ambiguous response is retried with the same capture ID and byte-identical request. Native checks an existing published bundle before checking mutable UI state, validates its receipt and artifact hashes, and returns its original receipt. A changed request cannot reuse the ID. Failed/partial staging directories do not count as saved captures; only this attempt's unpublished staging directory is cleaned up.

`capturedAt` is the web collection time. `world.asOf` is the UI's ranking/filter clock. The manifest separately records the database read interval; these times are not interchangeable. A capture is an input bundle with `evaluation: not_run` and `pipelineCoverage: unknown`, not a scorer-ready predictions file.

## Prospective invocation ledger

`provider_invocations` binds job, attempt and invocation identities, parent repair identity, provider/model, exact input hash and dispatch metadata. `provider_invocation_events` retains ordered context, dispatch, response, transport and validation records. Existing source artifacts remain inspectable; dispatch artifacts expose normalized evidence metadata rather than a blank placeholder.

Each participating adapter persists its actual final input, then awaits a durable dispatch-intent record immediately before transport/inference. ACP dispatch runs after local provider, prompt and runner preflight. Failed audit persistence prevents execution. Input hashes, invocation identity and dispatch records cannot silently change within one invocation. Repair attempts have their own identity and parent link. Successful job/history transactions remain the authority for application effects; a separate post-commit audit failure cannot turn a committed result into a failed job.

The intent timestamp records the attempted dispatch boundary. It does **not** prove a server received or billed the request. A crash between durable intent and transport leaves the outcome unknown. Responses and retained transport outcomes provide subsequent evidence. Schema cutover metadata is not a claim that all old work was observed.

Adapters declare evidence from the actual filtered/pruned input: TypeSafe classification/fact checks, Laya per-question inference, Apple/ACP fact and task extraction, state extraction, task and staged reconciliation, obligation grouping, activity discovery/repair, and inline Maple intent/answer requests. CLI task previews use the same audited extraction adapters under a separate `task_preview` stage and remain non-applying previews. Compact HA capture omits fields omitted by the actual request. Source occurrence dates come from the input or the matching immutable stored event; claim observation dates and task-update times are not substitutes. Unknown references remain partial, and contradictory known dates are rejected.

Derived activity/task prose without complete upstream provenance remains partial. Reconciliation therefore does not claim complete lineage merely because a task lists a source ID. Observation-only discovery can have complete direct-input evidence; that local assertion still does not certify the entire upstream pipeline.

Inline attempts persist their context and attempt identity together. Configured providers acknowledge dispatch only after preflight; legacy/fixture providers do not invent a dispatch boundary. Cancellation is checked again before dispatch, and rejected responses retain validation outcomes. State inference and staged reconciliation commit their application audit with their result; replaying a completed result does not make another model call. Explicit retries retain distinct attempt identities.

## Remaining work

The offline v2 scorer already refuses to establish gates from missing/partial capture and retains all selected samples in denominators. The [offline prediction exporter](../evaluations/daily-action-predictions.md) now binds explicit frozen bundles to independently selected source/task manifests, retains final surfaced identities, and exports known automatic transitions. Its diagnostics preserve dispatch intents separately from model send telemetry. It neither certifies exhaustive completion scope nor turns a dispatch-intent count into proof of full telemetry. Upstream lineage and complete historical observation remain unknown; old processing is never relabeled as newly observed.

The production callsite audit covers the paths above. `UserResponse.swift` ingests explicit feedback and performs no model call; the provider connection test sends a fixed probe with no source evidence, and quality-evaluation/validation harnesses use synthetic inputs. These are distinct from production source processing. Derived task/activity prose and user-entered requests still lack complete upstream lineage; auditing callsites does not establish that lineage or retroactively cover older work. Human selection/adjudication of 100 sources and 50 tasks, live model quality, physical iPhone/iCloud behavior, native IME and VoiceOver gates remain separate work. No real user-data capture or human label was created during this implementation; all automated tests use synthetic temporary data.
