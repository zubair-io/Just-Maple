# Native Laya evaluation — September 28, 2026

**Decision: native integration works; this checkpoint is not approved to replace Jev for live Maple routing.** Installation or successful model execution does not enable classification. The bundled `validation.json` remains `approved: false`. Existing Jev configuration is retained; an explicit Laya selection never silently falls back to a remote provider.

## What is implemented

A native Swift tokenizer, fixed-shape Core ML runtime, and `FactCheckingClassifier` adapter run inside the existing app. No Python process, server, daemon, or remote inference is involved. Python is used only to fetch and verify build assets. The Mac bundle includes the compiled model, tokenizer, calibration, license, and validation status. Phone packaging does not include these weights.

Pinned artifact: [FluidInference/laya-english-coreml](https://huggingface.co/FluidInference/laya-english-coreml/tree/78c0b0e5054eb5804c72080016227d4f3b0bd08d), revision `78c0b0e5054eb5804c72080016227d4f3b0bd08d`; upstream English checkpoint `1c5edc17a7acd8701df6fc341c0d179f1c62c982`. The L512 FP16 package occupies approximately 805 MiB. Every downloaded build asset is SHA-256 checked against `scripts/laya-assets.json`. The model's Apache-2.0 license is included in the app.

The runtime uses `.all` compute units, the pinned type/option-count temperatures, and only active option logits. It rejects unsupported inputs, overflow, missing assets, and invalid distributions. It never truncates the input to force a classification. All questions are preflighted before classification starts; partial inference cannot commit a complete decision. Audits retain actual per-question inputs, logits, temperatures, calibrated probabilities, and timing under `laya-coreml` provenance. The compact projection retains supplied source text, claims, and history; world summaries are explicitly omitted in the audit. Engine revision-validation snapshots remain intact.

Limits: 512 total tokens per question, including instructions and options; 192-token head budget; at most 32 options. Long evidence remains pending rather than becoming a confident decision on an incomplete prefix. This is the English checkpoint; multilingual input and long-context strategies require separate validation.

## Runtime verification

- Native tokenizer IDs and marker positions match Rust-tokenizer fixtures, including Unicode and added tokens.
- All 16 published L512 verification cases match reference token counts, temperatures, and selected options.
- Core ML loading and inference run on the local Apple M5 Max.
- Measured median per-question preparation/inference time was about 17.6 ms in the synthetic screening run, excluding model load. Maple asks ten questions per message; this is not a 17.6 ms end-to-end event latency.
- This verifies the implementation and exported checkpoint, not suitability for Maple's decisions.

## Real local-model quality results

No user messages or credentials were used. These are existing labeled synthetic Maple scenarios using actual Core ML inference. Existing routing thresholds were unchanged. They are smoke tests, not a representative held-out quality benchmark or a new live Jev comparison.

The upstream [English checkpoint limitations](https://huggingface.co/convaiinnovations/laya/blob/main/README.md#honest-limits) warn about boolean label bias. The adapter uses neutral A/B choices with explicit semantic descriptions. Generic descriptions passed 8/15 screening cases; clearer descriptions passed 9/15. Neither passed the gate.

| Screening case | Expected deeper review | Actual | Result |
| --- | --- | --- | --- |
| Requested estimate awaiting decision | Yes | Yes | Pass |
| Failed backup | Yes | Yes | Pass |
| Existing license renewal | Yes | No | Fail |
| Scheduling request | Yes | Yes | Pass |
| Other person's definite promise | Yes | No | Fail |
| Delegated contract commitment | Yes | Yes | Pass |
| Required access form | Yes | Yes | Pass |
| Tentative social suggestion | No | Yes | Fail |
| Completed request | No | No | Pass |
| Optional product review | No | No | Pass |
| Optional survey | No | Yes | Fail |
| Promotional sale | No | Yes | Fail |
| Scheduled autopay notice | No | No | Pass |
| Successful backup | No | No | Pass |
| Acknowledgment | No | Yes | Fail |

Additional scenarios failed:

- The incoming dinner-confirmation request did not produce a reply prompt, so the subsequent feedback/closure case could not execute.
- A changed dinner time did not produce useful summary work.
- The accepted-offer conflict did not prompt a user choice, though the offer was learned and its evidence retrieved correctly.
- Storage remained idempotent; no fake classifications replaced failures.

## Reproduction

```sh
python3 scripts/prepare-laya.py
bash scripts/evaluate-laya.sh
npm run test:core
npm test
npm run test:apple
npm run build
```

The evaluation script returns failure when any quality suite fails. It does not modify approval. Local detailed reports are under `.build/laya-evaluations/`; source/provider payloads remain inspectable in the synthetic databases.

Before promoting Laya: evaluate a better-suited checkpoint or fine-tune on separately labeled Maple decisions, calibrate on held-out data, validate direction/quoted-history/corrections and supported languages, then rerun the unchanged routing scenarios. Also settle long-context handling without silently losing evidence. Only a reviewed release with matching model and adapter approval should change the default provider.

## Engineering checks

312 core tests plus 30 transport tests passed. The seven native runtime tests also passed with real bundled assets enabled, including the 16 published fixture cases. Angular: 185 tests; Mac: 65 tests, followed by 23 affected native checks after the final default-provider and model/adapter gate adjustment. The iPhone simulator suite passed. CLI and fresh Mac builds passed; strict app signature verification passed. Model quality suites intentionally remain failed as reported above. The running app was not relaunched or switched to Laya.
