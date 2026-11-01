"""Installed, root-owned CT131 activator. Keep live data/env and existing runtime pins."""

import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

from release_bundle import digest, unpack

CURRENT = Path('/opt/just-maple/current')
RELEASES = Path('/opt/just-maple/releases')
SEARCH = Path('/opt/just-maple/bin/just-maple-search')


def run(*args):
    subprocess.run(args, check=True, timeout=240)


def link(target, path):
    pending = path.with_name(path.name + '.deploy-next')
    pending.unlink(missing_ok=True)
    pending.symlink_to(target)
    pending.replace(path)


def healthy():
    for attempt in range(90):
        try:
            with urllib.request.urlopen('http://127.0.0.1:7071/api/health', timeout=3) as response:
                health = json.load(response)
            if (health.get('status') == 'healthy' and health.get('databaseEngine') == 'sqlite'
                    and health.get('search') == 'ready'):
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('SQLite/search health check did not pass')


def activate(bundle, sha, checksum, snapshot):
    if not re.fullmatch('[0-9a-f]{40}', sha) or not re.fullmatch('[0-9a-f]{64}', checksum):
        raise ValueError('Invalid source/checksum')
    if digest(bundle) != checksum or not snapshot.startswith('Verified off-host snapshot: '):
        raise ValueError('Package or off-host backup receipt missing')
    old = CURRENT.resolve(strict=True)
    old_search = SEARCH.resolve(strict=True)
    if old.parent != RELEASES:
        raise ValueError('Unexpected current release')
    new = RELEASES / ('main-' + sha)
    if new.exists():
        raise ValueError('Release already staged; inspect before retrying')
    # Verify the whole archive into a fresh temporary directory, never over a live tree.
    with tempfile.TemporaryDirectory(prefix='just-maple-runtime-') as staging:
        staged = Path(staging)
        manifest = unpack(bundle, staged, sha)
        version = subprocess.check_output(['/usr/local/bin/bun', '--version'], text=True).strip()
        if version != manifest['bun']:
            raise ValueError('Installed Bun differs from tested runtime')
        if not Path('/opt/onnxruntime/lib/libonnxruntime.so.' + manifest['onnxruntime']).is_file():
            raise ValueError('Pinned ONNX runtime missing')
        shutil.copytree(old, new, symlinks=True)
        shutil.rmtree(new / 'web/paperbark/browser')
        for name in manifest['files']:
            target = new / name
            target.parent.mkdir(parents=True, exist_ok=True)
            # Do not follow inherited symlinks for runtime files.
            if target.is_symlink():
                target.unlink()
            shutil.copy2(staged / name, target)
        receipt = {**manifest, 'apiSourceCommit': sha, 'webSourceCommit': sha,
                   'release': new.name, 'preActivationSnapshot': snapshot}
        (new / 'deployment-manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
        account = pwd.getpwnam('just-maple')
        for path in [new, *new.rglob('*')]:
            os.chown(path, account.pw_uid, account.pw_gid, follow_symlinks=False)
    changed_search = digest(new / 'native/just-maple-search') != digest(old_search)
    try:
        # Stop/drain before replacing the SQLite child and restarting the native worker.
        run('systemctl', 'stop', 'just-maple-api')
        link(new, CURRENT)
        link(new / 'native/just-maple-search', SEARCH)
        if changed_search:
            run('systemctl', 'restart', 'just-maple-search')
        run('systemctl', 'start', 'just-maple-api')
        healthy()
    except BaseException:
        run('systemctl', 'stop', 'just-maple-api')
        link(old, CURRENT)
        link(old_search, SEARCH)
        if changed_search:
            run('systemctl', 'restart', 'just-maple-search')
        run('systemctl', 'start', 'just-maple-api')
        raise
    print(json.dumps({'release': new.name, 'sourceCommit': sha,
                      'searchRestarted': changed_search, 'health': 'healthy'}))


if __name__ == '__main__':
    activate(*sys.argv[1:])
