# Home Assistant classification batches

Automatic HA snapshots import every ten minutes; explicit Import now still runs immediately. A nonempty change set creates one `home.batch` event and one classification job, atomically with the individual source observations. An unchanged snapshot creates neither a batch nor a request.

Jev receives one request with four probabilities for the entire batch:

- `notify`: Does this show a consequential home problem requiring attention now?
- `ask_user`: Does this establish a concrete unresolved choice for the user?
- `reason`: Does a consequential change require deeper analysis across observations?
- `summarize`: Is this a meaningful home update worth a daily-note FYI?

Job-search and personal-fact extraction questions do not apply. Existing routing thresholds still govern downstream work; screening does not execute home automations. The summary signal remains subject to the existing proposal workflow.

`home_batch_members` preserves the current and previous evidence IDs. Current observations are supplied in `relatedEvidence`, prior states in `recentEvents`, and relevant home corrections in `currentState`. Unrelated messages, tasks, activities and personal facts are omitted. No observed entity is silently dropped to fit the request: contexts over 256 KB remain failed/pending with local evidence retained. This is snapshot comparison, not a continuous HA event subscription; intermediate transitions between polls are not captured.

Members remain individually searchable and have a `batched` classification stage linking to the parent. Only the parent owns the aggregate decision, provider requests/responses, attempts and retry control. Sources projects the parent processing state onto member rows without claiming that each member independently triggered the aggregate result.

Queue leases, provider failure backoff, stale-context validation and idempotent snapshot reconciliation apply to the single batch. A retry sends the same batch again, never falls back to per-entity requests. Unattempted legacy HA backlog is grouped by account and ten-minute receipt window when dispatched; previously attempted or leased work keeps its original audit/retry contract. The explicit event-ID processing API retains its requested scope.

Validation covers transport request counts, concurrent workers, duplicate snapshots, current/previous states, source history links, failures, restart recovery, atomic rollback, oversized batches, legacy batching, connector fairness and corrections arriving during a request. Tests use visibly synthetic transports and do not measure live Jev quality or billing.
