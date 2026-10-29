#!/bin/sh
# Install on Phoebe; only CT131 and its own generated snapshot are touched.
set -eu
umask 077
ctid=131
stamp=$(date -u +%Y%m%dT%H%M%SZ)
guest_snapshot=/var/lib/just-maple/backups/just-maple-$stamp.sqlite
database_path=$(pct exec "$ctid" -- python3 -c '
import pathlib,shlex
lines=pathlib.Path("/etc/just-maple/api.env").read_text().splitlines()
values=[shlex.split(line.split("=",1)[1])[0] for line in lines if line.startswith("DATABASE_PATH=")]
assert len(values)==1
path=pathlib.Path(values[0]).resolve()
assert path.parent==pathlib.Path("/var/lib/just-maple") and path.suffix==".sqlite"
print(path)
')
case "$database_path" in
    /var/lib/just-maple/production*.sqlite) archive_dir=/mnt/pve/nas-vms/dump/just-maple-production ;;
    /var/lib/just-maple/staging.sqlite) archive_dir=/mnt/pve/nas-vms/dump/just-maple-staging ;;
    *) echo 'Unknown database role; review backup destination' >&2; exit 1 ;;
esac
exec 9>/run/just-maple-staging-backup.lock
flock -n 9 || exit 0
mountpoint -q /mnt/pve/nas-vms
mkdir -p "$archive_dir"
# Bound archive storage without silently deleting prior snapshots. Raise/prune explicitly.
snapshot_count=$(find "$archive_dir" -maxdepth 1 -name 'just-maple-*.sqlite' -type f | wc -l)
test "$snapshot_count" -lt 168 || { echo 'Snapshot cap reached (168); review retention before continuing' >&2; exit 1; }
test "$(pct status "$ctid")" = "status: running"
pct exec "$ctid" -- runuser -u just-maple -- /usr/local/bin/bun /opt/just-maple/current/backup.js "$database_path" "$guest_snapshot"
pct pull "$ctid" "$guest_snapshot" "$archive_dir/just-maple-$stamp.sqlite"
local_hash=$(sha256sum "$archive_dir/just-maple-$stamp.sqlite" | cut -d' ' -f1)
guest_hash=$(pct exec "$ctid" -- sha256sum "$guest_snapshot" | cut -d' ' -f1)
test "$local_hash" = "$guest_hash"
printf '%s  %s\n' "$local_hash" "just-maple-$stamp.sqlite" > "$archive_dir/just-maple-$stamp.sqlite.sha256"
# Remove only this transient local copy after its verified off-host copy exists.
pct exec "$ctid" -- rm -- "$guest_snapshot"
printf 'Verified off-host snapshot: %s\n' "$archive_dir/just-maple-$stamp.sqlite"
