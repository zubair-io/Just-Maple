# Just Maple on Phoebe

This branch implements an isolated SQLite deployment and server-side hybrid search,
based on main revision `ca1110ba` including its graph, follow-up and bot workflows.
Production remains on its existing service. Do not merge, change DNS, activate a
public application route, or redirect existing clients as part of this rehearsal.

## Running deployment

| Resource       | Configuration                                                             |
| -------------- | ------------------------------------------------------------------------- |
| Proxmox        | `ssh phoebe`, CT **131**, `just-maple`                                    |
| Guest          | Debian 13, unprivileged, nesting enabled for systemd mounts               |
| Limits         | 4 vCPU, 8 GiB RAM, no swap                                                |
| Storage        | `local`: 16 GiB root + 64 GiB managed data mount; `backup=1`              |
| Network        | DHCP `192.168.1.179/23`, vmbr0; no DNS record                             |
| Application    | `/opt/just-maple/current`, non-root `just-maple-api.service`              |
| Data           | `/var/lib/just-maple/staging.sqlite`, WAL/FULL, local disk                |
| Media          | Existing absolute Azure URLs retained; new staging uploads stored locally |
| Native search  | `just-maple-search.service`, private Unix socket, 2 inference threads     |
| Cloudflare     | `just-maple-phoebe-staging`, ID `54b3d343-950f-4257-b057-85af3ff3e128`    |
| Tunnel ingress | Only `http_status:404`; no published application or private network route |
| Secrets        | Root-only `/etc/just-maple/api.env` and `cloudflared-token`; never commit |

Open the application with a localhost origin so WebAuthn has a secure context:

```sh
ssh -N -L 127.0.0.1:7073:192.168.1.179:7071 phoebe
# Open http://localhost:7073
```

The staging RP is `localhost`; CORS and passkey origins allow `http://localhost:7073`.
Enroll a fresh staging passkey. Production passkeys, session/device/bot tokens,
integration secrets and production JWT signing keys were excluded from this copy.
Copied bots, connectors, collector subscriptions, proactive jobs and retention jobs
are disabled. No production AI-provider, push or Azure storage credentials were
installed. Testing a real provider conversation requires a separate staging setup.

The source export is a **live rehearsal**, not an authoritative point-in-time
production migration. All 62 collections (47,447 documents before sanitization)
passed counts and canonical content hashes in the lossless import; BLOB bytes are
included in those hashes. The sanitized copy was independently verified. Original
exports and reports remain in private local rehearsal directories; they are not
repository artifacts. No source database writes or production cutover occurred.

## Persistence and search

`DATABASE_DRIVER=sqlite` selects a dedicated Bun SQLite child process. Existing
repository signatures use a bounded compatibility surface backed by per-collection
SQLite tables, native indexes, canonical EJSON and separate binary BLOB storage.
Mingo evaluates the existing typed query/update/aggregation operators. Mongo types
and the optional `mongodb` provider remain during this transition. Unsupported
operations fail explicitly. Atomic mutations, positional array updates, version
checks and one-use challenges run in SQLite transactions.

The compatibility layer deliberately makes a whole `bulkWrite`/`insertMany` batch
atomic; it does not emulate Mongo's partial unordered failure results. Existing
expiry predicates still reject expired credentials, but Mongo TTL index metadata
does not schedule SQLite deletion. Decide periodic expiry cleanup and audit new
repository operators before production acceptance. Native SQL repositories can
replace this boundary incrementally.

AI `search_local_data` calls on device-data pages use:

1. Current notebook membership and page filters, derived by the server.
2. SQLite FTS5 BM25 with English Porter stemming and safely parsed phrases/exclusions.
3. Server-generated bge-m3 query vectors and exact, scoped vector search.
4. Reciprocal rank fusion (`k=60`), deduplicated by source item across chunks.
5. Fresh permission, source revision and content-hash checks before hydration.

`get_local_item` accepts an opaque owner/source/item reference and rechecks access.
Required phrases and exclusions constrain both ranking legs. If the worker is
loading, restarting, overloaded, times out after two seconds, or vectors are
pending, lexical results include the fallback reason. Embedding coverage is reported.
The application continues serving while systemd restarts the search process.

Backfill is durable, revision/hash guarded, leased and retryable. Foreground work
has priority between embedding chunks. It remains in progress on the imported
corpus; partial hybrid coverage is enabled only for this isolated staging copy.
Production activation requires complete initial coverage and a relevance review.
Device collection and action relays remain; Apple embedding retirement is later work.

Runtime pins: Bun **1.4.3**, Rust **1.98.1**, ONNX Runtime **1.23.2**, fastembed
**5.8.0** with the retained thread patch. Model revision:
`BAAI/bge-m3@5617a9f61b028005a4858fdac845db406aefb181`.
Generation: `bge-m3-5617a9f-cls-l2-512-v1`, 1024 f32 dimensions, CLS/L2, 512 tokens.
Body chunks use 384 tokens with 64 overlap and a reserved 96-token header budget.
See `apps/search-worker/NOTICE.md` for source provenance and licenses.

The Linux ONNX archive SHA-256 is
`1fa4dcaef22f6f7d5cd81b28c2800414350c10116f5fdd46a2160082551c5f9b`;
the installed library SHA-256 is
`13ab8084954fa4a47c777880180b90810d6020f021441395712b48a75b74c68b`.
The model warm-up peaked at 3.8 GiB. The worker has a 5 GiB limit, the API/database
service 2 GiB, and the vector cache a 1 GiB budget. These are single-instance limits.

## Build and deploy

Use the repository's Node version (24.15.0), Bun 1.4.3 and pinned Rust toolchain.

```sh
bun install --frozen-lockfile
bun run build:api
bun run build:web:paperbark
cargo build --release --locked --manifest-path apps/search-worker/Cargo.toml
```

For Linux amd64, build the Rust executable on Linux; the macOS executable cannot
run in the LXC. The current build tree is `/opt/just-maple-build/search-worker`.
Install a versioned binary under `/opt/just-maple/bin/` and atomically replace the
`just-maple-search` symlink. Install the official ONNX Runtime 1.23.2 Linux x64
archive under `/opt/onnxruntime` after checking the hash above. The service fixes
`ORT_DYLIB_PATH`; `warm-model.sh` can download/warm the pinned model before startup.

Stage `apps/api/dist` as `dist/` and this directory as `infra/` inside an LXC-local
deployment directory. Run `install-in-lxc.sh NEW_RELEASE_ID` with
`JUST_MAPLE_DEPLOY_SOURCE` pointing there. Existing release IDs are rejected. It
preserves the database and existing environment, sets restrictive permissions,
switches the release symlink and restarts the API. Native binaries/model/runtime
must be installed first. Only initial setup generates a fresh JWT secret.

Before a schema upgrade, run the host backup service and verify its result. Keep
the previous release. For an additive-schema-compatible rollback, stop the API,
point `current` at that release and restart it. Stop only the new staging services
when investigating trouble. Never reset a database or replace it with an older copy
after accepting writes without an explicit reconciliation decision.

`migrate.js` provides `inventory`, `export NEW_DIRECTORY [--source-quiesced]` and
`import EXPORT_DIRECTORY NEW_DATABASE [--staging]`. Export needs a read-only
`MONGODB_URI`. Import refuses existing targets and verifies manifests and content;
use a fresh destination on retry. A source write freeze is required for a production
snapshot; the flag records that operator action, it does not freeze Mongo itself.

## Backups and operations

Phoebe's `just-maple-staging-backup.timer` runs hourly at :15 with jitter. Its script
uses a separate `VACUUM INTO` connection, verifies integrity, copies the snapshot
to `/mnt/pve/nas-vms/dump/just-maple-staging/`, verifies SHA-256, then removes only
its transient guest copy. It refuses to run if the NAS is unmounted or CT131 is
stopped. It caps the archive at **168 snapshots** and fails for retention review
instead of deleting prior snapshots. Set the long-term retention policy before
production. The existing all-guest daily Proxmox backup job was not changed.

```sh
ssh phoebe 'systemctl start just-maple-staging-backup.service'
ssh phoebe 'systemctl status just-maple-staging-backup.service --no-pager'
ssh phoebe 'pct exec 131 -- systemctl status just-maple-api just-maple-search just-maple-cloudflared --no-pager'
ssh phoebe 'pct exec 131 -- curl -fsS http://127.0.0.1:7071/api/health'
ssh phoebe 'pct exec 131 -- sqlite3 /var/lib/just-maple/staging.sqlite "select count(*) from embedding_jobs; select count(distinct id) from search_embeddings;"'
```

Restore by checking the NAS checksum, copying a snapshot to a new local filename,
checking SQLite integrity/foreign keys, and starting an isolated API with a different
port, `HOST=127.0.0.1`, `SERVER_SEARCH_ENABLED=false` and outbound jobs disabled.
This drill passed on the new LXC using `restore-check.sqlite` and port 7074; the
temporary API was stopped afterwards. A fresh-guest restore remains a production
acceptance gate. Daily guest backups cover local uploads/config; the hourly job
covers the database only.

Operator verification bundles require `JUST_MAPLE_STAGING_SMOKE=true`:
`smoke.js http` verifies authenticated API operations and the production auth gate;
`smoke.js search` checks native paraphrase search, owner isolation, references and
revocation. It creates/removes only its own synthetic fixtures. Stop the staging API
with an EXIT trap to restart it for native search/`benchmark.js`: one API connection
owns the Unix worker. `benchmark.js` reports corpus counts/timings without source
text or account identifiers. Never point these tools at production.

## Verification and remaining acceptance gates

The API suite exercises the real Bun SQLite worker without Mongo skip fallbacks.
A dedicated CI job runs API integration, build and native search tests independently
of the existing frontend type/format checks. Shared tests, production frontend build,
Chromium E2E, binary/hash migration checks, live authenticated API, native search,
worker-crash recovery, and backup restore were exercised.

Verification on October 29, 2026: **936 API tests passed** (3 existing skips),
**139 shared tests passed**, **12 native Rust tests passed**, and **17 Chromium
E2E tests passed** (136 existing skips). CT131 rebooted successfully with all three
services active and no failed systemd units. The active API release is
`sqlite-hybrid-20261029-06`; the native binary is `just-maple-search-20261029-03`.
Four queries over 12,505 eligible imported items measured 920 ms initially and
579–672 ms warm with partial embedding coverage. These are diagnostic samples,
not a p95 result; the provisional 500 ms target needs further load testing. The
synthetic paraphrase/isolation/revocation smoke measured 107 ms.

The existing frontend suite reports 248 failures/45 errors; the clean base revision
produced the same counts. API typecheck also has existing diagnostics (including
shared sources outside its rootDir); it is not green. Do not confuse successful
bundling/API tests with a clean whole-repository typecheck.

Before production: choose/authorize the hostname and DNS, configure its RP/origins,
test Apple and collector selection/replay, re-enroll/link staging identities as
appropriate, test two-client Yjs/realtime/media/scheduled-send workflows, complete
embedding coverage and relevance/load tests, define TTL/backup retention, rehearse
a quiesced export and fresh-guest restore, then agree the cutover window. No old
service, data, device embedding path or DNS record has been retired here.
