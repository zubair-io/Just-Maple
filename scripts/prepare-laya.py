#!/usr/bin/env python3
"""Fetch pinned build assets. The shipping app performs no model download."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'scripts/laya-assets.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--offline', action='store_true', help='Verify cached assets without network access')
args = parser.parse_args()
cache = root / '.build/laya-model'
def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
for item in manifest['files']:
    path = cache / item['path']
    def valid():
        if not path.is_file() or path.stat().st_size != item['size']:
            return False
        return digest_file(path) == item['sha256']
    if not valid():
        if args.offline:
            raise SystemExit('Laya build asset missing or invalid: ' + item['path'] + '. Run python3 scripts/prepare-laya.py once.')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + '.partial')
        url = 'https://huggingface.co/' + manifest['repository'] + '/resolve/' + manifest['revision'] + '/' + item['path']
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        digest = digest_file(temporary)
        if temporary.stat().st_size != item['size'] or digest != item['sha256']:
            temporary.unlink()
            raise SystemExit('Laya artifact hash mismatch: ' + item['path'])
        temporary.replace(path)
    print('Verified ' + item['path'])
