"""Validate every Apple target and bind a production archive to its Git tag."""
import os
import re
import sys
from pathlib import Path


def validate(project, tag=""):
    versions = re.findall(r"MARKETING_VERSION = ([^;]+);", project)
    if len(versions) != 12 or len(set(versions)) != 1:
        raise ValueError("All twelve Apple target marketing versions must agree")
    version = versions[0]
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Expected a stable MAJOR.MINOR.PATCH marketing version")
    if tag and tag != f"v{version}":
        raise ValueError(f"Release tag {tag!r} must match committed version v{version}")
    return version


if __name__ == "__main__":
    print(f"Apple marketing version: {validate(Path(sys.argv[1]).read_text(), os.environ.get('CI_TAG', ''))}")
