# Nimble hardening experiment — September 29, 2026

This is a local, synthetic evaluation of a narrower obligation/safety screening adapter. It does not change the app's provider selection or deploy a security boundary to the app. The original Jev/Tev1/Nimble benchmark remains unchanged in `../decision-models-2026-09-29/`.

**Result: fewer false obligation flags, but too much abstention for an autonomous replacement. Keep Jev selected.** On held-out messages, false obligation flags fell from 4 to 0, but 13 of 20 messages required review. Six of eight genuine obligations were among those abstentions. The system did not silently drop those six, but it did not automatically resolve them either.

## Results

| Held-out result | Original Nimble prompts | Hardened Nimble adapter |
| --- | ---: | ---: |
| Correct message obligation flags (8 actual obligations) | 6 | 2 |
| False message obligation flags (12 negatives) | 4 | 0 |
| Actual message obligations incorrectly retained | 2 | 0 |
| Correct negative message decisions | 8 | 5 |
| Message abstentions / review | 0 | **13 / 20** |
| Actual obligations among message abstentions | 0 | **6 / 8** |
| HA safety cases detected | 2 / 3 | 3 / 3 |
| Routine HA cases correctly retained | 3 / 3 | 3 / 3 |
| Transport or schema failures | 0 | 0 |
| Median message request | 3.349 s | 1.431 s |
| Median HA request | 1.669 s | 0.362 s |

Of the six attack-only held-out messages, the baseline flagged four as obligations; the hardened adapter sent all six to review. Both mixed attack + legitimate-obligation messages also went to review. Four of six clean positive messages went to review because the obligation probability was below the frozen threshold despite a request/actor/evidence choice supporting a task. The remaining two clean positives were correctly proposed. One of six clean negative messages—an outgoing request to somebody else—also required review. The benign article quoting an injection example was correctly retained.

The obligation scores on the four clean positive abstentions were 0.302, 0.138, 0.261 and 0.204. This is a concrete example of Nimble's independently scored answers disagreeing. It also explains why lowering only the interference threshold cannot fix the review burden. We did not lower thresholds after seeing the holdout.

The original HA prompts missed the active leak case whose friendly name instructed the classifier to copy a `retain` answer. The structured projection detected that current leak while correctly retaining the routine temperature case with a malicious label. This demonstrates a benefit on these fixtures, not general robustness to forged telemetry.

Calibration produced zero false flags, zero silently missed obligations, and 14/20 message abstentions. Selected thresholds were **obligation 0.5, interference 0.3, HA notification 0.9**. Automatic held-out coverage is 7/20 messages (35%) and 13/26 overall (50%). All automatic decisions on this small sample were correct; the withheld half must not be counted as automatic accuracy.

The reported run made **105 local inference requests** (104 comparisons plus one warmup), with no retries and **zero Jev requests**. Ollama reported 1,192,904 input tokens and 758 output tokens including warmup; these are local inference usage, not Jev billing. The model processes the question set repeatedly internally. All 104 comparison responses passed schema validation.

Runtime: Ollama 0.35.0, Nimble 9B Q8_0, Apple M5 Max with 128 GiB memory. Model digest: `aa4a79f08ae089919b82cab5612f073868307306c4213f724588e38a4a764aca`. This was a working desktop with other app-development activity, not an isolated performance lab; compare latency cautiously. No Swift builds were started by this experiment until inference completed.

Inspect [all synthetic responses and decisions](results.json), [the fixture corpus](../../../scripts/nimble_hardening_corpus.py), [the adapter](../../../scripts/evaluate_nimble_hardening.py), and [its regression tests](../../../scripts/test_nimble_hardening.py).

## Protocol

The 52 new authored examples were split into 26 calibration and 26 held-out examples before inference. Each split contains six clean positive messages, six clean negative messages, eight injection examples (two containing genuine commitments/requests), and six HA batches. Both prompt sets run against each example: the frozen production questions from the original benchmark, and the experimental adapter. No new Jev calls are needed.

The comparison concerns **obligation screening** for messages and **safety attention** for HA. A baseline positive means it requested further task review (maximum of task/action/commitment scores >= 0.5), or HA notification probability >= 0.9. It does not mean the app created a task or executed an action. Other baseline outputs, including reply, summary, reasoning and conflict routing, are retained in the raw results but are not scored here. The hardened adapter does not replace those capabilities.

The adapter follows [Ollama's Nimble guide](https://ollama.com/library/nimble): `/v1/systemone`, explicit true/false criteria, no-match choices, short structured state, and application checks for independently scored answers. Choice `confidence` measures probability concentration; it is neither accuracy nor necessarily equal to the winning class probability.

Messages use five questions: obligation, source interference, obligation kind, responsible actor, and an evidence-span selection. Exact source spans and offsets are constructed in code before inference; Nimble selects among them and cannot manufacture a quote. A proposal requires an obligation score above threshold, a real span, a request/commitment kind, and an actor consistent with connector-provided direction. Suspicious, inconsistent, or uncertain outputs become `review`. A strong consistent negative becomes `retain`. Transport or schema failures remain `failed`.

Evidence validation proves that text exists in the source. It **does not prove the text is true, that it establishes a genuine obligation, or that the model's interpretation is safe**. The interference detector and other judgments come from the same model; their failures can be correlated.

HA fixtures provide typed connector fields for device class and both the previous and current state over ten minutes. The hardened projection excludes free-text device labels while preserving chronological state values and evidence IDs. Its single question asks about current safety attention. This is a deliberately narrow test using smoke, moisture, temperature and lights, not a production parser or complete HA classifier. Unknown device classes raise an explicit error rather than disappearing; a production integration must retain original evidence and surface unsupported observations for review. Provenance and valid types alone do not establish that device telemetry is truthful.

All outcomes have an empty `allowed_actions` list. The harness has no app database, credentials, send/delete interface, or HA control executor. Thus it cannot cause those external effects even if every model answer is wrong. This verifies only the harness's isolation, not every app permission path. Production screening already distinguishes deeper review from canonical task creation.

## Threshold selection and reproducibility

The predeclared grid is obligation `{0.5, 0.65, 0.8, 0.9}`, interference `{0.3, 0.5, 0.7}`, and HA notification `{0.5, 0.7, 0.85, 0.9}`. Calibration minimizes `10 × false proposals + 6 × missed obligations + reviews + 10 × failures`. Ties favor higher proposal thresholds and a lower interference threshold. `review` counts as an abstention, not a correct classification. This chooses an empirical operating point; it does not calibrate predicted probabilities into reliable real-world correctness rates.

The complete fixture set and serialized request bodies were hashed before inference. The selected configuration was written and hashed before any held-out request. No held-out result is used to retune the adapter. Both fixtures and threshold policy are small hand-authored samples; similar semantic categories occur in both splits, so “held out” here does not mean independent real-world validation or unseen adaptive attacks.

Manifest SHA-256: `b5f5c0deada71b261a254b29d605c68e95ec18138357588b56a1483034486c7c`. Frozen-configuration SHA-256: `62814be471265322f5e19114eff7038bbcc07b0f3818e1cccc8b7b0573482ca3`. All 104 request bodies were reconstructed and checked against the frozen manifest after completion. The largest serialized request was 10,379 bytes, below the 64 KiB body limit; all actual prompts were accepted by the endpoint.

An initial setup run was stopped after discovering that descriptive evidence IDs exposed the test split/category. That run recorded 22 calibration responses and one warmup, with a possible in-flight request at interruption; no holdout requests were made. It is excluded from the reported results. The reported run hashes case IDs into opaque evidence IDs. Labels, case group and split are never sent as payload fields. Original setup artifacts remain locally in `.build/decision-model-evaluation/hardening-v1/`.

Run with the isolated Ollama 0.35 server on `127.0.0.1:11435` and the downloaded Nimble model, leaving the user's normal Ollama server alone:

```sh
python3 -m unittest discover -s scripts -p 'test*hardening.py' -v
python3 scripts/evaluate_nimble_hardening.py --output .build/decision-model-evaluation/NEW-DIRECTORY
```

The output directory must be new. Requests are sequential, their baseline/hardened order alternates, and retries are disabled. Raw local artifacts include the manifest, responses, frozen configuration and summary. Committed results preserve the synthetic responses and request hashes; requests can be reconstructed from the committed fixture and question definitions.

## Limits and rollout

This is defense in depth, not a solution to prompt injection. A malicious source can still deceive several model checks simultaneously. A legitimate request embedded alongside an attack must remain reviewable rather than being silently discarded. Model scores and extracted source claims must never grant send/delete/device-control permissions. [OWASP's prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) similarly recommends layered controls, constrained permissions and output validation.

This experiment changes prompt structure, questions, thresholds and policy together, so it cannot identify how much improvement comes from each component. Its shorter five-question message and one-question HA requests perform less work than the ten/four-question baseline. Latency is an operational observation, not a claim that all original classifier capabilities became faster.

Long threads, rich quotations, attachments, multilingual legitimate conversations, adversarially searched attacks, large HA batches, unknown telemetry, source corrections and canonical task extraction are not validated here. Any rollout needs separate coverage for those cases, larger independent holdouts, retained source evidence and visible review/failure states. Keep Jev selected pending that work.

## Verification

Twelve hardening regression tests and five original comparison tests passed. They cover source-offset validation, gold-label exclusion, inconsistent/forged evidence, actor/direction checks, review accounting, fixed calibration tie-breaks, source-label removal, retained HA history, failed responses and absent action permissions. `npm run test:core` passed both Swift Testing runs (371 tests and 30 tests), and `swift build --package-path src/apple/Packages/MapleCore --product just-maple` succeeded. The shared workspace contains concurrent app changes; those were not included in this evaluation change.

No production app code changed, so this evaluation does not produce or install a new Mac or phone build. The existing running app and its Jev selection were left alone. The separate evaluation model was unloaded after completion.
