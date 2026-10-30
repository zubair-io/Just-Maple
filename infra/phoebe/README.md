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
| Application release   | `/opt/just-maple/current` → `japanese-maple-20261030-02`                                        |
| Runtime source        | `c2b4550c394f06fdec6012f53d8cf927ee882919`; native/model pins retained                          |
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
