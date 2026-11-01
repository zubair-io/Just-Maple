#!/bin/sh
# Run on Phoebe, from a reviewed copy of this directory. No app deployment here.
set -eu
umask 077
source_dir=${1:?absolute directory containing reviewed deployment tools required}
case "$source_dir" in /*) ;; *) echo 'Absolute source directory required' >&2; exit 2;; esac
test "$(pct status 131)" = 'status: running'
for file in release_bundle.py pull_main.py activate_release.py just-maple-main-deploy.service just-maple-main-deploy.timer; do
    test -f "$source_dir/$file"
done
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=/root/just-maple-main-deploy-install/$stamp
mkdir -p "$backup_dir"
for path in /usr/local/lib/just-maple-deploy /etc/systemd/system/just-maple-main-deploy.service /etc/systemd/system/just-maple-main-deploy.timer; do
    if test -e "$path"; then cp -a "$path" "$backup_dir/"; fi
done
install -d -m755 /usr/local/lib/just-maple-deploy
install -m644 "$source_dir/release_bundle.py" "$source_dir/pull_main.py" /usr/local/lib/just-maple-deploy/
# $1 is intentionally expanded inside the guest, not on the host.
# shellcheck disable=SC2016
pct exec 131 -- sh -c 'if test -d /usr/local/lib/just-maple-deploy; then mkdir -p "$1"; cp -a /usr/local/lib/just-maple-deploy "$1/"; fi' sh "$backup_dir"
pct exec 131 -- mkdir -p /usr/local/lib/just-maple-deploy
for file in release_bundle.py activate_release.py; do
    pct push 131 "$source_dir/$file" "/usr/local/lib/just-maple-deploy/$file" --perms 644
done
install -m644 "$source_dir/just-maple-main-deploy.service" "$source_dir/just-maple-main-deploy.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now just-maple-main-deploy.timer
systemctl start just-maple-main-deploy.service
systemctl status just-maple-main-deploy.timer --no-pager
printf 'Installer backup: %s\n' "$backup_dir"
