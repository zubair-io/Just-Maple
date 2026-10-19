"""Version-only handoff policy; reads Git objects and never executes PR code.

Adapted from Maple cf6d05cec1c49c9e418cf5f5c6439925362fd3ec.
Just Maple's product version is shared by all twelve Xcode target configurations.
"""

import re
import subprocess

CONTEXT = "release-handoff-complete"
APPLE = "apps/apple/JapaneseMaple.xcodeproj/project.pbxproj"
PATTERN = r"(MARKETING_VERSION = )([^;]+)(;)"


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def blob(ref, path):
    return subprocess.check_output(["git", "show", f"{ref}:{path}"], text=True)


def semver(value):
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value):
        raise ValueError(f"Expected stable X.Y.Z, got {value!r}")
    return tuple(map(int, value.split(".")))


def version(ref):
    values = [value for _, value, _ in re.findall(PATTERN, blob(ref, APPLE))]
    if len(values) != 12 or len(set(values)) != 1:
        raise ValueError("All twelve Apple target marketing versions must agree")
    semver(values[0])
    return values[0]


def next_version(current, requested=""):
    major, minor, patch = semver(current)
    result = requested.removeprefix("v") if requested else f"{major}.{minor}.{patch + 1}"
    if semver(result) <= semver(current):
        raise ValueError("Next development version must increase")
    return result


def branch(current):
    semver(current)
    return f"release/next-v{current}"


def version_files(ref):
    return [APPLE]


def expected_files(base, new):
    semver(new)
    version(base)
    text = blob(base, APPLE)
    return {APPLE: re.sub(PATTERN, lambda m: m[1] + new + m[3], text)}


def validate_versions(ref):
    version(ref)


def validate_bump(base, head):
    new = next_version(version(base), version(head))
    expected = expected_files(base, new)
    if set(git("diff", "--name-only", base, head).splitlines()) != set(expected):
        raise ValueError("Handoff must change only the product version file")
    for path, content in expected.items():
        if blob(head, path) != content:
            raise ValueError(f"Non-version change in {path}")
        if git("ls-tree", base, "--", path).split()[0] != git("ls-tree", head, "--", path).split()[0]:
            raise ValueError(f"File mode changed: {path}")


def allowed_pr(pr, main, handoff, tagged):
    return bool(tagged and pr["head"]["sha"] == handoff and git("rev-parse", f"{handoff}^") == main)
