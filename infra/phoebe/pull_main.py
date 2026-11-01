"""Phoebe host timer: only successful, current-main CI releases; no GitHub token."""

import fcntl
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

from release_bundle import digest

REPO = 'zubair-io/Just-Maple'
API = 'https://api.github.com/repos/' + REPO
WORKFLOW = '.github/workflows/SugarMaple-Deploy.yml'
CACHE = Path('/var/cache/just-maple-deploy')
STATE = Path('/var/lib/just-maple-deploy/state.json')
ASSET = 'phoebe-runtime.tgz'


def get(path):
    request = urllib.request.Request(API + path, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'JapaneseMaple-Phoebe-deploy',
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def eligible(release, runs, sha):
    if (release.get('draft') or release.get('tag_name') != 'phoebe-main-' + sha
            or release.get('target_commitish') != sha):
        return False
    return any(run.get('head_sha') == sha and run.get('head_branch') == 'main'
               and run.get('head_repository', {}).get('full_name') == REPO
               and run.get('path') == WORKFLOW
               and run.get('publishedRuntime') is True
               and run.get('event') in ('push', 'workflow_dispatch') for run in runs)


def command(*args):
    return subprocess.check_output(args, text=True, timeout=600)


def save(data):
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    pending = STATE.with_suffix('.next')
    pending.write_text(json.dumps(data) + '\n')
    pending.chmod(0o600)
    pending.replace(STATE)


def main():
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (CACHE / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sha = get('/commits/main')['sha']
        if not re.fullmatch('[0-9a-f]{40}', sha):
            raise ValueError('Invalid main commit')
        state = json.loads(STATE.read_text()) if STATE.exists() else {}
        if state.get('sha') == sha:
            if state.get('status') != 'deployed':
                raise RuntimeError('This release failed; inspect before clearing deployment state')
            print('Already deployed current main ' + sha)
            return
        try:
            release = get('/releases/tags/phoebe-main-' + sha)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            print('Waiting for tested main release ' + sha)
            return
        runs = get('/actions/workflows/SugarMaple-Deploy.yml/runs?branch=main&head_sha='
                   + sha + '&per_page=10')['workflow_runs']
        for run in runs:
            if (run.get('head_repository', {}).get('full_name') == REPO
                    and run.get('head_sha') == sha and run.get('head_branch') == 'main'
                    and run.get('path') == WORKFLOW
                    and run.get('event') in ('push', 'workflow_dispatch')):
                jobs = get('/actions/runs/' + str(int(run['id'])) + '/jobs?per_page=100')['jobs']
                # This job can run only after all reusable CI checks and builds pass.
                # Do not wait for the final verification job, which waits for us.
                run['publishedRuntime'] = any(job.get('name') == 'Publish Phoebe runtime'
                                              and job.get('conclusion') == 'success'
                                              for job in jobs)
        if not eligible(release, runs, sha):
            print('Waiting for successful main deployment workflow ' + sha)
            return
        assets = {asset['name']: asset for asset in release['assets']}
        asset = assets[ASSET]
        if not 0 < asset['size'] < 100 * 1024 * 1024:
            raise ValueError('Runtime download too large')
        expected = asset.get('digest', '')
        if not re.fullmatch('sha256:[0-9a-f]{64}', expected):
            raise ValueError('GitHub asset digest missing')
        url = 'https://github.com/' + REPO + '/releases/download/phoebe-main-' + sha + '/' + ASSET
        if asset['browser_download_url'] != url:
            raise ValueError('Unexpected release asset URL')
        folder = CACHE / sha
        folder.mkdir(mode=0o700, exist_ok=True)
        bundle = folder / ASSET
        with urllib.request.urlopen(url, timeout=60) as response, bundle.open('wb') as output:
            size = 0
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > asset['size']:
                    raise ValueError('Download exceeds announced size')
                output.write(block)
        if digest(bundle) != expected[7:]:
            raise ValueError('GitHub asset hash mismatch')
        # A stale queued workflow must never roll the host backward.
        if get('/commits/main')['sha'] != sha:
            print('Main advanced during download; waiting for its tested release')
            return
        backup = command('/usr/local/sbin/just-maple-staging-backup')
        receipts = [line for line in backup.splitlines() if line.startswith('Verified off-host snapshot: ')]
        if len(receipts) != 1:
            raise ValueError('A fresh off-host backup was not verified')
        guest_folder = '/root/just-maple-deploy/' + sha
        command('pct', 'exec', '131', '--', 'mkdir', '-p', guest_folder)
        guest_bundle = guest_folder + '/' + ASSET
        command('pct', 'push', '131', str(bundle), guest_bundle, '--perms', '600')
        save({'sha': sha, 'status': 'activating', 'backup': receipts[0]})
        try:
            result = command('pct', 'exec', '131', '--', 'python3',
                             '/usr/local/lib/just-maple-deploy/activate_release.py',
                             guest_bundle, sha, expected[7:], receipts[0])
        except BaseException:
            save({'sha': sha, 'status': 'failed', 'backup': receipts[0]})
            raise
        save({'sha': sha, 'status': 'deployed', 'backup': receipts[0], 'receipt': result.strip()})
        print(result.strip())


if __name__ == '__main__':
    main()
