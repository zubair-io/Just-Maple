#!/bin/sh
set -eu
umask 077
release_id=${1:?release id required}
case "$release_id" in *[!a-zA-Z0-9_-]*) exit 2;; esac
release_dir=/opt/just-maple/releases/$release_id
source_dir=${JUST_MAPLE_DEPLOY_SOURCE:-/tmp/just-maple-deploy}
test ! -e "$release_dir" || { echo 'Release already exists; choose a new release id' >&2; exit 1; }
id just-maple >/dev/null 2>&1 || useradd --system --home-dir /var/lib/just-maple --shell /usr/sbin/nologin just-maple
mkdir -p "$release_dir" /etc/just-maple /var/lib/just-maple/media /var/lib/just-maple/backups
cp -a "$source_dir/dist/." "$release_dir/"
printf '%s\n' '{"private":true,"type":"module","dependencies":{"sharp":"0.34.5"}}' > "$release_dir/package.json"
(cd "$release_dir" && /usr/local/bin/bun install --production --ignore-scripts)
chmod 755 /opt/just-maple /opt/just-maple/releases
chown -R just-maple:just-maple "$release_dir"
chmod 755 "$release_dir"
if [ ! -e /etc/just-maple/api.env ]; then
    cp "$source_dir/infra/api.env.example" /etc/just-maple/api.env
    python3 - <<'PY'
import secrets
with open('/etc/just-maple/api.env','a') as target: target.write('JWT_SECRET='+secrets.token_hex(48)+'\n')
PY
fi
# A stable public instance identity lets clients verify a preferred LAN endpoint.
python3 - <<'PY_IDENTITY'
import pathlib, uuid
path = pathlib.Path('/etc/just-maple/api.env')
if not any(line.startswith('INSTANCE_ID=') for line in path.read_text().splitlines()):
    with path.open('a') as target: target.write('INSTANCE_ID=' + str(uuid.uuid4()) + '\n')
PY_IDENTITY
chmod 600 /etc/just-maple/api.env
chown just-maple:just-maple /var/lib/just-maple /var/lib/just-maple/media /var/lib/just-maple/backups
if [ -e /var/lib/just-maple/staging.sqlite ]; then
    chown just-maple:just-maple /var/lib/just-maple/staging.sqlite
    chmod 600 /var/lib/just-maple/staging.sqlite
fi
for unit in just-maple-api.service just-maple-search.service just-maple-cloudflared.service; do
    install -m644 "$source_dir/infra/$unit" "/etc/systemd/system/$unit"
done
ln -sfn "$release_dir" /opt/just-maple/current
systemctl daemon-reload
systemctl enable --now just-maple-search.service just-maple-api.service
systemctl restart just-maple-api.service
# No token, DNS record or public route is created by this installer.
systemctl enable just-maple-cloudflared.service
systemctl status just-maple-api.service --no-pager
