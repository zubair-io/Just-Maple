# Sources verification

## Query performance

The opt-in `SourcesTests.tenThousandSourceWarmFirstPageP95` benchmark captures a new query snapshot on every sample, not a cached first-page response. It uses a temporary file-backed SQLite database with 10,000 visibly synthetic events, three connector/type combinations, four accounts and roughly 1.6 KB source bodies. Each sample includes materialization, session eviction, corpus facets, counting and decoding the first 60 rows.

On the development Mac (Apple M5 Max, 128 GB RAM; macOS 27.0 build 26A428), the debug build measured **62.263 ms p95** across 20 samples after three warmups; the target is below 200 ms. Range: 41.431–66.660 ms. Raw samples and environment are retained in [sources-performance.json](sources-performance.json).

The first implementation measured approximately 537 ms p95 and failed. The final query materializes compact typed columns directly in temporary SQLite tables, decodes only the requested page in Swift, and caches corpus facets by ingestion watermark/count. Corpus facets remain usable while filters are active. No unbounded source array is sent to Angular or retained in Swift.

Reproduce from the repository root:

```sh
MAPLE_SOURCES_PERF=1 swift test --package-path src/apple/Packages/MapleCore --scratch-path /tmp/maple-sources-build --filter SourcesTests
```

This is warm database-query evidence on this machine, not a WebView frame-time or cold-start guarantee. The test is opt-in so CI contention does not create a misleading mandatory performance threshold.

## Regression coverage

`SourcesTests` verifies independent combined filters, literal FTS input, snapshot membership/state under concurrent changes, cursor fingerprint/expiration/window limits, immutable source revisions, separate Home Assistant observed state, failure-dominant branch summaries, retry command identity/version checks, rollback-coupled history, lease recovery with unknown outcomes, byte-bounded UTF-8 artifact pages, cross-source artifact authorization and audited manual fact checks.

`TypeSafeTests` verifies that captured request context is the actual HTTP JSON body, excludes authorization headers/secrets, retains successful-transport schema-invalid output for inspection, and excludes private HTTP error bodies. Existing classifier failure tests now assert that arbitrary provider diagnostics cannot enter queue errors.

The raw source and model artifacts remain local. Fixture transport/storage tests do not claim live Jev or downstream model quality.
