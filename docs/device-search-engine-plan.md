# Device data search: what's left to port from Maple's engine

## Summary

Most of Maple's in-process search engine (`_Maple`, `src/raw-pipeline/maple-search`) is
already in Just Maple. It shipped on Phoebe on October 29–30, 2026. A bot's
`search_local_data` call now runs like this:

1. **Who may see what.** The API lists the items the notebook's data pages share, in
   500-row batches, and applies each page's sharing filter
   (`server-hybrid-search.service.ts`).
2. **Keyword leg.** SQLite full-text search with English stemming (`porter unicode61`)
   and BM25, where title counts 3×, metadata 2× and body 1×. It returns the top 100 of
   the allowed items. Quoted phrases are required and `-word` excludes, using a port of
   Maple's query parser (`hybrid-query.ts`).
3. **Meaning leg.** The Rust worker (`apps/search-worker`, its own systemd service)
   holds the bundled bge-m3 model. It turns the query into a vector, compares it with
   every cached vector of the allowed items and returns the top 100 that score 0.35 or
   more.
4. **Fusion.** The two lists are merged by reciprocal rank fusion (k = 60), as in Maple.
5. **Fallback.** If the worker isn't ready, is busy, takes over 2 s, or the items aren't
   embedded yet, the answer is keywords only. The tool result tells the bot which mode
   answered and why (`search.mode`, `search.fallbackReason`).
6. **Recheck.** Permissions and item versions are checked again before results are
   returned.

New items are embedded in the background by the same worker (`server-embedding.service.ts`):
one item at a time, split into chunks, with retries and backoff.

This is closer to correct than Maple's own engine in one way: sharing filters run
**before** ranking, so a person with few allowed items never gets an empty page because
the top 100 were all someone else's.

What's left is mostly about keeping the meaning leg fast and in budget as archives grow.
The work below is in priority order.

## 1. Update the vector cache in place (most important)

**Problem.** Each embedded item bumps one global counter (`search_state.epoch`). The next
search more than 3 s after that sees a new counter and reloads **all** vectors for every
person in scope from SQLite into the worker. Two consequences:

- During a backfill, or while Mail is uploading, nearly every search starts with a full
  reload. A person with a large archive can use up the 2 s budget on the reload alone, so
  the search quietly falls back to keywords.
- The counter is global, so one person's upload makes everyone's next search reload.

**What Maple does.** Every 5 s its search child reads only rows embedded after a
watermark and upserts them. Once a minute at most, it compares id lists to drop deleted
items. A full load happens only at startup or when the model changes.

**Plan.**

1. Track freshness per person: an `embedded_at` stamp on `search_embeddings`, and a
   per-owner high-water mark in the API's cache (`cachedOwners`).
2. Add `upsert` and `remove` ops to the worker next to `begin`/`load`/`finish`, working
   on one owner's cache.
3. Before a search, apply only the rows newer than the owner's watermark, which is
   usually a handful. Run a full reload only when the cache is cold, the worker
   restarted, or the model generation changed.
4. Find deletes the way Maple does: when the counts differ, compare id lists, at most
   once a minute per owner.
5. Remove the global epoch, or keep it only as a "worker restarted" signal.

**Done when** a search during a busy upload stays in hybrid mode. Test: embed items
continuously while searching, and assert no full reload and no `semantic_timeout`.

## 2. Plan capacity for full history

Messages history is now kept in full, and contacts' mail is archived without expiry, so
archives no longer stop at 30 days. Current limits:

| Limit                                  | Value                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Vector cache budget (API's accounting) | 1 GiB, about 4 KB per 1024-dimension chunk, so about 260k chunks across everyone cached |
| Search worker service                  | `MemoryMax=5G`, including the ~2.3 GB model                                             |
| Phoebe container                       | 8 GiB, no swap, shared with the API and SQLite                                          |

Past the budget, a search returns `vector_capacity` and falls back to keywords.

**Plan.**

1. **Measure first:** chunks per person and growth per week, from `search_embeddings`.
2. If one person can pass the budget within a year, store vectors as 8-bit integers (a
   quarter of the memory). Rescore the top ~300 with full-precision vectors read from
   SQLite, so the ranking barely changes.
3. Keep exact scanning; Maple measured 35 ms for 335k vectors. An approximate index is
   only worth it past a few million chunks.

## 3. Retire the Mac's query embeddings and the old search path

The Mac and iPhone still turn every item into Apple-model vectors
(`CollectorMapping.swift` → `DeviceEmbedding`) and upload them. On Phoebe the server
search doesn't use them: it uses its own bge-m3 vectors. The old path (`searchDeviceData`
plus `embedQuery`, which asks the Mac for the query vector) runs only when SQLite or
`SERVER_SEARCH_ENABLED` is off.

**Plan:** confirm no deployment still needs the old path (Azure is retired). Then:

- stop embedding and uploading vectors on the devices (saves battery, upload size and
  storage);
- delete the old path, `device-search.service.ts`'s scoring and the `embed` relay
  request;
- keep `hit()` and the snippet helpers, which the server path uses.

## 4. Add a counting tool

The search returns at most 25 results, so "does Jenn mention me a lot?" can't be answered
with a number. Add `count_local_data`: the same scope and query parsing, but it returns
counts from the keyword index over the allowed items (total, and per month or per
person). Meaning search can't count, so this tool is keyword-only by design, and its
description should say so.

## 5. Smaller improvements

- **Snippets:** show up to two windows around different matching terms, not only the
  first.
- **Tell the person when it fell back:** check that the system prompt tells the bot to
  mention when an answer came from keywords only (`search.mode` is already in the tool
  result).
- **Relevance checks:** add a replay script like Maple's `scripts/search-audit.ts`. It
  would run a fixed list of queries over a fixture archive and print the mode, latency
  and how many results each leg found. Use it before changing the 0.35 floor or the
  field weights.

## Not worth porting

- **Tantivy:** SQLite's full-text index already gives stemming, BM25 and per-field
  weights. A second keyword index would be one more thing to keep in sync.
- **Maple's "widen the window" ladder and one-per-shot grouping:** filters already run
  before ranking here, and shot grouping is specific to photos.

## Order and size

| Step                                | Size                                         | Depends on                      |
| ----------------------------------- | -------------------------------------------- | ------------------------------- |
| 1. Update the vector cache in place | Medium: API, worker ops, SQLite stamp, tests | —                               |
| 2. Capacity                         | Small to measure; medium if quantizing       | 1                               |
| 3. Retire device embeddings         | Medium: Apple app, API cleanup               | Confirm no old-path deployments |
| 4. Counting tool                    | Small                                        | —                               |
| 5. Smaller improvements             | Small each                                   | —                               |

Steps 1 and 4 can run in parallel; they touch different files.
