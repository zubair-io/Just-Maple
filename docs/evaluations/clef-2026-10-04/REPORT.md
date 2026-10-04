# Jev vs Clef Flash and Clef — October 4, 2026

**Keep Jev as Maple’s default.** Both local Clef models missed the same two waiting-on-other commitments in the established screening rubric. Clef passed all eight small Home Assistant routing cases, making it a candidate for further local HA evaluation, but its measured latency was substantially higher. App settings, production data, queues and user notes were untouched.

## Measured results

| Check | Jev 1.13.0, remote API | Clef Flash 9B, local Q8_0 | Clef 27B, local Q4_K_M |
|---|---:|---:|---:|
| Established message screening | **15/15** | 13/15 | 13/15 |
| Exploratory direction/source-boundary cases | 5/6 | 5/6 | 5/6 |
| Small HA exact expected route | 6/8 | 6/8 | **8/8** |
| 32-entity HA batch, default configuration | Pass | Pass | Pass |
| 128-entity HA batch, default configuration | Pass | HTTP 400 | HTTP 400 |
| Valid main responses | 31/31 | 30/31 | 30/31 |
| Median message latency | **0.223 s** | 1.611 s | 7.763 s |
| Median small HA latency | **0.212 s** | 0.820 s | 4.269 s |
| Six repeated threshold decisions unchanged | 6/6 | 6/6 | 6/6 |

Latency is end-to-end per event/batch over main successful responses, excluding warm-up, repeats and stress cases. Message timing combines the 15 screening and six exploratory cases. These are workstation measurements on an Apple M5 Max with 128 GiB unified memory, using Ollama 0.35.1. Core verification briefly overlapped later Flash cases; background activity was not controlled. This is not a laboratory throughput or energy benchmark.

## What failed

Both Clef variants missed “I will bring the replacement cable tomorrow morning” and the definite promise to send a supplier contract. They recognized commitment intent but their task-review and commitment-change probabilities remained below Maple’s existing thresholds. Jev requested review for both. Screening controls deeper examination; these tests do not measure canonical task extraction or final daily-note quality.

All three missed the exploratory signed-form case’s expected reply threshold of 0.85. Their user-action probabilities nevertheless triggered task review. A form-delivery request can reasonably be interpreted as an action rather than an owed conversational reply; that label remains explicitly exploratory and was not changed after inference.

Jev and Flash retained the active smoke and water-leak cases because their notification probabilities were below 0.90. Clef crossed the threshold for both. Neither quiet cases nor thresholds were tuned to improve these scores. All three resisted the newsletter and HA label source-instruction examples. Two examples do not establish general injection robustness.

## The large-batch rejection is configurable

Both installed Clef model manifests set `num_ctx=16384`, despite their model pages describing a 64K decision window. The unchanged 128-entity synthetic batch was rejected with HTTP 400 under that default. No failed inference was repaired, truncated or replaced.

A separate experiment created temporary aliases inheriting the original weights and renderer, with only `num_ctx=65536` changed. Both accepted the **same full 128-entity request** and produced the expected retain route: Flash in **17.36 s**, Clef in **56.96 s**, after separate small-batch warm-ups. This is two successful context probes, not a rerun of the full quality suite at 64K.

Ollama reported model allocations of approximately **14.15 GB / 23.43 GB** for Flash/Clef at 16K, versus **33.48 GB / 49.20 GB** at 64K. These are reported model allocations, not measured whole-machine peak RAM. Temporary aliases were unloaded and deleted; the original installed models were preserved.

## Scope and reproduction

This run reused the frozen September 29 corpus: 31 synthetic inputs comprising 15 established screening examples, six exploratory direction/source-boundary examples, eight small HA batches and two context stress batches. Each provider received the identical state, questions, criteria and scoring thresholds; only model ID and local keep-alive differed. No live personal messages were accessed. The application has ongoing changes, so this frozen comparison is not a validation of every current app context shape.

Each provider made 38 decision requests: one warm-up, 31 main cases and six repeats, without retries. The two context experiments added four local requests. **Total: 118 decision requests, including 38 remote Jev requests.** The saved Jev credential was read into memory and never printed or persisted. Jev reported 103,300 input tokens and 6,834 output tokens; each local baseline reported 87,847 input tokens and zero generated output tokens. These usage fields are not equivalent billing measures.

Full synthetic requests, responses, probabilities, model digests, timings, schema validation and scores are in [results.json](results.json). The context experiment is reproducible using [context-probe.py](context-probe.py) with an output directory and repository root as its two arguments. It requires the frozen corpus still present at `.build/decision-model-evaluation/corpus-v1`.

```sh
python3 scripts/compare-decision-models.py \
  --corpus .build/decision-model-evaluation/corpus-v1 \
  --output .build/decision-model-evaluation/NEW-CLEF-RUN \
  --providers jev clef-flash clef --ollama-url http://127.0.0.1:11434

python3 docs/evaluations/clef-2026-10-04/context-probe.py \
  .build/decision-model-evaluation/NEW-CLEF-RUN "$PWD"
```

The harness now supports both Clef models and an explicit Ollama origin while retaining previous defaults. Validation passed: six harness regression tests, 459 MapleCore tests, 30 transport tests, and the CLI build with `--package-path src/apple/Packages/MapleCore`. No application code changed, so no new Mac app build or relaunch was performed.

Before rollout, independently label a larger representative holdout, including long conversations, prior context and corrections, multilingual messages and broader adversarial cases, then calibrate each provider separately. This small frozen corpus establishes neither general model superiority nor production safety-system reliability.

Official API references: [Clef Flash](https://ollama.com/library/clef-flash), [Clef](https://ollama.com/library/clef), [System One request limits](https://docs.ollama.com/api/systemone), and [model creation parameters](https://docs.ollama.com/api/create). Vendor benchmark numbers were not used as measured Maple results.
