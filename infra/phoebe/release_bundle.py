"""Secret-free Linux runtime bundle; never include installers or environment files."""

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile

ROOT_FILES = {
    'index.js', 'sqlite-worker.js', 'message-archive-worker.js',
    'migrate.js', 'backup.js', 'smoke.js', 'benchmark.js',
}
NATIVE = 'native/just-maple-search'
MAX_BYTES = 300 * 1024 * 1024


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def allowed(name):
    path = PurePosixPath(name)
    return (not path.is_absolute() and '..' not in path.parts
            and str(path) == name and '\\' not in name
            and (name in ROOT_FILES or name == NATIVE
                 or name.startswith('web/paperbark/browser/')))


def build(root, sha, output):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('A full source commit SHA is required')
    root, output = Path(root), Path(output)
    sources = {name: root / 'apps/api/dist' / name for name in ROOT_FILES}
    sources[NATIVE] = root / 'apps/search-worker/target/release/just-maple-search'
    web = root / 'apps/api/dist/web/paperbark/browser'
    (web / 'deployment.json').write_text(json.dumps({'sourceCommit': sha}) + '\n')
    for path in web.rglob('*'):
        if path.is_file():
            sources['web/paperbark/browser/' + path.relative_to(web).as_posix()] = path
    if 'web/paperbark/browser/index.html' not in sources:
        raise ValueError('Paperbark build is missing')
    manifest = {
        'schema': 1, 'sourceCommit': sha, 'platform': 'linux-x86_64',
        'bun': '1.4.3', 'onnxruntime': '1.23.2',
        'files': {name: {'sha256': digest(path), 'bytes': path.stat().st_size}
                  for name, path in sorted(sources.items())},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, 'w:gz') as bundle:
        data = json.dumps(manifest, sort_keys=True).encode()
        entry = tarfile.TarInfo('runtime-manifest.json')
        entry.size, entry.mode = len(data), 0o644
        bundle.addfile(entry, io.BytesIO(data))
        for name, path in sorted(sources.items()):
            if path.is_symlink() or not allowed(name):
                raise ValueError('Unexpected build file')
            bundle.add(path, arcname=name, recursive=False)
    output.with_suffix(output.suffix + '.sha256').write_text(digest(output) + '\n')


def unpack(bundle_path, destination, sha):
    """Reject links, special files, duplicate names and traversal before writing."""
    destination = Path(destination)
    with tarfile.open(bundle_path, 'r:gz') as bundle:
        members = bundle.getmembers()
        if len(members) > 2000 or sum(m.size for m in members) > MAX_BYTES:
            raise ValueError('Runtime bundle too large')
        names = [m.name for m in members]
        if len(names) != len(set(names)) or any(not m.isfile() for m in members):
            raise ValueError('Only unique regular runtime files are allowed')
        if names.count('runtime-manifest.json') != 1:
            raise ValueError('Runtime manifest missing')
        metadata = bundle.getmember('runtime-manifest.json')
        if metadata.size > 1024 * 1024:
            raise ValueError('Manifest too large')
        manifest = json.load(bundle.extractfile(metadata))
        if (manifest.get('schema'), manifest.get('sourceCommit'), manifest.get('platform'),
                manifest.get('bun'), manifest.get('onnxruntime')) != (
                1, sha, 'linux-x86_64', '1.4.3', '1.23.2'):
            raise ValueError('Runtime provenance or compatibility mismatch')
        files = manifest['files']
        if set(names) != set(files) | {'runtime-manifest.json'}:
            raise ValueError('Manifest does not describe the entire archive')
        if not ROOT_FILES.union({NATIVE, 'web/paperbark/browser/index.html'}).issubset(files):
            raise ValueError('Incomplete runtime')
        # Validate every entry before creating any files.
        for name, receipt in files.items():
            if not allowed(name) or receipt['bytes'] != bundle.getmember(name).size:
                raise ValueError('Unexpected runtime path or size')
            content = bundle.extractfile(name).read()
            if hashlib.sha256(content).hexdigest() != receipt['sha256']:
                raise ValueError('Runtime hash mismatch')
        for name in files:
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(bundle.extractfile(name).read())
            path.chmod(0o755 if name == NATIVE else 0o644)
        return manifest


if __name__ == '__main__':
    build(Path(__file__).resolve().parents[2], os.environ['GITHUB_SHA'],
          Path('deploy/phoebe-runtime.tgz'))
