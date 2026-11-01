import copy
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import activate_release as activation
import pull_main as pull
import release_bundle as bundle

SHA = 'a' * 40


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        for name in bundle.ROOT_FILES:
            path = self.root / 'apps/api/dist' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('runtime ' + name)
        native = self.root / 'apps/search-worker/target/release/just-maple-search'
        native.parent.mkdir(parents=True)
        native.write_text('new search')
        web = self.root / 'apps/api/dist/web/paperbark/browser'
        web.mkdir(parents=True)
        (web / 'index.html').write_text('<title>JapaneseMaple</title>')
        self.archive = self.root / 'runtime.tgz'
        bundle.build(self.root, SHA, self.archive)

    def rewrite(self, change):
        with tarfile.open(self.archive, 'r:gz') as source:
            entries = [(member, source.extractfile(member).read()) for member in source.getmembers()]
        with tarfile.open(self.archive, 'w:gz') as target:
            for member, data in change(entries):
                target.addfile(member, io.BytesIO(data) if member.isfile() else None)

    def test_round_trip_and_commit_receipt(self):
        target = self.root / 'unpacked'
        receipt = bundle.unpack(self.archive, target, SHA)
        self.assertEqual(json.loads((target / 'web/paperbark/browser/deployment.json').read_text()),
                         {'sourceCommit': SHA})
        self.assertEqual(set(receipt['files']), {str(p.relative_to(target))
                                               for p in target.rglob('*') if p.is_file()})
        self.assertTrue(os.access(target / bundle.NATIVE, os.X_OK))

    def test_wrong_commit_writes_nothing(self):
        target = self.root / 'unpacked'
        with self.assertRaises(ValueError):
            bundle.unpack(self.archive, target, 'b' * 40)
        self.assertFalse(target.exists())

    def test_tampering_writes_nothing(self):
        def tamper(entries):
            return [(m, b'X' * len(data) if m.name == 'index.js' else data) for m, data in entries]
        self.rewrite(tamper)
        with self.assertRaises(ValueError):
            bundle.unpack(self.archive, self.root / 'unpacked', SHA)
        self.assertFalse((self.root / 'unpacked').exists())

    def test_traversal_link_and_duplicate_rejected(self):
        for name, kind in [('../escape', tarfile.REGTYPE),
                           ('web/paperbark/browser/link', tarfile.SYMTYPE),
                           ('index.js', tarfile.REGTYPE)]:
            with self.subTest(name=name):
                bundle.build(self.root, SHA, self.archive)
                member = tarfile.TarInfo(name)
                member.type, member.linkname = kind, '/etc/just-maple/api.env'
                self.rewrite(lambda entries: [*entries, (member, b'')])
                with self.assertRaises(ValueError):
                    bundle.unpack(self.archive, self.root / 'unpacked', SHA)
                self.assertFalse((self.root / 'unpacked').exists())

    def exercise_activation(self, fail=False, same_search=False):
        releases = self.root / 'releases'
        old = releases / 'old'
        (old / 'web/paperbark/browser').mkdir(parents=True)
        (old / 'index.js').write_text('old API')
        (old / 'node_modules').mkdir()
        (old / 'node_modules/pinned.txt').write_text('native dependencies')
        old_search = self.root / 'old-search'
        old_search.write_text('new search' if same_search else 'old search')
        current, search = self.root / 'current', self.root / 'search'
        current.symlink_to(old)
        search.symlink_to(old_search)
        data = self.root / 'database.sqlite'
        data.write_bytes(b'live accepted writes')
        env = self.root / 'api.env'
        env.write_text('PRIVATE=preserve')
        with (patch.object(activation, 'CURRENT', current),
              patch.object(activation, 'RELEASES', releases),
              patch.object(activation, 'SEARCH', search),
              patch.object(activation, 'run') as run,
              patch.object(activation.subprocess, 'check_output', return_value='1.4.3'),
              patch.object(activation.pwd, 'getpwnam') as account,
              patch.object(activation.os, 'chown'),
              patch.object(activation.Path, 'is_file', return_value=True),
              patch.object(activation, 'healthy', side_effect=RuntimeError('unhealthy') if fail else None)):
            account.return_value.pw_uid = account.return_value.pw_gid = 1000
            args = [self.archive, SHA, bundle.digest(self.archive), 'Verified off-host snapshot: /nas/fresh.sqlite']
            if fail:
                with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                    activation.activate(*args)
                self.assertEqual(current.resolve(), old)
                self.assertEqual(search.resolve(), old_search)
            else:
                activation.activate(*args)
                self.assertEqual(current.resolve(), releases / ('main-' + SHA))
                self.assertEqual((current / 'node_modules/pinned.txt').read_text(), 'native dependencies')
            self.assertEqual(data.read_bytes(), b'live accepted writes')
            self.assertEqual(env.read_text(), 'PRIVATE=preserve')
            restart = ('systemctl', 'restart', 'just-maple-search')
            self.assertEqual(sum(call.args == restart for call in run.call_args_list),
                             0 if same_search else (2 if fail else 1))

    def test_activation_preserves_data_and_pinned_dependencies(self):
        self.exercise_activation()

    def test_failed_health_restores_both_links_without_restoring_database(self):
        self.exercise_activation(fail=True)

    def test_identical_search_binary_avoids_model_restart(self):
        self.exercise_activation(same_search=True)


class ProvenanceTests(unittest.TestCase):
    def test_only_published_current_main_workflow_is_eligible(self):
        release = {'draft': False, 'tag_name': 'phoebe-main-' + SHA, 'target_commitish': SHA}
        run = {'head_sha': SHA, 'head_branch': 'main', 'head_repository': {'full_name': pull.REPO},
               'path': pull.WORKFLOW, 'event': 'push', 'publishedRuntime': True}
        self.assertTrue(pull.eligible(release, [run], SHA))
        for key, value in [('head_sha', 'b' * 40), ('head_branch', 'feature'),
                           ('head_repository', {'full_name': 'fork/Just-Maple'}),
                           ('path', 'other.yml'), ('event', 'pull_request'),
                           ('publishedRuntime', False)]:
            with self.subTest(key=key):
                changed = copy.deepcopy(run)
                changed[key] = value
                self.assertFalse(pull.eligible(release, [changed], SHA))
        self.assertFalse(pull.eligible({**release, 'draft': True}, [run], SHA))



if __name__ == '__main__':
    unittest.main()
