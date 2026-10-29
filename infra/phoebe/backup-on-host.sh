#!/bin/sh
# Install on Phoebe; only CT131 and its own generated snapshot are touched.
set -eu
umask 077
ctid=131
stamp=$(date -u +%Y%m%dT%H%M%SZ)
guest_snapshot=/var/lib/just-maple/backups/just-maple-$stamp.sqlite
archive_dir=/mnt/pve/nas-vms/dump/just-maple-staging
exec 9>/run/just-maple-staging-backup.lock
flock -n 9 || exit 0
mountpoint -q /mnt/pve/nas-vms
mkdir -p "$archive_dir"
# Bound staging storage without silently deleting prior snapshots. Raise/prune explicitly.
snapshot_count=$(find "$archive_dir" -maxdepth 1 -name 'just-maple-*.sqlite' -type f | wc -l)
test "$snapshot_count" -lt 168 || { echo 'Staging snapshot cap reached (168); review retention before continuing' >&2; exit 1; }
test "$(pct status "$ctid")" = "status: running"
pct exec "$ctid" -- runuser -u just-maple -- /usr/local/bin/bun /opt/just-maple/current/backup.js /var/lib/just-maple/staging.sqlite "$guest_snapshot"
pct pull "$ctid" "$guest_snapshot" "$archive_dir/just-maple-$stamp.sqlite"
local_hash=$(sha256sum "$archive_dir/just-maple-$stamp.sqlite" | cut -d' ' -f1)
guest_hash=$(pct exec "$ctid" -- sha256sum "$guest_snapshot" | cut -d' ' -f1)
test "$local_hash" = "$guest_hash"
printf '%s  %s\n' "$local_hash" "just-maple-$stamp.sqlite" > "$archive_dir/just-maple-$stamp.sqlite.sha256"
# Remove only this transient local copy after its verified off-host copy exists.
pct exec "$ctid" -- rm -- "$guest_snapshot"
printf 'Verified off-host snapshot: %s\n' "$archive_dir/just-maple-$stamp.sqlite"
