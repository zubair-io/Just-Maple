"""Publish only the notarized DMG from the tag's exact Xcode Cloud archive."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True).strip()


def validate(directory, tag, commit):
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        raise ValueError("Expected stable vMAJOR.MINOR.PATCH tag")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Expected exact release commit")
    asset = f"JustMaple-macOS-{tag[1:]}.dmg"
    metadata = json.loads((directory / "release-metadata.json").read_text())
    expected = dict(schema=1, tag=tag, commit=commit, version=tag[1:], asset=asset,
                    team="QREP66JW5U", bundle="com.just.maple.JapaneseMaple",
                    architectures=["arm64", "x86_64"], app_notarization="Accepted",
                    dmg_notarization="Accepted", source="xcode-cloud-archive")
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError("Archive provenance does not match the release")
    if not re.fullmatch(r"[1-9]\d*", metadata.get("build", "")):
        raise ValueError("Invalid Cloud build number")
    digest = hashlib.sha256((directory / asset).read_bytes()).hexdigest()
    if metadata.get("sha256") != digest:
        raise ValueError("DMG checksum differs from archive metadata")
    if (directory / "SHA256SUMS.txt").read_text() != f"{digest}  {asset}\n":
        raise ValueError("Checksum file does not match the DMG")


def publish(repo, tag, commit, timeout=10800):
    # Validate inputs before any external write.
    if repo != "zubair-io/Just-Maple" or not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        raise ValueError("Unexpected release repository or tag")
    resolved = gh("api", f"repos/{repo}/commits/{tag}", "--jq", ".sha")
    if resolved != commit:
        raise ValueError("Tag does not point to this workflow revision")
    view = ("release", "view", tag, "--repo", repo, "--json", "isDraft,assets")
    try:
        release = json.loads(gh(*view))
    except subprocess.CalledProcessError:
        try:
            gh("release", "create", tag, "--repo", repo, "--verify-tag", "--draft",
               "--title", f"Just Maple {tag[1:]}", "--generate-notes")
        except subprocess.CalledProcessError:
            # Cloud may have won the create race; verify rather than overwrite.
            pass
        release = json.loads(gh(*view))
    required = {f"JustMaple-macOS-{tag[1:]}.dmg", "SHA256SUMS.txt", "release-metadata.json"}
    deadline = time.monotonic() + timeout
    while not required.issubset({asset["name"] for asset in release["assets"]}):
        if not release["isDraft"]:
            raise ValueError("Published release is incomplete; refusing to modify it")
        if time.monotonic() >= deadline:
            raise TimeoutError("Cloud assets not ready; release remains a draft")
        print(f"Waiting for Xcode Cloud archive assets for {tag}", flush=True)
        time.sleep(30)
        release = json.loads(gh(*view))
    with tempfile.TemporaryDirectory(prefix="just-maple-release-") as output:
        gh("release", "download", tag, "--repo", repo, "--dir", output,
           *[argument for name in sorted(required) for argument in ("--pattern", name)])
        validate(Path(output), tag, commit)
    if not release["isDraft"]:
        print("Matching release is already published; no changes made")
        return
    if gh("api", f"repos/{repo}/commits/{tag}", "--jq", ".sha") != commit:
        raise ValueError("Tag moved while awaiting the archive")
    gh("release", "edit", tag, "--repo", repo, "--draft=false", "--prerelease=false", "--latest")
    print(f"Published {tag} from Xcode Cloud archive {commit}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"), required=not os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--tag", default=os.environ.get("GITHUB_REF_NAME"), required=not os.environ.get("GITHUB_REF_NAME"))
    parser.add_argument("--commit", default=os.environ.get("GITHUB_SHA"), required=not os.environ.get("GITHUB_SHA"))
    arguments = parser.parse_args()
    publish(arguments.repo, arguments.tag, arguments.commit)
