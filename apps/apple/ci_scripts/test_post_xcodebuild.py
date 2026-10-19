"""Run the real hook without credentials: main skips, malformed releases fail."""
import os
import subprocess
import unittest
from pathlib import Path


class ArchiveGateTests(unittest.TestCase):
    def test_main_build_and_failed_archive_skip_without_credentials(self):
        for overrides in ({"CI_PRODUCT_PLATFORM": "iOS"}, {"CI_TAG": ""}, {"CI_XCODEBUILD_ACTION": "build"}, {"CI_XCODEBUILD_EXIT_CODE": "1"}):
            with self.subTest(overrides=overrides):
                # Merge defaults explicitly so overrides can replace a field.
                result = self.invoke(overrides)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("skipping", result.stdout)

    def invoke(self, overrides):
        environment = {"PATH": os.defpath, "CI_PRODUCT_PLATFORM": "macOS", "CI_XCODEBUILD_ACTION": "archive",
                       "CI_XCODEBUILD_EXIT_CODE": "0", "CI_TAG": "v1.0.0", **overrides}
        return subprocess.run(["/bin/bash", str(Path(__file__).with_name("ci_post_xcodebuild.sh"))],
                              env=environment, text=True, capture_output=True)

    def test_stable_release_requires_archive_credentials(self):
        result = self.invoke({})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing Xcode Cloud variable: CI_ARCHIVE_PATH", result.stderr)

    def test_invalid_and_prerelease_tags_fail_before_external_calls(self):
        for tag in ("v1.0.0-rc.1", "v01.0.0", "v1.0", "v1.0.0;echo secret"):
            with self.subTest(tag=tag):
                result = self.invoke({"CI_TAG": tag})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Expected a stable", result.stderr)


if __name__ == "__main__": unittest.main()
