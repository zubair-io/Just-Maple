"""Exercise Cloud asset provenance, publication races and fail-closed delivery."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import publish_cloud_release as release


class PublicationTests(unittest.TestCase):
    tag = "v1.2.3"
    commit = "a" * 40
    repo = "zubair-io/Just-Maple"
    asset = "JustMaple-macOS-1.2.3.dmg"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.payload = b"test DMG bytes, not a signed artifact"
        digest = hashlib.sha256(self.payload).hexdigest()
        self.metadata = dict(schema=1, tag=self.tag, commit=self.commit, version="1.2.3",
                             build="17", asset=self.asset, sha256=digest, team="QREP66JW5U",
                             bundle="com.just.maple.JapaneseMaple", architectures=["arm64", "x86_64"],
                             app_notarization="Accepted", dmg_notarization="Accepted", source="xcode-cloud-archive")
        self.write_assets(self.directory)

    def write_assets(self, directory):
        (directory / self.asset).write_bytes(self.payload)
        (directory / "release-metadata.json").write_text(json.dumps(self.metadata))
        (directory / "SHA256SUMS.txt").write_text(f"{self.metadata['sha256']}  {self.asset}\n")

    def test_valid_archive_and_tampered_payload(self):
        release.validate(self.directory, self.tag, self.commit)
        (self.directory / self.asset).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "checksum"):
            release.validate(self.directory, self.tag, self.commit)

    def test_mismatched_commit_identity_notarization_and_architecture_rejected(self):
        for field, value in (("commit", "b" * 40), ("team", "OTHER"),
                             ("app_notarization", "Invalid"), ("dmg_notarization", "In Progress"),
                             ("architectures", ["arm64"]), ("source", "github-compile"),
                             ("asset", "../../unexpected"), ("build", "0")):
            with self.subTest(field=field):
                metadata = {**self.metadata, field: value}
                (self.directory / "release-metadata.json").write_text(json.dumps(metadata))
                with self.assertRaises(ValueError):
                    release.validate(self.directory, self.tag, self.commit)

    def transport(self, draft=True, incomplete=False, corrupt=False):
        self.calls = []
        def gh(*args):
            self.calls.append(args)
            if args[0] == "api": return self.commit
            if args[:2] == ("release", "view"):
                assets = [] if incomplete else [self.asset, "SHA256SUMS.txt", "release-metadata.json"]
                return json.dumps(dict(isDraft=draft, assets=[dict(name=name) for name in assets]))
            if args[:2] == ("release", "download"):
                directory = Path(args[args.index("--dir") + 1])
                self.write_assets(directory)
                if corrupt: (directory / self.asset).write_bytes(b"changed")
            return ""
        return patch.object(release, "gh", side_effect=gh)

    def test_publish_only_after_download_validation(self):
        with self.transport(): release.publish(self.repo, self.tag, self.commit)
        self.assertEqual(self.calls[-1][:2], ("release", "edit"))
        self.assertIn("--draft=false", self.calls[-1])

    def test_corrupt_artifact_never_published(self):
        with self.transport(corrupt=True), self.assertRaises(ValueError):
            release.publish(self.repo, self.tag, self.commit)
        self.assertFalse(any(call[:2] == ("release", "edit") for call in self.calls))

    def test_timeout_keeps_draft(self):
        with self.transport(incomplete=True), self.assertRaises(TimeoutError):
            release.publish(self.repo, self.tag, self.commit, timeout=0)
        self.assertFalse(any(call[:2] == ("release", "edit") for call in self.calls))

    def test_completed_rerun_does_not_modify_release(self):
        with self.transport(draft=False): release.publish(self.repo, self.tag, self.commit)
        self.assertFalse(any(call[:2] == ("release", "edit") for call in self.calls))

    def test_tag_movement_stops_publication(self):
        with self.transport() as gh:
            original = gh.side_effect
            seen = 0
            def moved(*args):
                nonlocal seen
                if args[0] == "api":
                    seen += 1
                    if seen == 2: return "b" * 40
                return original(*args)
            gh.side_effect = moved
            with self.assertRaisesRegex(ValueError, "Tag moved"):
                release.publish(self.repo, self.tag, self.commit)
        self.assertFalse(any(call[:2] == ("release", "edit") for call in self.calls))


if __name__ == "__main__": unittest.main()
