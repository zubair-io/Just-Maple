# Clef integration and frozen question check — October 4, 2026

Clef is available as an explicitly selected local classifier through Ollama. The user's Mac preference was set to `clef` as requested; global rollout defaults and other users' explicit selections remain unchanged. The running application was not terminated or relaunched. The new build uses the saved selection on the next launch.

## Local contract

The app reuses installed `clef:latest` weights to create a named `maple-clef:64k` configuration with `num_ctx=65536`, without downloading weights or replacing the original model. An existing configuration must already support decisions and the required context size; it is not overwritten automatically. Source text is sent only to `http://127.0.0.1:11434/v1/systemone`, with no API key or redirects. Requests allow 180 seconds for larger batches.

The existing filtered contexts, compact HA observations, evidence IDs, output validation, queue transactions and decision policy are reused. Attempts, full inputs and responses are attributed to `ollama-clef`. Message results carry `clef-message-obligations-v1` to distinguish the revised prompt. Jev's original questions and thresholds remain unchanged. Fact and task extraction retain their separately selected provider; local classification does not make those stages local.

Unavailable inference leaves failed work queued. Invalid responses and rejected inputs are blocked for inspection rather than repeatedly resubmitted; their evidence is retained. There is no fixture answer, automatic Jev fallback or silent evidence truncation. Local failures do not create a Jev account pause.

## Question revision and measured quality

Only Clef's task-review question changed. It now asks directly whether the new message supplies a concrete obligation, definite promise by any participant, or supported change to an existing obligation, with explicit true/false criteria. It distinguishes another person's definite promise from a user action, outgoing requests from incoming obligations, optional offers from obligations, and resolved quotations from new requests.

One prompt revision was frozen before inference. The other nine message questions and all routing thresholds were unchanged. No wording or thresholds were adjusted after reviewing holdout outputs.

- Existing 15-case development rubric: **15/15**, improving on the original Clef result of 13/15. Both previously missed waiting-on-other promises now trigger review.
- Fresh authored 20-case holdout: **20/20**. Ten definite promises/requests triggered review; ten quiet, tentative, optional, outgoing-request, resolved-quotation and injection examples avoided review and stayed on the retain route.
- All **35/35** responses passed schema validation. There were 35 local requests, no retries and no Jev requests in this check.

The holdout was authored and labeled before inference, but it is small and synthetic, with several examples close to the development concepts. This supports the prompt hypothesis; it does not establish absence of overfitting or representative production quality. No model weights were trained, no tasks were fabricated, and actual task extraction/daily-note usefulness were not measured.

Observed message latency in the latter portion of this 64K run was about **11–12 seconds**, higher than the earlier 16K benchmark's 7.76-second median. Prompt criteria, context configuration, background builds and workstation conditions differed; this was not an isolated causal performance experiment. The first request also included model loading. The earlier context probe showed the full 128-entity batch accepted at 64K; larger production batches can still fail visibly at endpoint/input limits.

Inspect [the frozen prompts](prompt.json), [the corpus and labels](frozen-corpus.json), and [all probabilities and timings](results.json). The [local evaluation script](evaluate.py) uses the explicitly exported real application request schema and never opens production stores. Its reproduction setup requires the frozen earlier corpus and `.build/clef-question-request.json`, produced by the opt-in `MAPLE_CLEF_REQUEST_EXPORT` fixture test. The script deliberately creates the evaluation's named model configuration; the production loader instead validates and preserves an existing configuration.

## Verification and build

Passed: 464 MapleCore tests, 30 transport tests, 398 Angular tests, 80 native Xcode tests, CLI build using `--package-path src/apple/Packages/MapleCore`, and `npm run build`. The fresh app passed deep strict code-signature verification.

App: `.build/xcode/Build/Products/Debug/Just Maple.app`. App bundle identity, development team and signing settings were preserved. No active editing session was interrupted.
