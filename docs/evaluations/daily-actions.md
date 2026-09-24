# Daily-action evaluation protocol and offline scaffold

Status: **scorer plus read-only blind inventory exporter. No stratified benchmark has been labeled or scored.** The JSON templates contain zero samples. The small in-code synthetic fixture tests arithmetic and validation only.

This implements the measurement portion of [the daily-actions PRD](../product/PRD-JUST-MAPLE.md), section 8, and [the product audit](../product/PRODUCT-AUDIT-2026-09-23.md). The audit's 115 open tasks, 27 activities and 48 screen-time tasks are descriptive observations, not labeled accuracy results. None is used as a gold label or sampling shortcut here.

## Freeze two independent samples before tuning

1. Freeze a local source-message inventory with a recorded snapshot timestamp, connector/account/source identity and original occurrence time. Select from imported **and discoverably missing/failed** recent source messages, not just messages that already generated tasks. Record connector scope and import gaps in `selection.method`; an inventory consisting solely of successful task outputs cannot measure recall.
2. Assign sources to these mutually exclusive sampling strata without consulting pipeline task predictions. A reviewer can use source content and thread context to allocate strata; these are sampling strata, not the eventual gold judgments.

| Source stratum | Count | Include |
|---|---:|---|
| `conversational_info` | 30 | Ordinary conversation, FYI, acknowledgments, useful information without a request |
| `direct_obligation` | 30 | Requests, decisions, renewals, commitments owed by the user; diverse senders/domains |
| `waiting_delegated` | 20 | Another person's promise, submitted work, delegated work, blocked obligations |
| `calendar_time_sensitive` | 10 | Invitations, scheduling requests, cancellations, explicit short-lived deadlines |
| `noise_transport` | 10 | Automated delivery/polling notices, marketing, duplicate notifications and other noise |
| **Total** | **100** | Source time must meet the existing 30-day lower cutoff; known future scheduled items are eligible |

Calendar/time-sensitive is a message-content category; do not fill the sample with unrelated calendar or Home Assistant polling observations solely to meet quotas. If the eligible source inventory cannot fill a stratum, report the shortage. Do not fabricate examples or silently substitute one stratum for another. Keep a duplicate request occurring as a genuinely separate message for reconciliation assessment, but do not count source revisions/copies of the same connector/account/external ID as independent samples.

3. Separately select **50 visible task instances** across frozen evaluation snapshots. Include Needs you, Waiting, Later, detected and manual tasks, repetition, already-resolved work and short-lived requests. Always include every first-ten Needs you slot (or all slots when fewer than ten exist) for each snapshot used for the top-list gate. Fill remaining places using recorded random selection across visible surfaces. The 50-task sample measures the quality of surfaced work; it cannot establish source recall.
4. Record an opaque seed, selection method and freeze timestamp. Suggested allocation is 80 held-out sources / 20 tuning sources, distributed 24/6, 24/6, 16/4, 8/2, 8/2 across the strata. Keep thread families, near-duplicates, repeated task instances and closely related evidence in one partition; reduce/replan the split when group separation requires it. Never move a poor holdout result into tuning. Snapshot sets for top-list comparisons should be independently held out. Record exclusions and deviations in a separate local review log referenced by `selection.method`.
5. Use opaque local account references; avoid secrets, full email addresses and raw message bodies in manifests. `localEvidenceRef` may point to an access-controlled local review artifact; the scorer does not read it. Preserve source IDs/revisions and source event IDs so a reviewer can inspect evidence. Keep private manifests, labels and outputs outside the committed repository. The committed files are empty templates and synthetic test code only.

## Human labeling

Label source obligations before seeing predictions, then freeze those labels. A separate matching pass may add `matchedPredictionIDs`; it must not change the original obligation judgment to fit outputs. Label responsibilities as of the frozen snapshot using source/related context available by that time. Do not use later events to make a past prediction look correct.

Source labels:

- `obligation`: one or more clear, outstanding user obligations. Give each concrete obligation a separate stable local ID. Include supported future actions, not just immediate deadlines.
- `non_obligation`: no clear outstanding action owed by the user. Another person's promise is not automatically a user action. A valid waiting/monitoring item may still exist; it must not become Needs you without a justified follow-up.
- `ambiguous`: responsibility, completion, relevance or intended action cannot be decided confidently. Use no gold obligations and record the uncertainty in `reason`.

For each clear obligation, match only task IDs that the **whole pipeline actually surfaced**, with the right action, responsible person, timing and surface. An extractor's proposed task that never survives ingestion, reconciliation or UI projection is not recalled. An unrelated task mentioning the same company/person is not a match. Multiple source messages may support one consolidated task; a single vague task must not be credited for several distinct obligations unless it clearly represents them all.

For each visible task sample, label `actionable` as `yes`, `no`, or `ambiguous`: does this describe a useful, concrete next action for the user at the snapshot time? In the broader 50-task sample, intentional Waiting items may be `no` for current actionability without being product errors; analyze by surface before interpreting the aggregate. The release target applies to **Needs you**, not every legitimate monitoring item.

For every automatic completion associated with either sample, independently label `supported`, `unsupported`, or `ambiguous`, inspecting its source evidence and chronology. A reply being opened, a promise to act, elapsed time, an expired request or a model's confidence does not establish completion. User-marked Done actions are not automatic completions and must not inflate this denominator. Keep all sampled transitions, including those whose completed tasks are no longer visible. If a transition relates to multiple sampled sources, include it once under a stable transition ID.

Use reviewer and reason fields to document decisions and disagreements. Adjudicate disagreements or retain `ambiguous`; never force an uncertain case into a positive/negative label. Blind obligation labeling, inter-reviewer agreement and partition independence are human protocol requirements, not facts the scorer can verify.

## Data contract

[daily-actions.schema.json](daily-actions.schema.json) is a Draft 2020-12 JSON Schema for the three document kinds. The scorer uses Python standard-library semantic validation for identity, reference, timestamp and denominator checks; it does not run a general JSON Schema engine. Generic JSON Schema validation may be added in a local review environment without sending data elsewhere.

- [Manifest template](daily-actions.manifest.template.json): empty `sourceSamples`, `taskSamples` and `snapshots`. Replace every placeholder and example timestamp before collecting real data. Source entries track connector/account/external ID/revision, original `occurredAt`, `snapshotAt`, 30-day eligibility, stratum and `holdout`/`tuning` designation. Task samples track stable task ID, version, source event IDs, snapshot and partition. Repeated task instances across snapshots need distinct sample IDs but must stay in the same partition.
- [Labels template](daily-actions.labels.template.json): source judgments and obligation matches; visible-task actionability; automatic-completion support. Optional reviewer/reason fields carry the local audit trail.
- [Predictions template](daily-actions.predictions.template.json): whole-pipeline run identity/version/time; per-source processing status and final `surfacedTaskIDs`, with `needsYouTaskIDs` as their subset; per-task final surface; all automatic-completion transitions in scope. `modelEvidence` on source and task predictions lists each actual model-input event ID, original occurrence time and send time, including retrieved context. Empty evidence lists mean no model call was made, not that telemetry was omitted. Preserve failure/pending/skipped outputs; do not drop misses.

`surfacedTaskIDs` may include valid Waiting or Later tasks. `needsYouTaskIDs` identifies which of them consumed direct-action attention. This distinguishes monitoring from false urgency. Task snapshot top lists must agree with predicted Needs you membership.

Raw extractor output is not accepted as an end-to-end result: `wholePipeline` must be true and the local collector must actually derive output after routing, extraction, reconciliation, user corrections and final presentation. The flag is a provenance assertion, not an automated guarantee. The separate blind inventory exporter reads imported source messages only; it is not a whole-pipeline prediction exporter. This scaffold contains **no complete live collector or replay runner**. Capturing complete model-input telemetry and matching final UI IDs remains integration work.

## Run offline

```sh
python3 scripts/daily-action-score-test.py
python3 scripts/daily-action-score.py /private/local/manifest.json /private/local/labels.json /private/local/predictions.json > /private/local/report.json
```

The scorer only reads the three paths supplied and prints JSON. It never opens the application's database, scans other files, sends model requests, changes tasks or starts connectors. Use a separately captured local snapshot; do not mutate live records to manufacture a benchmark result.

## Metrics and denominators

All results are separated into `holdout` and `tuning`. Tuning results do not satisfy held-out gates.

| Metric | Numerator | Denominator |
|---|---|---|
| Obligation recall | Clear human obligations matched to a valid surfaced task | All clear human obligations in eligible sampled sources, including pipeline failures and missing outputs |
| Negative-source Needs you rate | Clearly non-obligation sources that caused a Needs you item | All clearly non-obligation sampled sources |
| Visible-task actionability | Tasks judged currently useful/actionable | Task instances labeled yes/no; ambiguous and unlabeled are reported separately |
| Top-list actionability | Useful/actionable items in the first ten Needs you slots per snapshot | Clearly judged slots in that snapshot; gate remains unassessed with any ambiguous/unlabeled/unpredicted slot |
| Unsupported automatic completion rate | Automatic completion transitions judged unsupported | Transitions judged supported/unsupported, with ambiguous/unlabeled/total observed counts separate |

The scorer reports rates as numerator, denominator and decimal rate. Zero denominators produce `null`, never 100%. Missing source predictions still leave clear obligations in the recall denominator. Unsupported completion checks with zero observed completions are `null`/not exercised, not evidence of safe completion inference.

The provisional PRD gates are 85% held-out obligation recall, at least 90% useful/actionable items **in every evaluated held-out top list**, and zero unsupported automatic completions. When a top list has fewer than ten items, its actual count is the denominator; across-snapshot results are not padded or silently pooled. Report each snapshot because a strong list must not hide a poor one. Ambiguous source obligations are excluded from recall and counted separately; their frequency remains important context when reviewing any apparent pass.

Eligibility uses original source occurrence time, not receipt/index time, with the timezone-aware inclusive 30-day lower cutoff from `AIProcessingWindow.includes`: source time must be at or after snapshot/send time minus 30 days. There is no upper cutoff; known future scheduled events remain eligible. Model-input checks use each actual send time, including retrieved evidence. Sources older than 30 days may remain locally indexed; they are not eligible for this recent-message sample or model input. A supplied eligibility flag inconsistent with dates is rejected. Ineligible rows are listed and cannot fill the 100-source quotas. Do not confuse a future scheduled date with knowledge received after the evaluation snapshot: future scheduled events already known at the snapshot are allowed, while retrospective human labeling still must not use later-acquired knowledge.

`sampleReadiness.complete` only checks count/reference/label/output coverage. It cannot certify representative selection, truthful telemetry or good labels. Partial reports may show provisional gate calculations; the final conclusion always remains `not_established` pending human review and the separate reliability gates. Review error examples as well as aggregate rates. These small counts are not a statistically broad accuracy guarantee.

## Remaining gap and release checks

- **Labeling gap: 100 real source messages and 50 real visible task instances still need selection and human adjudication.** No live baseline or accuracy improvement is established here.
- Freeze partition membership before tuning, inspect local evidence, collect whole-pipeline predictions and automatic-completion transitions, then run the scorer.
- Record false negatives, incorrect responsibility, wrong timing, repeated obligations, waiting work incorrectly demanding attention, unsupported completion, and correction persistence failures in the local review log.
- Reconnect/restart idempotency, acknowledged-command durability, correction persistence, real-phone notebook safety, no automatic external actions, source-to-surface delay and freshness remain separate acceptance checks. This scorer does not convert their absence into a release pass.

## Blind source inventory

Run `python3 scripts/daily-action-inventory.py --db /private/path/core.sqlite --output /private/new-directory --seed REVIEW_SEED` to freeze the latest imported Gmail/iMessage revisions known at the snapshot time. It uses a read-only SQLite transaction, includes only the rolling 30-day source window, writes owner-only local files, leaves labels blank and assigns deterministic conversation-level partitions before tuning. It does not expose predictions in the labeling file, alter tasks, or call a provider. Test with `python3 scripts/daily-action-inventory-test.py`.

A private inventory was frozen on September 24: 2,031 imported messages (399 Gmail, 1,632 Messages). These are inventory counts, not an accuracy result or the final 100-source sample. Upstream import gaps remain outside this inventory; human stratification, adjudication, the separate 50-task sample and complete inference telemetry are still required. No private content is committed.

Synthetic provider smoke tests are separate from the benchmark: `just-maple evaluate-message-tasks --provider apple` or `--provider claude --runner /absolute/path/src/providers/runner.js`. They do not change the app's selected provider or read personal messages. A provider failure propagates as failure, never a substitute answer.

The exporter also writes `review.html`, a standalone local review page with blank judgments, stratum quotas and explicit download/resume. It sends no data and deliberately does not autosave. Sources are rendered as text; embedded HTML/script cannot execute. Use the v2 inventory for review: it supersedes the initial unlabeled v1 before any tuning, and keeps a conversation within one partition. The page produces a human review draft; it does not claim scored benchmark completion or replace adjudication.
