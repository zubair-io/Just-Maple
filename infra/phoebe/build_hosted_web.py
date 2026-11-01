"""Generate a deployment-specific environment without an app-level server default."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlsplit


def environment_source(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/')):
        raise ValueError('HOSTED_API_URL must be an HTTPS origin')
    origin = url.rstrip('/')
    return ("import { environment as base } from './environment.paperbark';\n"
            'export const environment = { ...base, apiUrl: ' + json.dumps(origin)
            + ', wsUrl: ' + json.dumps('wss://' + parsed.netloc) + ' };\n')


def main():
    root = Path(__file__).resolve().parents[2]
    origin = os.environ['HOSTED_API_URL'].rstrip('/')
    generated = environment_source(origin)
    source = root / 'apps/web/src/environments/environment.prod.ts'
    original = source.read_bytes()
    # The Blob frontend has no API reverse proxy. Include only public branding/PWA
    # assets at their existing same-origin paths, before Angular hashes its cache.
    assets = root / 'apps/web/public/api/storage/assets'
    assets.mkdir(parents=True, exist_ok=False)
    try:
        files = [root / 'apps/web/public/manifest.webmanifest',
                 *[p for p in (root / 'apps/web/src').rglob('*')
                   if p.suffix in ('.html', '.ts') and not p.name.endswith('.spec.ts')]]
        paths = set()
        for path in files:
            paths.update(re.findall(r'/api/storage/assets/([A-Za-z0-9_./-]+\.(?:svg|png|ico|jpg|webp))',
                                    path.read_text()))
        for name in sorted(paths):
            if '..' in Path(name).parts:
                raise ValueError('Unsafe public asset path')
            content = (root / 'infra/phoebe/hosted-assets' / name).read_bytes()
            if len(content) > 5 * 1024 * 1024:
                raise ValueError('Public branding asset too large')
            target = assets / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        source.write_text(generated)
        subprocess.run(['bun', 'run', 'build:web:production'], cwd=root, check=True)
    finally:
        source.write_bytes(original)
        shutil.rmtree(assets)
    shutil.copytree(root / 'apps/web/dist/web/browser', root / 'deploy/hosted-web')


if __name__ == '__main__':
    main()
