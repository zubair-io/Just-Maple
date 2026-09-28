# Jev usage audit — 2026-09-28

The user reported 124,251,991 input tokens over approximately three days. This audit reads the production SQLite ledger and saved provider usage; it makes no live Jev requests and exports no source text, addresses, credentials or entity names.

## Recorded usage

Production decisions contain **121,036,561 provider-reported input tokens across 10,553 responses**. The successful request dates span September 21–25 UTC; most usage falls on September 22–24. This is 97.4% of the reported total by magnitude, not a proven reconciliation to the dashboard's unknown time boundaries. The remaining 3,215,430 tokens cannot be attributed from production records alone. Separately, locally saved synthetic screening evaluations account for 97,223 input tokens across 40 responses; these are not production traffic. Pre-audit failed/discarded requests or other clients may account for additional usage, but no such attribution is assumed.

| Source | Successful responses | Input tokens | Share of recorded production input |
| --- | ---: | ---: | ---: |
| Home Assistant | 7,335 | 91,575,481 | 75.7% |
| iMessage | 1,708 | 15,474,330 | 12.8% |
| Gmail | 665 | 7,691,332 | 6.4% |
| Apple Calendar | 467 | 3,706,903 | 3.1% |
| Apple Contacts | 250 | 1,454,322 | 1.2% |
| Google Calendar | 115 | 946,298 | 0.8% |
| Other sources | 13 | 187,895 | 0.2% |

Daily recorded input, by decision timestamp (UTC): September 21: 2,668; September 22: 45,531,968; September 23: 51,277,335; September 24: 20,565,630; September 25: 3,658,960. Receipt timestamps were not used to assign request days.

## Causes and evidence

1. **HA fan-out dominated successful usage.** Each changing entity previously created a separate classification request. Average input per successful HA request was about 12,485 tokens. The new ten-minute snapshot path creates one durable aggregate classification job, with only four home-specific questions and linked per-entity evidence.
2. **First-pass context was too broad.** The recent audited HA requests had a median size of 49,289 bytes, and notes 53,599 bytes. Much of that was unrelated world context: activities, tasks, and inferred states. Generic self-only sources also retrieved unrelated recent events via shared `person:self`. Relevant source identity/provenance now governs first-pass history and world selection; duplicate evidence is serialized once. HA batches use their current/prior home observations and relevant home corrections only.
3. **Provider failure did not stop the backlog.** At the paused snapshot, 5,311 queue rows still held the legacy safe HTTP 402 error and three HTTP 403. Recent audit history contained 2,378 classification invocations: 1,884 HA, 430 notes, 64 Gmail, with no successful committed outcomes. No response usage was recorded for those failures, so their billed tokens are unknown, not assumed zero. Per-event retry limits did not prevent unrelated queued events from repeatedly contacting an unavailable account.
4. **Two retry paths were unbounded.** A successful response rejected because context changed was immediately requeued without an attempt cap/backoff. Expired leases could also be reacquired beyond the normal five attempts. The database's attempts above five support investigating these paths, but do not prove which caused each historical repeat; manual retry resets and earlier builds limit attribution.
5. **Unmanaged notebook autosaves amplified requests.** The editor saved after 700 ms idle and each changed saved revision was eligible for classification. Autosaves now have a 120-second quiet window; untouched pending revisions coalesce into the latest one. The local file and immutable evidence still save immediately. A transactional observation chain distinguishes A→B→A from unchanged rereading.

There was no evidence of a general startup loop reclassifying already successful source revisions. Ordinary source identity/revision dedup remains intact. Manual fact checks were not a background loop.

## Fixes and recovery

- Pause all Jev work persistently on account/configuration failures (including 401, 402, 403), with an explicit retry action after resolution. Existing unresolved legacy account failures initialize the hold on upgrade.
- Use shared exponential cooldown for network errors, 429 and server failures; honor a valid Retry-After header for 429/503. In-flight work can finish, but new events and manual fact checks respect the hold. Ordinary job retry does not clear it.
- Record safe HTTP status metadata without retaining private HTTP error bodies or credentials.
- Back off stale classifications and block after five attempts. Expired leases cannot bypass the limit; a valid fifth in-flight response can still commit. Invalid Jev input/output is blocked for inspection instead of resending it five times.
- Group eligible pending HA backlog into shared batches, including due retries, while preserving prior attempts and leaving blocked/in-flight work intact.
- Retain raw observations, attempts, failure states and actual provider output. No model result is synthesized to mark failed work successful.
- Keep first-pass generic/message contexts bounded at 24,576 bytes without silently dropping explicit corrections. Oversized inputs remain inspectably blocked. HA batches retain the existing complete-batch size guard.
- Preserve local note saves immediately while coalescing only unattempted autosave classification work. Active/failed attempts remain intact.

The running older app was paused through its processing controls at approximately 04:56 UTC. Its last recorded Jev invocation was 04:56:43 UTC. A later read confirmed no new invocations while the fix was prepared. Saving/ingestion was not disabled.

## Reproduce without calling Jev

```sh
python3 scripts/audit-jev-usage.py --database "$HOME/Library/Application Support/Just Maple/Intelligence/core.sqlite"
```

The script uses a consistent read-only SQLite snapshot, counts invocation response usage once, avoids counting parent commit copies twice, and falls back to legacy decision usage when an invocation record is unavailable. Output consists only of aggregate counts, bytes, source types and safe error categories. Byte counts are not token estimates. Local evidence cannot replace a complete provider billing export.

## Provider contract and cost context

TypeSafe documents that state is ingested once per request and shared across its questions; six questions do not imply six HTTP calls. Its published direct price is $0.042 per million input tokens, with output free. At that rate the reported 124,251,991 input tokens are approximately **$5.22**, before any account-specific pricing or credits. The excessive volume and retry behavior still warranted fixing. References: [models and pricing](https://docs.typesafe.ai/models), checked 2026-09-28.

## Validation

Regression coverage includes shared account holds and concurrent workers, restart persistence, legacy quota migration, explicit recovery, Retry-After/cooldown timing, stale-context and expired-lease attempt limits, malformed output, context isolation/bounds, note quiet windows, coalescing, concurrent rereads and A→B→A. Transport/storage tests use synthetic providers; they make no paid requests and do not claim improved live model quality.

Validation passed: 348 core tests, 30 transport tests, 186 Angular tests, 69 Mac tests and the audit script's synthetic ledger regression. The MapleCore CLI build, production Angular/Mac build and strict app signature verification passed. The fresh app is `.build/xcode/Build/Products/Debug/Just Maple.app`.

A final read at 05:15 UTC still showed 2,378 audited classification invocations, unchanged since pausing. The app was back in an active note-editing view, so it was not terminated or relaunched. Persistent holds across restart are regression-tested; verification against the live workspace after relaunch remains outstanding. The existing process does not hot reload these changes. After saving and reopening the fresh build, Connections will expose the migrated account hold; resolve the account issue before using its explicit retry action.

## September 28 follow-up: oversized HA batch stopped the queue

After account recovery, eleven more decisions committed before a legacy HA batch returned HTTP 400. A bounded diagnostic replay identified the exact machine error `detail.error_type=max_tokens_exceeded`; private server bodies and credentials were not logged. The batch contained 91 observations across 19 entities, and its original request was 68,243 bytes. Bytes are not token estimates.

The Jev wire representation now interns repeated entity identifiers and sends observation rows with evidence ID, entity index, occurrence time and complete content. Entity subjects remain available to connect user corrections to their entities. Every observation and prior state stays in the single batch request; the original full Context remains the decision/storage authority. No evidence is deleted, truncated or split into per-entity calls.

Only the exact allowlisted HTTP 400 `max_tokens_exceeded` response becomes a source-specific blocked item, with a safe inspectable diagnostic and no automatic repeat. Unknown HTTP 400 errors, authentication/billing holds and transient cooldowns keep their existing safeguards. This also applies to manually requested fact checks without pausing unrelated work.

A live replay of the original failing batch with the compact representation returned HTTP 200 and four answers: 34,032 request bytes, 14,690 provider-reported input tokens, 71 output tokens. This was a diagnostic invocation, not a production decision or a quality evaluation. Regression tests cover lossless compact observations and previous states, continued queue processing after an oversized item, no automatic repetition, and safe error metadata. Provider limits reference: https://docs.typesafe.ai/models (checked September 28, 2026).

Validation: 357 core tests and 30 transport tests passed; the CLI and signed Mac app built successfully. After reopening the updated app and explicitly clearing the old hold, the original rejected batch reached `succeeded` on attempt 2 in the production queue. Subsequent classification responses also committed, with no provider hold present.
