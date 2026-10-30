# Just Maple on Phoebe

Phoebe is now the authoritative Just Maple server, using SQLite and server-side
hybrid search. The previous Azure API is stopped with ingress disabled. The
migration and hostnames were explicitly authorized; **do not merge to main**.

## Running deployment

| Resource              | Configuration                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Public app/API        | https://phoebe.justmaple.app                                                                    |
| Preferred LAN app/API | https://local.phoebe.justmaple.app                                                              |
| Proxmox               | `ssh phoebe`, unprivileged Debian 13 CT **131**, `just-maple`, onboot enabled                   |
| Limits                | 4 vCPU, 8 GiB RAM, no swap; nesting required for systemd mounts                                 |
| Storage               | `local`: 16 GiB root + 64 GiB managed `/var/lib/just-maple`, backup enabled                     |
| LAN                   | DHCP `192.168.1.179/23`, gateway `192.168.1.1`; reserve this lease for permanent use            |
| API                   | Non-root `just-maple-api`, bound to `127.0.0.1:7071`                                            |
| Application release   | `/opt/just-maple/current` → `bot-identity-20261030-02`                                          |
| Runtime source        | API/web `ff6bc7d5af124dd09c23e9e5d776e8629e07e7aa`; native/model pins retained                  |
| Database              | `/var/lib/just-maple/production-20261029.sqlite`, WAL/FULL                                      |
| Local files           | `/var/lib/just-maple/media`; existing Azure media storage/URLs retained                         |
| Native search         | `just-maple-search`, private `/run/just-maple-search/worker.sock`                               |
| Cloudflare tunnel     | `just-maple-phoebe-staging`, ID `54b3d343-950f-4257-b057-85af3ff3e128` (original name retained) |
| Public ingress        | `phoebe.justmaple.app` → loopback API; catch-all 404; no LAN-host tunnel route                  |
| LAN HTTPS             | Nginx 443, trusted certificate, permits `192.168.0.0/23` and loopback only                      |
| Background jobs       | Enabled; server embedding backfill is also active                                               |

The public DNS record is a proxied CNAME to the dedicated tunnel. The local DNS
record is an unproxied A to the private LAN address. Existing root, legacy API,
media and mail DNS records were not changed. The old `paperbark.justmaple.app`
address no longer has a running Azure API behind it; clients need the new address.

## Authoritative cutover — October 29, 2026

Stopped `ca-justmaple-api` in `rg-justmaple-prod` using Azure's stop REST action
through `az`, after disabling old ingress and draining activity. Verified state
`Stopped` and zero replicas. Its Mongo URI exactly matched the original local API
`.env`. The other Azure app named `paperbark-maple` was an unrelated quickstart and
was left alone. Cosmos, Azure media and the old app/configuration remain retained.
Do not start any legacy Mongo writer against this retained database.

A **fresh quiesced export** contained **47,407 documents in 62 collections**. The
full unsanitized SQLite import preserved accounts, passkeys, tokens, IDs, sharing,
provider settings and binary data. Every collection passed count and canonical
content/BLOB checks; SQLite integrity and foreign-key checks passed. Transfer
SHA-256 matched. This replaced neither the original export nor the earlier sanitized
`staging.sqlite`; both remain retained. Normal application writes and retention can
change live counts after activation.

Reused 31,944 derived vector rows for 9,912 items only when owner, item revision,
content hash, model generation, dimensions and BLOB length matched the fresh import.
The initial production corpus had 12,440 searchable items and 2,528 pending jobs.
Backfill continues automatically; subsequent collection/retention changes adjust
these counts. Partial coverage is reported and lexical fallback remains available.

The production environment retains the existing JWT secret, `RP_ID=justmaple.app`,
APNs, OAuth/provider and Azure media credentials. It omits the source Mongo
credential and remote Redis. Both new origins are explicitly allowed for CORS and
passkeys. Outbound/background jobs were gated until verification, then restored.

The old automatic Azure deploy workflow (ID **215918883**) is **disabled manually**
in GitHub. This branch also makes it manual recovery-only with an explicit
confirmation input, so a future merge does not automatically deploy to the retired
Azure target. Do not enable it or resume Azure without reconciling Phoebe writes.

## Clients

Browser login uses the current site and has no server address form.

Apple clients show a native welcome screen before loading any website when no
server is saved. Enter only the primary domain; bare hostnames become HTTPS. The
client remembers the primary identity and discovers the local address from the
server’s `/api/server-info` response, then verifies the
stable `INSTANCE_ID` and primary URL before choosing LAN access. It refreshes the
advertisement on launch/foreground/network changes, bounded by a 30-second cache.
An unreachable or mismatched LAN endpoint falls back to the primary address.
A successful primary report replaces or clears stale/manual local addresses; if
the primary is unreachable, a previously discovered LAN address is still probed
against the saved identity. Network changes
switch API and WebSocket transport without reloading an open editor. Failed reads
can retry publicly; uncertain mutations are not replayed by the interceptor.

Keychain and collector account identity stays on the public URL. Watch receives the
public API address because it may be on another network. Native settings are
reachable before sign-in and even when the web app cannot load. **Existing installed
Apple builds require an update to get these settings.** No App Store/TestFlight
release was made. Server selection belongs to the native app. Its settings show discovered LAN
connection status without an editable local-domain field. Browser login always
uses its own origin.

With the discovery update installed, server administrators can set **Settings →
Server network → Local domain**. `GET`/`PUT /api/server/settings/network` require
a signed-in user whose current account has `admin: true`. The server stores the
override in SQLite’s `server_settings` collection; it survives restarts and is
advertised anonymously without user data. Until an override exists, `LOCAL_URL`
is the default. Clearing the field disables local advertisement even if the
environment has a default. The primary URL and instance ID remain operator settings.
This setting advertises an existing listener; the operator must configure trusted
HTTPS, DNS, CORS and passkey origins for that hostname before use. It does not
create DNS records or certificates. The existing Phoebe LAN hostname already has
these prerequisites. These changes are prepared in the discovery branch; production
remains on the release listed above until explicitly deployed.
Existing passkeys keep their original RP identity and can be used at the new origin.

A live run of the actual Swift resolver verified public/local trusted HTTPS identity,
LAN preference and fallback to the public address when the local endpoint fails.

**Google OAuth follow-up:** an anonymous preflight returned `redirect_uri_mismatch`
for the new native callback. Add these authorized redirect URIs to the existing
Gmail/Calendar OAuth client:

- `https://phoebe.justmaple.app/api/oauth/callback` (native)
- `https://phoebe.justmaple.app/gmail/oauth/callback` (public web)
- `https://local.phoebe.justmaple.app/gmail/oauth/callback` (LAN web)

Existing stored connections were migrated; new authorization/reauthorization needs
these additions.

## Secrets and TLS

`/etc/just-maple/api.env` is root-only, read by systemd. Keep `JWT_SECRET`,
`INSTANCE_ID` and RP identity stable across deployments and restores.
`production.env.prepared` is the retained, gated preparation copy, not the active
configuration. Never copy an example environment over a configured deployment.

The Mac's refreshed `~/.cloudflared/cert.pem` authorizes `justmaple.app` in the same
account as the existing tunnel. The LXC's non-root tunnel service receives only its
run token through systemd credentials. The login certificate file stays on the Mac.

Certbot's root-only `/etc/just-maple/cloudflare-certbot.ini` currently reuses the
refreshed login token for DNS-01 renewal. That token also has tunnel-management
permissions; replace it with a DNS-only token for this zone when convenient. It is
not accessible to the API user and is never stored in Git.

The LAN certificate expires **January 27, 2027**. `certbot.timer` renews it and
`/etc/letsencrypt/renewal-hooks/deploy/just-maple-nginx` validates/reloads Nginx. A
simulated renewal and deploy hook passed. TLS validation is never disabled for the
LAN hostname. `nginx-lan.conf` is the production LAN configuration.

## Persistence and retrieval

`DATABASE_DRIVER=sqlite` selects a separate Bun SQLite process. Each collection has
its own table, canonical EJSON, normalized native indexes and separate binary BLOBs.
Mingo evaluates the existing audited typed query/update/aggregation operators.
Atomic mutations, positional array updates, optimistic versions, leases and one-use
challenges run in transactions. Unsupported operators fail explicitly. The optional
Mongo provider and its types remain transitional; specialized SQL repositories can
replace this boundary incrementally.

Bulk batches are deliberately atomic and do not emulate Mongo partial unordered
failure results. Expiry predicates reject expired credentials, but TTL metadata does
not schedule SQLite deletion; an expiry cleanup policy remains future work.

AI `search_local_data` calls on synced device-data pages use fresh sharing/page
filters, FTS5 BM25 with Porter stemming, server bge-m3 query embeddings, scoped exact
vector search, reciprocal rank fusion (`k=60`), deduplicated chunks and fresh
revision/content-hash/permission checks before hydration. `get_local_item` rechecks
opaque owner/source/item references. Phrases/exclusions constrain both ranking legs.
Loading, crashes, overload, two-second semantic timeout and pending vectors yield
lexical fallback with explicit mode/coverage metadata. Queries do not need the Mac
for embeddings. Collecting new Mac data and relaying actions still need the device;
retiring the legacy Apple embedding upload path is later work.

Backfill is durable, generation/revision/hash guarded, leased and retryable. Live
search has priority between embedding chunks. One shared model serves all owners,
with owner-scoped caches capped at 1 GiB and isolated retrieval permissions.

Runtime pins: Bun **1.4.3**, Rust **1.98.1**, ONNX Runtime **1.23.2**, fastembed
**5.8.0** with retained thread patch. Model:
`BAAI/bge-m3@5617a9f61b028005a4858fdac845db406aefb181`, generation
`bge-m3-5617a9f-cls-l2-512-v1`, 1024 f32 dimensions, CLS/L2, 512 tokens. Body chunks
are 384 tokens with 64 overlap and a 96-token header budget. Native worker limit is
5 GiB/2 CPU threads; API/database limit is 2 GiB. See `apps/search-worker/NOTICE.md`.
The release manifest hashes runtime/model/frontend artifacts and records the separate web source commit; the API and pinned native/model artifacts retain the runtime source above.

## Operations, backups and recovery

```sh
ssh phoebe 'pct exec 131 -- systemctl status just-maple-api just-maple-search just-maple-cloudflared nginx --no-pager'
ssh phoebe 'pct exec 131 -- curl -fsS http://127.0.0.1:7071/api/health'
curl -fsS https://phoebe.justmaple.app/api/health
curl -fsS https://local.phoebe.justmaple.app/api/health
ssh phoebe 'systemctl start just-maple-staging-backup.service'
```

The API service uses **KillMode=mixed**: systemd signals the API first so it can
drain requests and flush Yjs documents through the still-running SQLite child.
The API closes the child itself; systemd bounds final cleanup. A real service stop
returned success/status 0. Pending-editor persistence and failed-save propagation
are also covered by tests. Do not restore the default cgroup-wide initial SIGTERM.

The legacy-named `just-maple-staging-backup.timer` runs hourly at :15 with jitter.
Its script selects the active database from `api.env`, uses a separate connection's
`VACUUM INTO`, checks integrity, copies to NAS and verifies SHA-256. Production
archives go to `/mnt/pve/nas-vms/dump/just-maple-production/`, with restrictive
permissions. Latest cutover snapshot: `just-maple-20261029T190951Z.sqlite`.
The script refuses missing NAS/stopped guest and caps an archive at **168 snapshots**;
it fails for retention review rather than silently deleting backups. Set a long-term
retention policy before this cap is reached. Daily Proxmox backups remain unchanged.

Restored that NAS snapshot to `production-restore-check-20261029.sqlite`, verified
its checksum and started an isolated API on loopback 7074 without providers,
background jobs or native search. Authenticated reads, passkey challenge creation,
CORS, hidden development auth and WebSocket readiness passed. The temporary API is
stopped; the restored file remains. This was an isolated API restore on CT131;
a fresh-guest/host rebuild drill remains outstanding.

Root-only config/TLS recovery archive:
`/mnt/pve/nas-vms/dump/just-maple-production/production-config-20261029T1914Z.tar.gz`.
Operator-side export, verification reports and pre-change Azure/DNS configuration
are private under `/tmp/just-maple-cutover-20261029/`; Phoebe provisioning copies are
under `/root/just-maple-provision-20261029/`. Do not commit these artifacts.

After activation, **never resume Azure or restore an old database over accepted
Phoebe writes without reconciliation**. The private pre-activation rollback helper
refuses once the `phoebe-authoritative-opened` marker exists. For a compatible code
rollback, keep the current database/environment, switch to a reviewed compatible
release and restart the API. Preserve source exports and backups.

## Build and deploy

```sh
bun install --frozen-lockfile
bun run build:api
bun run build:web:paperbark
cargo build --release --locked --manifest-path apps/search-worker/Cargo.toml
```

Use Node **24.15.0**, Bun 1.4.3 and the pinned Rust toolchain. Build Linux native
binaries on Linux (current build tree `/opt/just-maple-build/search-worker`), install
versioned artifacts and preserve runtime/model pins. Stage `apps/api/dist` as `dist/`
and this directory as `infra/`, then run `install-in-lxc.sh NEW_RELEASE_ID` inside
CT131 with `JUST_MAPLE_DEPLOY_SOURCE` pointing there. Existing releases are refused;
existing environment/database are preserved. Back up before schema changes. The
installer alone does not create DNS or route traffic.

Migration commands: `migrate.js inventory`, `export NEW_DIRECTORY
[--source-quiesced]`, `import EXPORT_DIRECTORY NEW_DATABASE [--staging]`. The flag
records an externally enforced freeze; it does not stop Mongo writers. Import
refuses existing targets and verifies counts/content. Operator `smoke.js` and
`benchmark.js` create/remove their own staging fixtures and require an explicit
staging flag; never point them at production.

## Validation and remaining work

940 API tests passed (3 existing skips); 7 focused login/transport tests and 2 isolated
Swift resolver tests passed. macOS test-build, iOS build, API/frontend builds and
formatting passed. Earlier checks include 139 shared, 12 Rust and 17 Chromium E2E
passes (136 existing skips), native paraphrases/isolation/revocation/crash recovery,
binary fidelity and a staging guest reboot. Signed focused macOS tests now pass after the account refresh; broader Apple UI
validation remains pending. Existing frontend suite failures and API rootDir/type diagnostics reproduce
on the clean base; these changes added no unique API type errors.

Production passed trusted public/LAN HTTPS, anonymous denial, authenticated reads,
RP identity, CORS, WebSockets, development-auth exclusion, database integrity and NAS
backup/restore checks. The public and LAN sign-in UIs have no server input. Native first launch presents server setup before loading web content; saved addresses survive relaunch. No App Store
release or main merge occurred.

Still tracked: Google OAuth callback registration; distribution of the new Apple
build; automatic initial backfill completion; 30–50-query relevance and load/p95
acceptance; TTL cleanup/backup retention; fresh-guest recovery drill. Earlier warm
corpus samples were roughly 0.54–0.94 seconds with partial coverage, not a p95 result.

## Messages and contact-mail retention

The history-retention branch removes the Messages date cutoff. Its versioned Mac
checkpoint rewinds only Messages once, then commits and uploads bounded pages; quit
or interruption resumes from the last committed page. Reactions are excluded and
attachment-only messages keep their placeholder; attachment files are not uploaded.
The existing 20,000-character body cap is unchanged.

Messages never expire automatically. Mail whose sender email exactly matches one of
the same owner's contact addresses is archived without expiry, including mail already
imported when this policy is activated. The decision persists through later contact
edits and collector reconciliation deletions. Explicit device/source/data forgetting
still deletes it. Recipients, display names and other users' contacts cannot grant
retention. Non-contact mail and other sources retain their existing 30-day policy
(with the ongoing-event/current-Home exceptions).

Mail's reader/checkpoint/window are unchanged: this does **not** backfill older email.
The server's lexical index includes every uploaded message immediately; the durable
embedding queue adds semantic coverage in the background. Historical uploads are
marked as backlog and excluded from proactive news, including recent history. Graph linking
continues to use its separate 30-day window. Deploy the retention API before starting
an all-history collector, and take a verified NAS snapshot first. Keep the active DB
and environment during code activation/rollback; an older API's retention job would
expire archived data, so do not roll back to that policy without disabling that job.

Activated the retention API on **2026-10-30** as `message-history-20261030-01`,
after verified NAS snapshot `just-maple-20261030T051652Z.sqlite`. The API source is
`c2b4550c394f06fdec6012f53d8cf927ee882919`; the previous web source
`2639adf64d72abe0c8455189127d8e4873a80c3e` and native/model artifacts are unchanged.
All 208 manifest artifacts were checked during activation. Public/LAN authenticated
reads, identity, CORS, WebSocket, anonymous denial and development-auth exclusion
passed after activation; API/search/tunnel/Nginx are active.

Imported **64,698 unique available Messages items**, December 10, 2019 through
October 30, 2026 UTC, through the Mac's existing active collector in 329 message-only
batches. Normal message types 0/2/3 and legacy NULL types are included; reactions,
sticker reactions, votes and unreadable/empty records are excluded. The versioned
checkpoint also repairs the former type filter. Every item has a current search
document; a historical FTS query passed. Apple Mail remained **10,700** items and
its local checkpoint hash was unchanged; **12** already imported emails qualified
for permanent contact-mail retention.

At **05:31 UTC**, 63,485 semantic jobs remained with zero retries. This is complete
ingestion/lexical coverage, with semantic coverage still building. SQLite was
979,660,800 bytes; available data space was 58,590,478,336 bytes. Counts and sizes
continue changing. Final post-import NAS snapshot `just-maple-20261030T053200Z.sqlite`
passed the backup service's integrity/SHA checks. No DNS change, source-database
modification or main merge.

## Client/frontend rollout — October 30, 2026

Frontend source `3fff5ce5580555814a089027a23e0aad2dd28ec3` is deployed as
`japanese-maple-20261030-02`. The retention API remains at `c2b4550c`; database,
environment and native/model pins are preserved. All **111** current manifest
artifacts passed SHA-256 checks. Pre-deployment NAS snapshot
`just-maple-20261030T053758Z.sqlite` passed integrity/SHA verification. Public/LAN
identity, authenticated reads, anonymous denial, CORS, WebSockets and development-auth
exclusion passed after activation. API/search/tunnel/Nginx remain active.

Signed JapaneseMaple **1.0.0 (64)** was installed on physical iPhone **Artemis**
(`com.just.maple.JapaneseMaple`); the installed app listing confirms build 64.
Opening it was blocked by iOS while the phone was locked, so phone launch verification
awaits unlocking. No uninstall or data-container reset was used.

Mac build **64** is installed and running from
`/Users/riabuz/Applications/JapaneseMaple.app`, with its signature verified and the
previous user bundle preserved under `/tmp/japanese-maple-deploy-20261030/mac-backups/`.
It retained sign-in, uses the primary Phoebe domain and automatically discovers the
LAN hostname; the native settings visibly report **Connected locally**. Its Messages
checkpoint is version 3 with backfill complete, and the local staging cache has
64,698 messages and 10,700 emails. The separate root-owned
`/Applications/JapaneseMaple.app` remains build 63: replacing it requires administrator
authentication. Use the updated user-installed copy. No App Store/TestFlight release.

A compatible frontend rollback returns the current symlink to
`message-history-20261030-01` and restarts only the API while preserving the live
database/environment. Mac rollback can restore the backed-up bundle without deleting
its container/keychain, though it loses the new collection policy. Semantic indexing
continues in the durable background queue. No main merge or DNS change.

## Archived messages and conversation reader

The Messages page has a contact/group sidebar and searches the owner's full imported
history. Platform, date, contact-name and People/Groups filters narrow the view.
Search results open with surrounding messages; the timeline loads earlier history
without downloading every body into the browser. Each message retains its platform
and sender. Existing page sharing rules apply before the directory, counts, previews
or contact aliases are assembled.

Owners can choose **Messages → Import archive**, select the `messages.db` produced
by `message-archive`, review platform counts, choose an IANA timezone for dates with
no offset and start the import. The server stores a private staging copy; the
original file stays unchanged. Imports run in bounded batches and can be paused,
resumed, or continued after restarting the API. Closing the dialog does not stop a
running job. Reuse the archive name when importing an updated copy of the same
archive. Keep distinct datasets under different names.

Imports are additive in the existing `imessage` data source, with separate archive
device IDs, platform provenance and curated person/group membership. Stable source
IDs make repeat uploads idempotent. Only exact, unambiguous native iMessage overlaps
with the same time, direction, complete peer handles and text are skipped. Ambiguous
matches, different platforms and attachment-only records remain preserved. Imports
do not take over the active Mac collector, reset Mail, send replies or create
proactive news from old messages. Explicit “forget all data” first drains and pauses
imports, then removes import jobs and their uploaded copies so they cannot recreate
forgotten items. The original file on your computer stays untouched.

Naive timestamps use the chosen timezone, retaining the original text and timezone.
Missing/invalid times are marked **Date unknown**; DST folds use the earlier time and
nonexistent DST times stay unknown. Text uses the existing 20,000-character cap;
attachment references are retained without copying attachment files. The source
staging copy preserves the full original archive. Messages do not expire. Keyword
search is ready as batches commit; semantic vectors build through the existing
server queue, so import completion does not imply complete semantic coverage.

The upload limit is 100 MB. A separate read-only Bun process validates the expected
SQLite tables/integrity and converts records without API credentials. Staged files
live at `<database-directory>/message-imports/<job-id>/source.sqlite` (700 directory,
600 file), overridable with `MESSAGE_ARCHIVE_DIR`. Import receipts/checkpoints live
in the owner-scoped `message_archive_imports` collection. The NAS database snapshot
contains imported records and checkpoints; the original staging files should also
be retained for unfinished jobs. A resumed job whose source file is unavailable
fails safely rather than inventing or deleting records. Do not remove staging files
while jobs are active.

### Archive rollout — October 30, 2026

Deployed `message-archive-20261030-11`, API/web source
`a04b62b570a16c83fd29d36966b8a90fa4041017`, with all 112 manifest artifacts
verified. Native binary/model/environment pins and the existing 2 GiB API limit
are unchanged. Public/LAN authenticated reads, identity, CORS, WebSocket, anonymous
access denial and development-auth exclusion passed. The Mac reader UI was checked
through the installed JapaneseMaple client; hosted Apple clients load this interface
from the server without a new native binary.

Processed all **208,713 source records / 14 platforms**: **177,862 added** and
**30,851 exact native iMessage overlaps skipped**. Existing native history stayed
at 64,698, giving **242,560 Messages records**. All-platform directory checks found
3,157 conversations; automated archive conversations are hidden by default and can
be included with the checkbox. Curated aliases link direct histories across
platforms while groups remain distinct. Historical AIM keyword search and
chronological threads passed. The 2,017 undated records remain explicitly unknown.
Naive source timestamps used `America/New_York`; their original text is retained.
Seven messages exceeded the existing JavaScript 20,000-character text cap; full
original text remains in the source/staging archive. Attachment files were not copied.

The original 53,309,440-byte archive's SHA-256 stayed unchanged. A protected source
copy is retained on the NAS as `message-archive-20261030-source.sqlite` beside the
production backups, with the same verified checksum. Pre-import snapshot
`just-maple-20261030T063209Z.sqlite`, paused-import snapshot
`just-maple-20261030T065106Z.sqlite`, and completed-import snapshot
`just-maple-20261030T072910Z.sqlite` passed off-host integrity/SHA checks. At the
post-import audit, SQLite held 2,772,647,936 bytes plus a 29,449,792-byte WAL, with
53,988,368,384 bytes available; quick-check passed and foreign-key errors were zero.
Derived embeddings continue growing: the post-import queue had 232,624 jobs, so
complete semantic coverage is not claimed. Keyword search is available now.

The large corpus exposed compatibility reads that hydrated old messages during
header, collector-count and retention queries. The import was paused safely at
123,000 records and resumed from its durable checkpoint after correcting these
reads. Message metadata and group memberships are interned, directory previews use
unique-ID lookups with text cut in SQL, collector counts use covering indexes,
and mail retention/expiry read bounded metadata. Vector uploads no longer evict the
conversation metadata cache. Explicit data forgetting drains imports and deletes
items in bounded transactions. Retention policy did not change.

Validation: 961 API tests passed with 3 existing skips; final focused message tests
10 passed; 147 shared and 17 focused UI tests passed. API/paperbark builds,
shared/web typecheck and pre-commit checks passed. Standalone API `tsc` still has
pre-existing workspace/rootDir diagnostics. Feature branch
`codex/message-archive-and-threads`, draft PR312, remains unmerged. No DNS, Azure,
other guest or standalone local/iCloud app changes.

For a compatible code rollback, return to `message-archive-20261030-10` while
keeping the current production database/environment. Pause any future active import
first. Preserve the bounded history/retention queries when rolling farther back;
older compatibility scans do not handle this corpus within the current memory cap.
Never restore a pre-import snapshot over accepted writes without reconciliation.
Private operator receipts are under `/tmp/japanese-maple-archive-20261030/` on the
Mac, `/root/message-archive-20261030/` in CT131, and the matching subdirectory of
Phoebe's `/root/just-maple-provision-20261029/`.

## AI search memory repair — October 30, 2026

The active API release is `search-bounded-20261030-02`, source
`1728f8ed63908e87c0d9869c8fd1761688fd622b`. The web frontend retains source
`a04b62b570a16c83fd29d36966b8a90fa4041017`. All 112 manifest artifacts verified;
DB, environment, model, native worker, DNS and resource limits are retained.

AI search previously serialized the whole archive's metadata (about 222 MB) in one
EJSON response. The SQLite worker reached about 1.64 GiB RSS and thrashed against
the service's 1.5 GiB soft throttle, causing deadlines and API restarts. Search now
reads 500-row keyset batches, carries only sharing-filter facts over IPC and retains
only identity/version/sort keys between batches. All chat/calendar/mail/place/home
and presence checks remain in place, followed by fresh permission/revision checks
before result hydration. Two searches may run at once, four may queue, and further
calls return `search_overloaded` before allocating candidate maps. Queries without
phrases or exclusions skip the unnecessary full authorized-ID round trip.

`embedding_jobs_ready` indexes the existing retry-time/rowid ordering, so normal
background claims stop rescanning and sorting the full backfill queue. Slow SQLite
operations log operation/collection names and duration, never query arguments or
message contents. Worker deadline errors now identify the pending operation.

Validation: 964 API tests passed, 3 existing skips; API build and precommit checks
passed. Full snapshot tests under the unchanged 2 GiB service cap covered 253,660
eligible items: sequential keyword searches took 8.5–8.7 seconds, chronological
retrieval 6.2 seconds, and three simultaneous requests completed in 31.2 seconds
with peak service memory 994.1 MiB. Pings continued during retrieval (up to 2.6
seconds). An additional cold mixed-workload queue claim took 12.2 seconds; isolated
warm claims used the index and took 2–9 ms. These are snapshot load measurements,
not a guarantee of complete semantic coverage or every production latency tail.

Post-deploy public/LAN identity, authenticated reads and anonymous denial passed.
Messages totaled 242,564, including all 177,862 archive imports; 3,157 conversations,
chronological thread loading and the warm directory (384 ms) passed. SQLite quick
check returned `ok` and foreign-key checks were empty. API memory was about 346 MB,
peak about 1.05 GB, with zero automatic restarts since final activation. Semantic
backfill continued (218,466 pending at verification).

Verified pre-activation NAS snapshot: `just-maple-20261030T133254Z.sqlite`.
For compatible code rollback, switch only the symlink to
`search-bounded-20261030-01` and restart API, retaining live DB/environment and the
harmless added index. The older archive rollout rollback above is historical;
prefer retaining these AI-search bounds for this corpus. Do not restore old DB
contents over accepted writes. Private incident receipts and snapshot benchmark
copy remain in `/tmp/japanese-maple-lockup-20261030/` on the Mac,
`/root/lockup-20261030/` in CT131 and Phoebe's existing provisioning directory.

## Bot responses rendered from preserved source

New bot messages retain `botResponseSource` alongside validated `botUI` and the
portable rich-text fallback. Chat, thread replies and the thread's parent message
parse that original source with the current shared parser when displayed, so later
parser/renderer fixes apply without rewriting stored messages. Replies saved before
source preservation still render their validated block data; legacy raw Response
programs in rich-text code blocks are recovered on read/display without migration.

The static parser also accepts a leading `Response(...)` without a `root =`
assignment, concatenated statements and mislabelled fences such as `vbnet`. Ordinary
code remains code. Only the existing flat Text/Card/Table/Button/Form/Source library
is accepted, with collection/string limits and no runtime/tool provider. Model
source cannot create server action/proposal/draft cards. Those cards are retained
from validated server data and continue to load current access/state on interaction.
Shared-draft privacy notices omit preserved raw output, revisions keep the previous
source, and explicit message edits clear the old generated source/presentation.

The server's processed fallback still supports notifications, text clients and
conversation context. Original source was not retained on some older successfully
processed replies; those keep their portable blocks rather than inventing source.
No bulk history rewrite is required for this rendering change.

### Render-time rollout — October 30, 2026

Activated `bot-render-20261030-01`, API/web source
`ce82c5e01f473a72a768d2dd8aa4e2ac8523059a`, all 112 manifest artifacts verified.
Pre-activation NAS snapshot `just-maple-20261030T154109Z.sqlite` passed the existing
integrity/SHA workflow. Both public and LAN paths passed health, anonymous denial
and authenticated reads. The affected existing reply returned two text blocks and
three source blocks with preserved source; its stored document SHA-256 was unchanged.
All 177,862 archive records remain present. Native/model/environment/search bounds
and resource limits were retained; no DNS, Azure, other guest or main merge change.

The running Mac client applied the service-worker Update and displayed that same
saved reply as two paragraphs and three source buttons, with no raw Response code.
Other hosted clients receive this web update on reload/Update; no native binary
change is required. Earlier successfully processed replies without saved raw source
continue to use their portable blocks. New replies and recovered legacy raw replies
use the current parser at display time. No automatic message replay, message resend
or bulk content rewrite was performed.

Validation: full API 967 passed/3 existing skips, final save/edit/revision regressions
4 passed, shared 155, focused chat/thread UI 15; final separate-entry API 19/UI 9.
API/paperbark builds, shared/web typechecks and precommit checks passed. Existing
standalone API workspace/rootDir diagnostics remain. The parser library's existing
CommonJS/initial-size warnings remain non-blocking. Branch
`codex/bot-response-rendering`, draft PR313, is stacked on the unmerged archive/search
branch. Roll back code to `search-bounded-20261030-02`, retaining live DB/env and
optional source fields; portable fallbacks remain compatible. Private receipts and
visual verification are in `/tmp/japanese-maple-render-20261030/` on the Mac,
`/root/bot-render-20261030/` in CT131 and Phoebe's existing provisioning directory.

## Graph date requests and bounded database reads (2026-10-30)

The graph now opens with seven days selected; All is removed. Date changes send the
selected window to the server, and older replies/errors cannot replace a newer
selection. The API also defaults older clients to seven days and rejects malformed
or reversed ranges. Contacts and ongoing events retain their existing semantics;
notebook membership, page sharing and source filters still apply.

SQLite graph reads now apply ordering, limits and body projection before decoding
records. Item lookups use the primary-key index instead of scanning the owner's
library; relation reads filter dated hub spans before the read limit. Search vector
loading uses an additive `(user_id,generation,id,chunk)` index and seeks by the last
item/chunk, replacing deep OFFSET scans. Stale vector/source checks are retained.
This prevents a slow vector-loading loop from repeatedly occupying the same database
worker needed by graph and other API requests.

Pre-activation snapshot `just-maple-20261030T214912Z.sqlite` passed off-host
integrity/SHA verification. Rehearsal receipts are in
`/tmp/japanese-maple-graph-20261030/` on the operator Mac and
`/root/graph-window-20261030/` in CT131. Deployment verification is recorded below. Roll back code to `bot-render-20261030-01`, restart only the API,
and retain the live database/env and harmless additive index. Never restore a
pre-change snapshot over accepted writes. DNS, Azure, native/model binaries, resource
limits and other guests are outside this rollout.

Activated `graph-window-20261030-01`, source
`e8c1f7c2e8871bec7e956918efcde849b060cc4d`; all 209 manifest artifacts verified.
Both hostnames passed authenticated seven/30-day graph reads, health and anonymous
denial. LAN graph responses measured 171–349 ms; public 789–1411 ms. All 177,862
archive imports remain present. Background embedding work continues (144,412 jobs
at this verification); these measurements do not claim complete semantic coverage
or a comprehensive latency guarantee.

On an independent production snapshot under the API's memory/CPU limits, the old
unindexed deep vector batch took 6,156 ms. The new seek batch took 7–10 ms. Loading
137,302 chunks through the SQLite boundary took 4,660 ms while three concurrent
graph reads took 186–222 ms, with 312.1 MiB service peak. Both graph implementations
returned identical 1,055 nodes/1,051 links when measured correctly; the initial
archived-source benchmark bundle was discarded after its dependency mismatch yielded
an empty graph. No native inference/LLM was invoked for the snapshot load rehearsal.

Validation: 971 API tests passed/3 existing skips, 16 focused web tests, shared/web
typechecks, API/paperbark builds and precommit passed. Draft PR314 is stacked on
PR313 and remains unmerged.

Final frontend correction: `graph-window-20261030-02`, source
`210b4cfec40fb1b8acd441971ce4ead1fbee6345`, all 112 artifacts verified. The first
package accidentally included stale paperbark output: the precommit hook builds the
default web target and does **not** refresh `apps/api/dist/web/paperbark`. Always run
`bun run build:web:paperbark` explicitly before packaging this deployment, then verify
the rendered page. Release 02 contains the tested API fix and explicitly rebuilt web
client. Final public/LAN graph checks pass (LAN 165–188 ms, public 902–1571 ms), with
all 177,862 archive imports intact. The Mac client applied Update and visibly showed
the loaded graph with From October 23 and only 7-day/30-day presets. No native binary
change; other clients apply the web Update/reload. Snapshot test results above remain
valid for the unchanged API code. Source/visual receipts are retained privately.
Occasional slow generic device reads still occur in background jobs; this rollout
addresses the reproduced graph/vector stalls, not a comprehensive performance audit.

## Editable bot names and handles (2026-10-30)

Activated `bot-identity-20261030-02`, source
`ff6bc7d5af124dd09c23e9e5d776e8629e07e7aa`, with 112 verified artifacts. Both AI
and webhook bot editors allow owners to change the name and handle. Cards show the
saved name and mention suggestions invalidate on save. Webhook bots returned by
both listing endpoints appear only once, with the proper custom editor.

Handles normalize to lowercase and allow 1–30 letters/numbers/underscores/hyphens.
Per-owner uniqueness includes concurrent saves. IDs, configurations, webhook secrets
and permissions remain stable; historical message content is not rewritten. API
regressions cover rename resolution, invalid/duplicate/cross-owner edits and races.

Full API: 977 passed/3 existing skips. Focused bot UI/cache: 14 passed; shared/web
typechecks, API/explicit paperbark builds and precommit pass. The unchanged legacy
BotService tests still call removed getTagBots/tagBotsCacheVersion APIs and deprecated
Vitest done callbacks; current mention-cache behavior has separate passing tests.

Verified off-host snapshot `just-maple-20261030T221447Z.sqlite` before activation.
Public/LAN health, authenticated bot reads, anonymous denial and invalid-handle
rejection pass. All seven existing bot documents retain their identity/config/secret
hash (excluding update timestamps). Mac applied Update and both editors visibly have
settable name/handle fields; no real bot was renamed during verification. Other hosted
clients apply Update/reload; no native binary change. Draft PR315 is stacked on PR314,
unmerged. Private receipts: `/tmp/japanese-maple-bot-identity-20261030/` on Mac and
`/root/bot-identity-20261030/` in CT131.

Rollback code to `graph-window-20261030-02`, restart only API, retain live DB/env and
any user-saved names/handles. No data restore, DNS, native/model, resource-limit or
other guest change. The server hash check validates deployment preservation, while
actual rename writes are exercised only in the isolated tests.
