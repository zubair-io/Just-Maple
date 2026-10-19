"""Reject tag/version mismatches before signing or uploading an archive."""
import unittest

from validate_version import validate


class VersionTests(unittest.TestCase):
    def project(self, version="1.0.0", count=12):
        return f"MARKETING_VERSION = {version};\n" * count

    def test_main_and_matching_tag(self):
        self.assertEqual(validate(self.project()), "1.0.0")
        self.assertEqual(validate(self.project(), "v1.0.0"), "1.0.0")

    def test_tag_must_equal_committed_version(self):
        for tag in ("v2.0.0", "v1.0", "v1.0.0-rc.1", "v01.0.0", "release-1.0.0"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                validate(self.project(), tag)

    def test_missing_extra_and_inconsistent_targets(self):
        for project in (self.project(count=11), self.project(count=13),
                        self.project(count=11) + self.project("1.0.1", 1)):
            with self.subTest(project=project), self.assertRaises(ValueError):
                validate(project)

    def test_main_version_must_be_stable_semver(self):
        for version in ("1.0", "01.0.0", "1.0.0-beta", "-1.0.0"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                validate(self.project(version))
