# Startup and background-query performance

A real-corpus startup check exposed a query-planner regression after adding Sources indexes. The latest-revision `OR` anti-join selected broad account indexes, and the historical vector lookup selected the connector/date index instead of an entity lookup. A correlated scan repeated across many source revisions could monopolize the store actor for minutes.

The correction adds an entity/received-time index and selects one latest entity revision with a deterministic row-ID tie break. The correlated lookup explicitly uses that index, including historical as-of queries. The connector-record active check already uses its `(connector,id)` primary key. Reconciliation now embeds its bounded query batch together, fetches eligible message vectors once, decodes each vector once, and scores them with Accelerate. Per-task date bounds and mail/message filters apply before ranking. Local semantic retrieval still uses actual on-device embeddings and never substitutes fixture or lexical answers. The self-state startup query filters subjects in SQLite, preserving correction priority.

Verification used a consistent temporary SQLite backup of the user's corpus (approximately 40,000 observations and 41,000 vector chunks). The live database was opened read-only for diagnostics/backup; the temporary copy was removed after testing. Only aggregate measurements are retained here—no source text, identities, model output or paths from the corpus.

Debug-build timings on the development Mac:

| Operation | Result | Time |
| --- | --- | --- |
| People projection | 12 summaries | 360 ms |
| `state(subjects: ["person:self"])` | 1 current claim | 0.137 ms |
| Generic semantic search | 6 matches | 366 ms |
| Reconciliation input | 20 nodes, 32 evidence sources | 293 ms |

These are measured runs, not universal latency guarantees. The four `QueryPerformanceTests` cases passed, including the opt-in copied-corpus test. The full Swift run passed 288 core tests and 30 transport tests at this verification point. Regression coverage checks entity-index selection, equal timestamp revisions, independent accounts, historical semantic eligibility, batch equivalence and filtered-state correction semantics.

To repeat the opt-in test, first create a private SQLite backup in a system temporary directory named `maple-query-copy-*`; never point this test at the live database. Then set `MAPLE_QUERY_COPY_DB` to that copied database and run:

```sh
swift test --package-path src/apple/Packages/MapleCore --filter QueryPerformanceTests
```

The test refuses paths outside that temporary-copy convention. Remove the private copy after the test. Default test runs execute only synthetic regression fixtures.
